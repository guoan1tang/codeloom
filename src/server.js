// Zero-dependency HTTP server: static web UI + JSON API over the local graph.
// Binds 127.0.0.1 by default — the index contains your code structure; keep it local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, loadGraph, deleteRepo, getGlobalConfig, setGlobalConfig } from './db.js';
import { ingestRepo } from './ingest.js';
import { graphStatus } from './graph.js';
import { git } from './diff.js';
import { DEFAULT_CONFIG } from './config.js';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export function createAppServer(dbPath) {
  const db = openDb(dbPath);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) {
        const g = () => loadGraph(db);
        if (p === '/api/graph' && req.method === 'GET') {
          const graph = g();
          return json(res, 200, {
            nodes: [...graph.nodes.values()],
            edges: graph.edges,
            repos: graph.repos,
          });
        }
        if (p === '/api/status' && req.method === 'GET') {
          const st = graphStatus(g(), db);
          for (const r of st.repos) {
            const row = g().repos.find(x => x.id === r.repo);
            const dir = row && (row.local_path || row.url);
            if (dir && fs.existsSync(dir)) {
              try {
                const head = git(dir, ['rev-parse', 'HEAD']).trim();
                if (head !== row.commit_sha) { r.stale = true; r.note = 'checkout ahead of index'; }
              } catch { /* not a git checkout anymore */ }
            }
          }
          st.freshnessWarnings = st.repos.filter(x => x.stale).map(x => x.repo);
          return json(res, 200, st);
        }
        if (p === '/api/commits' && req.method === 'GET') {
          const repo = g().repos.find(r => r.id === url.searchParams.get('repo'));
          const dir = repo && (repo.local_path || repo.url);
          if (!dir || !fs.existsSync(dir)) return json(res, 200, { commits: [], note: 'repo not available locally (indexed from URL); paste a diff instead' });
          const out = git(dir, ['log', '-12', '--format=%h%x09%s']);
          return json(res, 200, { commits: out.trim().split('\n').filter(Boolean).map(l => { const [sha, ...m] = l.split('\t'); return { sha, msg: m.join('\t') }; }) });
        }
        if (p === '/api/diff' && req.method === 'GET') {
          const repo = g().repos.find(r => r.id === url.searchParams.get('repo'));
          const commit = url.searchParams.get('commit') || 'HEAD';
          const dir = repo && (repo.local_path || repo.url);
          if (!dir || !fs.existsSync(dir)) return json(res, 400, { error: 'repo not available locally; paste unified diff in the UI instead' });
          const base = commit === 'HEAD' ? 'HEAD~1' : commit + '^';
          return json(res, 200, { diff: git(dir, ['diff', '--unified=3', base, commit === 'HEAD' ? 'HEAD' : commit]) });
        }
        if (p === '/api/code' && req.method === 'GET') {
          const graph = g();
          const n = graph.nodes.get(url.searchParams.get('id') || '');
          if (!n || !n.file || n.start_line == null) return json(res, 404, { error: 'no source range' });
          const repo = graph.repos.find(r => r.id === n.repo);
          const dir = repo && (repo.local_path || repo.url);
          if (!dir || !fs.existsSync(dir)) return json(res, 404, { error: 'source not available locally (indexed from URL)' });
          const file = path.join(dir, n.file);
          if (!fs.existsSync(file)) return json(res, 404, { error: 'file missing in checkout' });
          const lines = fs.readFileSync(file, 'utf8').split('\n');
          const from = Math.max(0, n.start_line - 1), to = Math.min(lines.length, n.end_line);
          return json(res, 200, { file: n.file, from: n.start_line, text: lines.slice(from, to).join('\n') });
        }
        if (p === '/api/global-config' && req.method === 'GET') {
          return json(res, 200, { global: getGlobalConfig(db), defaults: DEFAULT_CONFIG });
        }
        if (p === '/api/global-config' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.config || typeof body.config !== 'object') return json(res, 400, { error: 'config object required' });
          setGlobalConfig(db, body.config);
          let stats = [];
          if (body.reindex) {
            for (const repo of g().repos) {
              try {
                stats.push(await ingestRepo(db, { source: repo.local_path || repo.url, name: repo.id, full: true }));
              } catch (e) { stats.push({ repo: repo.id, error: e.message }); }
            }
          }
          return json(res, 200, { saved: true, reindexed: stats.length > 0, stats });
        }
        if (p === '/api/analyze' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.source) return json(res, 400, { error: 'source required (path or git URL)' });
          const stats = await ingestRepo(db, { source: body.source, name: body.name, branch: body.branch, full: !!body.full });
          return json(res, 200, stats);
        }
        if (p === '/api/reindex' && req.method === 'POST') {
          const body = await readBody(req);
          const repo = g().repos.find(r => r.id === body.name);
          if (!repo) return json(res, 404, { error: 'unknown repo' });
          const stats = await ingestRepo(db, { source: repo.local_path || repo.url, name: repo.id, full: true });
          return json(res, 200, stats);
        }
        if (p === '/api/remove' && req.method === 'POST') {
          const body = await readBody(req);
          deleteRepo(db, body.name);
          return json(res, 200, { removed: body.name });
        }
        return json(res, 404, { error: 'unknown API route: ' + p });
      }
      // static web UI
      let file = p === '/' ? '/index.html' : p;
      const full = path.normalize(path.join(WEB_DIR, file));
      if (!full.startsWith(WEB_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
  return server;
}

export function startServe(dbPath, port = 3111, host = '127.0.0.1') {
  const server = createAppServer(dbPath);
  return new Promise(resolve => {
    server.listen(port, host, () => {
      const addr = server.address();
      console.log(`CodeLoom web UI: http://${host}:${addr.port}  (db: ${dbPath})`);
      resolve(server);
    });
  });
}