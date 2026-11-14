// SQLite persistence via node:sqlite — zero native dependencies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import path from 'node:path';

export function defaultDbPath() {
  return process.env.CODELOOM_DB || path.join(os.homedir(), '.codeloom', 'graph.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos(
  id TEXT PRIMARY KEY, name TEXT, url TEXT, branch TEXT, lang TEXT,
  commit_sha TEXT, indexed_at INTEGER, status TEXT DEFAULT 'indexed', note TEXT
);
CREATE TABLE IF NOT EXISTS files(
  repo TEXT, path TEXT, lang TEXT, hash TEXT, loc INTEGER, PRIMARY KEY(repo, path)
);
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY, repo TEXT, type TEXT, kind TEXT, label TEXT, fqn TEXT,
  lang TEXT, file TEXT, start_line INTEGER, end_line INTEGER, entry TEXT, props TEXT
);
CREATE TABLE IF NOT EXISTS edges(
  s TEXT, t TEXT, rel TEXT, conf TEXT DEFAULT '', ev TEXT DEFAULT '',
  site TEXT DEFAULT '', file TEXT DEFAULT '',
  PRIMARY KEY(s, t, rel, site)
);
CREATE INDEX IF NOT EXISTS idx_edges_s ON edges(s);
CREATE INDEX IF NOT EXISTS idx_edges_t ON edges(t);
CREATE INDEX IF NOT EXISTS idx_nodes_repo ON nodes(repo);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file);
CREATE INDEX IF NOT EXISTS idx_edges_file ON edges(file);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`;

export function openDb(dbPath = defaultDbPath()) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const cols = db.prepare('PRAGMA table_info(repos)').all();
  if (!cols.some(c => c.name === 'local_path')) db.exec("ALTER TABLE repos ADD COLUMN local_path TEXT DEFAULT ''");
  return db;
}

export function upsertRepo(db, r) {
  db.prepare(`INSERT INTO repos(id,name,url,branch,lang,commit_sha,indexed_at,status,note,local_path)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, branch=excluded.branch,
      lang=excluded.lang, commit_sha=excluded.commit_sha, indexed_at=excluded.indexed_at,
      status=excluded.status, note=excluded.note, local_path=excluded.local_path`)
    .run(r.id, r.name, r.url || '', r.branch || '', r.lang || '', r.commit_sha || '', r.indexed_at || Date.now(), r.status || 'indexed', r.note || '', r.local_path || '');
}

export function insertNode(db, n) {
  db.prepare(`INSERT INTO nodes(id,repo,type,kind,label,fqn,lang,file,start_line,end_line,entry,props)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET repo=excluded.repo, type=excluded.type, kind=excluded.kind,
      label=excluded.label, fqn=excluded.fqn, lang=excluded.lang, file=excluded.file,
      start_line=excluded.start_line, end_line=excluded.end_line, entry=excluded.entry, props=excluded.props`)
    .run(n.id, n.repo, n.type, n.kind || '', n.label, n.fqn || '', n.lang || '', n.file || '',
      n.start_line ?? null, n.end_line ?? null, n.entry || '', JSON.stringify(n.props || {}));
}

export function insertEdge(db, e) {
  db.prepare(`INSERT OR IGNORE INTO edges(s,t,rel,conf,ev,site,file) VALUES(?,?,?,?,?,?,?)`)
    .run(e.s, e.t, e.rel, e.conf || '', e.ev || '', e.site || '', e.file || '');
}

export function deleteFileData(db, repo, file) {
  db.prepare('DELETE FROM nodes WHERE repo=? AND file=?').run(repo, file);
  // edges.file is repo-relative: scope by source-node repo prefix so a copy of a
  // repo under another name cannot wipe the original's edges for same-named files
  db.prepare("DELETE FROM edges WHERE file=? AND s LIKE ? || '#%'").run(file, repo);
  db.prepare('DELETE FROM files WHERE repo=? AND path=?').run(repo, file);
}

export function deleteRepo(db, id) {
  const rows = db.prepare('SELECT id,type FROM nodes WHERE repo=?').all(id);
  const scoped = rows.filter(n => n.type !== 'endpoint' && n.type !== 'topic').map(n => n.id);
  const globals = rows.filter(n => n.type === 'endpoint' || n.type === 'topic').map(n => n.id);
  const delEdge = db.prepare('DELETE FROM edges WHERE s=? OR t=?');
  for (const nid of scoped) delEdge.run(nid, nid);
  // global join nodes may be attributed to the deleted repo (last provider wins):
  // re-attribute to a remaining provider/consumer instead of deleting shared edges
  const repoOf = db.prepare('SELECT repo FROM nodes WHERE id=?');
  for (const gid of globals) {
    const edges = db.prepare('SELECT * FROM edges WHERE s=? OR t=?').all(gid, gid);
    let repo = '';
    for (const e of edges) {
      if (e.rel === 'EXPOSES' || e.rel === 'PRODUCES') { repo = (repoOf.get(e.s) || {}).repo || ''; if (repo) break; }
    }
    if (!repo) for (const e of edges) {
      repo = (repoOf.get(e.s) || {}).repo || (repoOf.get(e.t) || {}).repo || '';
      if (repo) break;
    }
    if (repo) db.prepare('UPDATE nodes SET repo=? WHERE id=?').run(repo, gid);
    else { db.prepare('DELETE FROM edges WHERE s=? OR t=?').run(gid, gid); db.prepare('DELETE FROM nodes WHERE id=?').run(gid); }
  }
  db.prepare('DELETE FROM nodes WHERE repo=?').run(id);
  db.prepare('DELETE FROM files WHERE repo=?').run(id);
  db.prepare('DELETE FROM repos WHERE id=?').run(id);
}

export function getGlobalConfig(db) {
  const row = db.prepare("SELECT v FROM meta WHERE k='global_config'").get();
  if (!row) return null;
  try { return JSON.parse(row.v); } catch { return null; }
}
export function setGlobalConfig(db, cfg) {
  db.prepare("INSERT INTO meta(k,v) VALUES('global_config',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
    .run(JSON.stringify(cfg || {}));
}

export function loadGraph(db) {
  const nodes = new Map();
  for (const r of db.prepare('SELECT * FROM nodes').all()) {
    r.props = JSON.parse(r.props || '{}');
    nodes.set(r.id, r);
  }
  const edges = db.prepare('SELECT * FROM edges').all()
    .filter(e => nodes.has(e.s) && nodes.has(e.t));
  const out = new Map(), inn = new Map(), callsIn = new Map();
  for (const e of edges) {
    if (!out.has(e.s)) out.set(e.s, []);
    if (!inn.has(e.t)) inn.set(e.t, []);
    out.get(e.s).push(e); inn.get(e.t).push(e);
    if (e.rel === 'CALLS') callsIn.set(e.t, (callsIn.get(e.t) || 0) + 1);
  }
  const repos = db.prepare('SELECT * FROM repos').all();
  return { nodes, edges, out, inn, callsIn, repos };
}