#!/usr/bin/env node
// CodeLoom CLI — zero native deps. Install: npx codeloom analyze <repo>
import fs from 'node:fs';
import { openDb, defaultDbPath, loadGraph, deleteRepo } from './db.js';
import { ingestRepo } from './ingest.js';
import { graphStatus } from './graph.js';
import { startMcp } from './mcp.js';

const HELP = `CodeLoom — code knowledge graph for agents (call graph + cross-repo contracts, MCP-native)

Usage:
  codeloom analyze <path|git-url>   Index a repository (incremental by file hash)
      --name <n>                    Repository name in the graph (default: dir name)
      --branch <b>                  Branch to clone (URL mode)
      --full                        Force full re-parse (refreshes cross-file dispatch)
      --db <path>                   Graph database (default ~/.codeloom/graph.db, env CODELOOM_DB)
  codeloom list                     List indexed repositories
  codeloom status [--json]          Index freshness + static test coverage per repo
  codeloom remove <name>            Remove a repository from the graph
  codeloom mcp                      Start the MCP server (stdio) for agents
  codeloom serve [--port 3111]      Web UI + JSON API on http://127.0.0.1:3111
  codeloom help                     This help

Agent setup:
  claude mcp add codeloom -- npx -y codeloom mcp

Requires Node >= 22.13 (built-in node:sqlite). No compilation, no database service, code never leaves your machine.
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (['full', 'json'].includes(key)) args[key] = true;
      else args[key] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  const dbPath = args.db || defaultDbPath();
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  if (cmd === 'mcp') { await startMcp(dbPath); return; }
  if (cmd === 'serve') {
    const { startServe } = await import('./server.js');
    await startServe(dbPath, parseInt(args.port || '3111', 10), args.host || '127.0.0.1');
    return;
  }
  const db = openDb(dbPath);
  if (cmd === 'analyze') {
    const source = args._[1];
    if (!source) { console.error('analyze requires a path or git URL'); process.exit(1); }
    const t0 = Date.now();
    const stats = await ingestRepo(db, { source, name: args.name, branch: args.branch, full: !!args.full });
    console.log(`✓ ${stats.repo} indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  parsed ${stats.parsed} files · skipped ${stats.skipped} unchanged · ${stats.nodes} nodes · ${stats.edges} edges total`);
    console.log(`  commit ${stats.commit.slice(0, 7)} · unresolved call sites ${stats.unresolved}`);
    console.log(`  db: ${dbPath}`);
  } else if (cmd === 'list') {
    const rows = db.prepare('SELECT * FROM repos ORDER BY name').all();
    if (!rows.length) { console.log('no repositories indexed yet — run: codeloom analyze <path|url>'); return; }
    for (const r of rows) console.log(`${r.name.padEnd(28)} ${String(r.lang).padEnd(12)} ${r.commit_sha.slice(0, 7)}  ${r.branch || '-'}  ${r.url}`);
  } else if (cmd === 'status') {
    const st = graphStatus(loadGraph(db), db);
    if (args.json) { console.log(JSON.stringify(st, null, 2)); return; }
    console.log(`totals: ${st.totals.repos} repos · ${st.totals.nodes} nodes · ${st.totals.edges} edges · ${st.totals.crossRepoEdges} cross-repo · ${st.totals.testMethods} tests`);
    for (const r of st.repos) console.log(`${r.repo.padEnd(28)} commit ${String(r.indexedCommit).slice(0, 7)}  tests ${String(r.testMethods).padStart(3)}  static coverage ${String(r.staticCoverage).padStart(3)}%${r.stale ? '  ⚠ stale' : ''}`);
    if (st.freshnessWarnings.length) console.log('freshness warnings: ' + st.freshnessWarnings.join(', '));
  } else if (cmd === 'remove') {
    const name = args._[1];
    if (!name) { console.error('remove requires a repo name'); process.exit(1); }
    deleteRepo(db, name);
    console.log(`✓ removed ${name}`);
  } else {
    const looksLikeRepo = fs.existsSync(cmd) || /^(https?:\/\/|git@)/.test(cmd) || cmd.endsWith('.git');
    console.error(looksLikeRepo
      ? `unknown command: ${cmd} — did you mean \`codeloom analyze ${cmd}\`?`
      : 'unknown command: ' + cmd);
    console.log(HELP);
    process.exit(1);
  }
}

main().catch(e => { console.error('error: ' + e.message); process.exit(1); });