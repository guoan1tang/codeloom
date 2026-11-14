// Ingestion orchestration: clone/ls-files → hash-skip incremental → two-pass parse → contract finalize.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as java from './packs/java.js';
import { emitTableEdges } from './packs/java.js';
import { loadConfig, loadFileConfig, DEFAULT_CONFIG } from './config.js';
import * as ts from './packs/typescript.js';
import { upsertRepo, insertNode, insertEdge, deleteFileData, loadGraph, getGlobalConfig } from './db.js';
import { finalizeContracts } from './contracts.js';
import { repoMeta, listFiles } from './diff.js';

const require = createRequire(import.meta.url);
// CJS build: the package's ESM bundle has a broken dynamic-require shim under Node ESM.
const { Parser, Language } = require('web-tree-sitter');
const WASM_DIR = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
const PACKS = [java, ts];

let initPromise = null;
const langCache = new Map();
export async function getParser(grammar) {
  initPromise ??= Parser.init();
  await initPromise;
  if (!langCache.has(grammar)) langCache.set(grammar, await Language.load(path.join(WASM_DIR, grammar + '.wasm')));
  const p = new Parser();
  p.setLanguage(langCache.get(grammar));
  return p;
}

export function packOf(file) {
  const ext = path.extname(file);
  return PACKS.find(p => p.extensions.includes(ext)) || null;
}

function scanMapperXml(ctx, content, file){
  const m = content.match(/<mapper[^>]*namespace="([^"]+)"/);
  if (!m) return 0;
  const typeId = ctx.fqnIndex.get(m[1]);
  if (!typeId) return 0;
  let n = 0;
  const re = /<(select|insert|update|delete)\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  let s;
  while ((s = re.exec(content))) {
    const id = s[2];
    const sql = s[3].replace(/<[^>]+>/g, ' ').replace(/#\{[^}]*\}/g, '?');
    emitTableEdges(ctx, typeId + '.' + id, sql, file + '#' + id);
    n++;
  }
  return n;
}

function makeCtx(repo, fileSet) {
  const ctx = {
    repo, file: '', lang: '', fileSet,
    nodes: new Map(), edges: [], edgesSnapshot: [],
    scopes: new Map(), pending: [], typeRels: [],
    typeIndex: new Map(), fqnIndex: new Map(), methodsOf: new Map(), impls: new Map(),
    fileExports: new Map(), feignServices: [], apiIfaces: new Map(), classBase: new Map(), entityTables: new Map(), mapperEntity: new Map(), implEntity: new Map(), httpWrappers: new Set(), stats: { unresolved: 0 },
  };
  ctx.node = n => {
    const global = n.type === 'endpoint' || n.type === 'topic' || n.type === 'table' || n.type === 'cache';
    n.repo = global ? (ctx.nodes.get(n.id)?.repo || '') : (n.repo || repo);
    n.file = global ? '' : (n.file ?? ctx.file);
    ctx.nodes.set(n.id, n);
    if (n.type === 'type') {
      if (n.fqn) ctx.fqnIndex.set(n.fqn, n.id);
    }
    return n;
  };
  ctx.edge = e => {
    e.file = e.file ?? ctx.file;
    ctx.edges.push(e);
    ctx.edgesSnapshot.push(e);
    return e;
  };
  ctx.typeIndexPush = (name, tid) => {
    if (!ctx.typeIndex.has(name)) ctx.typeIndex.set(name, []);
    if (ctx.typeIndex.get(name).includes(tid)) return;
    ctx.typeIndex.get(name).push(tid);
  };
  ctx.methodPush = (tid, name, mid) => {
    if (!ctx.methodsOf.has(tid)) ctx.methodsOf.set(tid, new Map());
    ctx.methodsOf.get(tid).set(name, mid);
  };
  ctx.implPush = (iface, cls) => {
    if (!ctx.impls.has(iface)) ctx.impls.set(iface, []);
    if (!ctx.impls.get(iface).includes(cls)) ctx.impls.get(iface).push(cls);
  };
  ctx.setEntry = (mid, entry) => { const n = ctx.nodes.get(mid); if (n) n.entry = entry; };
  return ctx;
}

