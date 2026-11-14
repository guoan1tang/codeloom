// Test harness: turn a fixture directory into an indexed graph, then assert
// declarative expectations from <fixture>/expect.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, loadGraph, setGlobalConfig } from '../../src/db.js';
import { ingestRepo } from '../../src/ingest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(HERE, '..', 'fixtures');

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

/** Copy a fixture to a temp dir, git-init it, index it, and return the graph. */
export async function indexFixture(name, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-fx-'));
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(FIXTURES_DIR, name), dir, {
    recursive: true,
    filter: s => !s.includes('/.git'),
  });
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture']);
  const dbPath = path.join(tmp, 'graph.db');
  const db = openDb(dbPath);
  await ingestRepo(db, { source: dir, ...opts });
  const g = loadGraph(db);
  return { g, db, dbPath, dir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/**
 * Index a multi-repo fixture group: every subdirectory is its own git repo,
 * indexed into one database. Optional <group>/global-config.json is applied first.
 */
export async function indexGroup(name, opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-grp-'));
  const groupDir = path.join(FIXTURES_DIR, name);
  const subdirs = fs.readdirSync(groupDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();
  const dirs = [];
  for (const sub of subdirs) {
    const dir = path.join(tmp, sub);
    fs.cpSync(path.join(groupDir, sub), dir, { recursive: true, filter: s => !s.includes('/.git') });
    git(dir, ['init', '-q']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fixture']);
    dirs.push({ name: sub, dir });
  }
  const dbPath = path.join(tmp, 'graph.db');
  const db = openDb(dbPath);
  const gcfgFile = path.join(groupDir, 'global-config.json');
  if (fs.existsSync(gcfgFile)) setGlobalConfig(db, JSON.parse(fs.readFileSync(gcfgFile, 'utf8')));
  for (const { name: sub, dir } of dirs) await ingestRepo(db, { source: dir, name: sub, ...opts });
  const g = loadGraph(db);
  return { g, db, dbPath, dirs, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

export async function setupGroup(t, name, opts = {}) {
  const fx = await indexGroup(name, opts);
  t.after(() => fx.cleanup());
  return fx;
}

/** node:test helper — indexes the fixture and registers cleanup. */
export async function setupFixture(t, name, opts = {}) {
  const fx = await indexFixture(name, opts);
  t.after(() => fx.cleanup());
  return fx;
}

/**
 * Resolve a shorthand reference to a node id.
 * Accepts a full node id, or "Class.method" / "method()" / "Class" / "ep:POST /path" / "topic:x".
 */
export function resolveNode(g, ref) {
  if (g.nodes.has(ref)) return ref;
  const parts = String(ref).replace(/\(\)$/, '').split('.');
  const name = parts[parts.length - 1];
  const owner = parts.length > 1 ? parts[parts.length - 2] : null;
  const matches = [];
  for (const n of g.nodes.values()) {
    if (n.label !== name && n.label !== name + '()') continue;
    if (owner && !(n.fqn || '').endsWith(owner + '.' + name)) continue;
    matches.push(n);
  }
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) throw new Error(`node not found: ${ref}`);
  throw new Error(`ambiguous reference ${ref}: ${matches.map(m => m.id).join(' | ')}`);
}

export function expectEdge(g, s, t, rel, opts = {}) {
  const sid = resolveNode(g, s), tid = resolveNode(g, t);
  const edge = g.edges.find(e => e.s === sid && e.t === tid && e.rel === rel);
  assert.ok(edge, `missing edge ${s} -[${rel}]-> ${t}`);
  if (opts.conf) assert.equal(edge.conf, opts.conf, `edge ${s} -[${rel}]-> ${t} confidence`);
  if (opts.ev) assert.ok(String(edge.ev || '').includes(opts.ev), `edge ${s} -[${rel}]-> ${t} evidence`);
}

export function expectNoOutgoing(g, ref, rel) {
  const id = resolveNode(g, ref);
  const edges = (g.out.get(id) || []).filter(e => e.rel === rel);
  assert.equal(edges.length, 0, 'unexpected outgoing ' + rel + ' from ' + ref + ': ' + edges.map(e => e.t).join(', '));
}

export function expectNoNode(g, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const hits = [...g.nodes.values()].filter(n => re.test(n.label || '') || re.test(n.fqn || '') || re.test(n.file || ''));
  assert.equal(hits.length, 0, 'unexpected nodes matching ' + re + ': ' + hits.slice(0, 3).map(n => n.id).join(', '));
}

export function expectNoEdge(g, s, t, rel) {
  const sid = resolveNode(g, s), tid = resolveNode(g, t);
  assert.ok(!g.edges.some(e => e.s === sid && e.t === tid && e.rel === rel), `unexpected edge ${s} -[${rel}]-> ${t}`);
}

export function expectNode(g, ref, props = {}, extra = {}) {
  const id = resolveNode(g, ref);
  const n = g.nodes.get(id);
  for (const [k, v] of Object.entries(props)) {
    const actual = k.includes('.') ? k.split('.').reduce((o, p) => (o == null ? o : o[p]), n) : (n[k] !== undefined ? n[k] : (n.props || {})[k]);
    if (typeof v === 'string' && v.startsWith('~')) assert.ok(String(actual || '').includes(v.slice(1)), `${ref}.${k} should contain "${v.slice(1)}" (got "${actual}")`);
    else assert.deepEqual(actual, v, `${ref}.${k}`);
  }
  if (extra.type) assert.equal(n.type, extra.type, `${ref}.type`);
}

export function graphSummary(g) {
  const s = { repos: 0, files: 0, methods: 0, endpoints: 0, topics: 0, tables: 0, caches: 0, pages: 0, http: 0, mq: 0, job: 0, test: 0 };
  for (const n of g.nodes.values()) {
    if (n.type === 'repo') s.repos++;
    else if (n.type === 'file') s.files++;
    else if (n.type === 'method') s.methods++;
    else if (n.type === 'endpoint') s.endpoints++;
    else if (n.type === 'topic') s.topics++;
    else if (n.type === 'table') s.tables++;
    else if (n.type === 'cache') s.caches++;
    else if (n.type === 'page') s.pages++;
    if (n.entry === 'http') s.http++;
    else if (n.entry === 'mq') s.mq++;
    else if (n.entry === 'job') s.job++;
    else if (n.entry === 'test' || n.type === 'test') s.test++;
  }
  return s;
}

/** Run <fixture>/expect.json against a graph. */
export function assertFixture(g, name) {
  const file = path.join(FIXTURES_DIR, name, 'expect.json');
  const expect = JSON.parse(fs.readFileSync(file, 'utf8'));
  let checked = 0;
  for (const e of expect.edges || []) {
    expectEdge(g, e.s, e.t, e.rel, e);
    checked++;
  }
  for (const e of expect.noEdges || []) {
    expectNoEdge(g, e.s, e.t, e.rel);
    checked++;
  }
  for (const e of expect.noOutgoing || []) {
    expectNoOutgoing(g, e.s, e.rel);
    checked++;
  }
  for (const pattern of expect.noNodes || []) {
    expectNoNode(g, pattern);
    checked++;
  }
  for (const n of expect.nodes || []) {
    expectNode(g, n.id || n.ref, n.props || {}, { type: n.type });
    checked++;
  }
  let summary = null;
  if (expect.summary) {
    summary = graphSummary(g);
    for (const [k, v] of Object.entries(expect.summary)) {
      assert.equal(summary[k], v, `summary.${k}`);
      checked++;
    }
  }
  return { checked, summary };
}