// Removing repositories must not leave orphaned global join nodes behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb, loadGraph, deleteRepo } from '../src/db.js';
import { ingestRepo } from '../src/ingest.js';
import { FIXTURES_DIR } from './harness/index.js';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

function stage(tmp, fixture, name) {
  const dir = path.join(tmp, name);
  fs.cpSync(path.join(FIXTURES_DIR, fixture), dir, { recursive: true, filter: s => !s.includes('/.git') });
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x']);
  return dir;
}

test('removing every repository leaves no orphaned global nodes', { timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-remove-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const db = openDb(path.join(tmp, 'graph.db'));
  await ingestRepo(db, { source: stage(tmp, 'java-basic-rest', 'svc-a') });
  await ingestRepo(db, { source: stage(tmp, 'java-events', 'svc-b') });
  assert.ok(loadGraph(db).nodes.size > 0);

  deleteRepo(db, 'svc-a');
  const mid = loadGraph(db);
  assert.equal(mid.repos.length, 1);
  assert.ok(mid.nodes.size > 0, 'svc-b stays indexed');

  deleteRepo(db, 'svc-b');
  const g = loadGraph(db);
  assert.equal(g.repos.length, 0);
  assert.equal(g.edges.length, 0);
  assert.equal(g.nodes.size, 0, 'orphaned endpoints/tables/caches remain: ' +
    [...g.nodes.values()].map(n => n.type + ':' + n.id).slice(0, 5).join(', '));
});