function preload(ctx, db, repo, changedFiles) {
  // 1) symbol indexes span ALL repos so cross-service Feign calls resolve
  for (const r of db.prepare("SELECT id,type,label,fqn,repo FROM nodes").all()) {
    if (r.type === 'type') {
      if (r.fqn) ctx.fqnIndex.set(r.fqn, r.id);
      ctx.typeIndexPush(r.label, r.id);
    }
  }
  for (const e of db.prepare("SELECT s,t,rel FROM edges WHERE rel IN ('CONTAINS','IMPLEMENTS')").all()) {
    if (e.rel === 'IMPLEMENTS') { ctx.implPush(e.t, e.s); continue; }
    const t = db.prepare('SELECT type,label FROM nodes WHERE id=?').get(e.t);
    if (t && t.type === 'method') ctx.methodPush(e.s, t.label.replace(/\(\)$/, ''), e.t);
  }
  // 2) this repo's nodes (+global contract nodes) join the flushed node set
  for (const r of db.prepare("SELECT * FROM nodes WHERE repo=? OR type IN ('endpoint','topic','table','cache')").all(repo)) {
    r.props = JSON.parse(r.props || '{}');
    ctx.nodes.set(r.id, r);
  }
  const changed = new Set(changedFiles);
  for (const e of db.prepare('SELECT * FROM edges').all()) {
    if (changed.has(e.file)) continue;
    ctx.edgesSnapshot.push(e);
  }
}

export async function ingestRepo(db, opts) {
  const { source } = opts;
  let dir, tmp = null, url = opts.url || '';
  const isUrl = /^(https?:\/\/|git@|ssh:\/\/)/.test(source);
  if (isUrl) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-'));
    dir = path.join(tmp, 'repo');
    const args = ['clone', '--quiet'];
    if (opts.branch) args.push('--branch', opts.branch);
    args.push('--depth', '50', source, dir);
    execFileSync('git', args, { stdio: 'pipe' });
    url = source;
  } else {
    dir = path.resolve(source);
    if (!url) { try { url = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { url = dir; } }
  }
  const name = opts.name || path.basename(dir).replace(/\.git$/, '');
  try {
    const meta = repoMeta(dir);
    const allFiles = listFiles(dir);
    const fileSet = new Set(allFiles);
    const supported = allFiles.filter(f => packOf(f));
    const xmlFiles = allFiles.filter(f => /\.xml$/i.test(f));
    const oldHashes = new Map(db.prepare('SELECT path,hash FROM files WHERE repo=?').all(name).map(r => [r.path, r.hash]));
    const changedFiles = [];
    const contents = new Map();
    for (const f of supported.concat(xmlFiles)) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      const hash = crypto.createHash('sha1').update(content).digest('hex');
      contents.set(f, { content, hash });
      if (opts.full || oldHashes.get(f) !== hash) changedFiles.push(f);
    }
    const ctx = makeCtx(name, fileSet);
    const globalCfg = getGlobalConfig(db) || {};
    const fileCfg = loadFileConfig(dir);
    let cfg = { ...DEFAULT_CONFIG, ...globalCfg, ...fileCfg };
    cfg.pathAliases = { ...(DEFAULT_CONFIG.pathAliases || {}), ...(globalCfg.pathAliases || {}), ...(fileCfg.pathAliases || {}) };
    cfg.gatewayRouters = [...(globalCfg.gatewayRouters || []), ...(fileCfg.gatewayRouters || [])];
    if (opts.configOverride) cfg = { ...cfg, ...opts.configOverride, pathAliases: { ...cfg.pathAliases, ...(opts.configOverride.pathAliases || {}) } };
    ctx.config = cfg;
    // files that wrap axios (class HttpApi / request helper) → their verb calls are API calls
    for (const [f, c] of contents) {
      if (!/\.(ts|tsx|js|jsx)$/i.test(f)) continue;
      if (/(?:from\s+['"]axios['"]|require\(['"]axios['"]\))/.test(c.content) && /axios\.(request|get|post|put|delete)/i.test(c.content)) ctx.httpWrappers.add(f);
    }
    preload(ctx, db, name, changedFiles);
    ctx.node({ id: `${name}#repo`, type: 'repo', label: name, props: { url, branch: meta.branch } });
    let skipped = supported.length + xmlFiles.length - changedFiles.length;
    const xmlChanged = changedFiles.filter(f => !packOf(f));
    const javaChanged = changedFiles.filter(f => packOf(f));
    for (const f of javaChanged) {
      const { content, hash } = contents.get(f);
      deleteFileData(db, name, f);
      const pack = packOf(f);
      const parser = await getParser(pack.grammarFor ? pack.grammarFor(f) : pack.grammar);
      const tree = parser.parse(content);
      ctx.file = f; ctx.lang = pack.id;
      ctx.node({ id: `${name}#${f}`, type: 'file', label: f, lang: pack.id });
      ctx.edge({ s: `${name}#repo`, t: `${name}#${f}`, rel: 'CONTAINS' });
      pack.pass1(ctx, tree);
      db.prepare('INSERT OR REPLACE INTO files(repo,path,lang,hash,loc) VALUES(?,?,?,?,?)')
        .run(name, f, pack.id, hash, content.split('\n').length);
      tree.delete(); parser.delete();
    }
    // mapper XML statements → table edges (after pass1 so the namespace resolves)
    for (const f of xmlChanged) {
      deleteFileData(db, name, f);
      const { content, hash } = contents.get(f);
      ctx.file = f;
      scanMapperXml(ctx, content, f);
      db.prepare('INSERT OR REPLACE INTO files(repo,path,lang,hash,loc) VALUES(?,?,?,?,?)')
        .run(name, f, 'xml', hash, content.split('\n').length);
    }
    // two phases: register all types/impls first, then resolve call sites against the complete index
    for (const f of javaChanged) { ctx.file = f; packOf(f).pass2Types(ctx, f); }
    for (const f of javaChanged) { ctx.file = f; packOf(f).pass2Calls(ctx, f); }
    // delegated table access: helper(registryOrMapper, …) runs the query inside, so the
    // table edges live on the helper — attribute them to the call site as well
    const tableByMethod = new Map();
    for (const e of ctx.edges) {
      if (e.rel !== 'READS_TABLE' && e.rel !== 'WRITES_TABLE') continue;
      if (!tableByMethod.has(e.s)) tableByMethod.set(e.s, []);
      tableByMethod.get(e.s).push(e);
    }
    for (const e of ctx.edges.slice()) {
      if (e.rel !== 'CALLS' || !/arg0repo/.test(e.ev || '')) continue;
      for (const t of tableByMethod.get(e.t) || []) {
        ctx.edge({ s: e.s, t: t.t, rel: t.rel, site: e.site, file: e.file, ev: '经由仓库参数委托' });
      }
    }
    // flush
    db.exec('BEGIN');
    for (const n of ctx.nodes.values()) insertNode(db, n);
    for (const e of ctx.edges) insertEdge(db, e);
    const langs = {};
    for (const f of supported) { const p = packOf(f); langs[p.id] = (langs[p.id] || 0) + 1; }
    const lang = Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    upsertRepo(db, { id: name, name, url, local_path: dir, branch: meta.branch || opts.branch || '', lang, commit_sha: meta.commit, indexed_at: Date.now(), status: 'indexed' });
    db.exec('COMMIT');
    if (opts.full) {
      // full rebuild: contract join nodes are global (no file ownership) — drop orphans
      db.exec("DELETE FROM nodes WHERE type IN ('endpoint','topic','table','cache') AND id NOT IN (SELECT s FROM edges UNION SELECT t FROM edges)");
    }
    const graph = loadGraph(db);
    finalizeContracts(db, graph);
    const counts = db.prepare('SELECT (SELECT COUNT(*) FROM nodes WHERE repo=?) AS n, (SELECT COUNT(*) FROM edges) AS e').get(name);
    return { repo: name, parsed: changedFiles.length, skipped, nodes: counts.n, edges: counts.e, unresolved: ctx.stats.unresolved, commit: meta.commit };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}