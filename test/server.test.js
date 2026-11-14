// HTTP API + static UI verification.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { ingestRepo } from '../src/ingest.js';
import { createAppServer } from '../src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let tmp, server, base;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-srv-'));
  for (const svc of ['inventory-service', 'order-service', 'web-frontend']) {
    fs.cpSync(path.join(HERE, 'fixtures', svc), path.join(tmp, svc), { recursive: true });
    const d = path.join(tmp, svc);
    execFileSync('git', ['-C', d, 'init', '-q']);
    execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
    execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  }
  const db = openDb(path.join(tmp, 'g.db'));
  for (const svc of ['inventory-service', 'order-service', 'web-frontend']) await ingestRepo(db, { source: path.join(tmp, svc) });
  server = createAppServer(path.join(tmp, 'g.db'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const get = async p => (await fetch(base + p)).json();

test('static UI served at /', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('CodeLoom'));
  assert.ok(html.includes('loadGraphFromServer'));
});

test('GET /api/graph returns live nodes/edges/repos', async () => {
  const g = await get('/api/graph');
  assert.equal(g.repos.length, 3);
  assert.ok(g.nodes.length > 50);
  assert.ok(g.edges.some(e => e.rel === 'CONSUMES'));
});

test('GET /api/status reports coverage', async () => {
  const st = await get('/api/status');
  assert.equal(st.totals.repos, 3);
  assert.ok(st.repos.find(r => r.repo === 'inventory-service').staticCoverage > 0);
});

test('GET /api/commits + /api/code serve real git/source data', async () => {
  const c = await get('/api/commits?repo=inventory-service');
  assert.ok(c.commits.length >= 1);
  const g = await get('/api/graph');
  const m = g.nodes.find(n => n.label === 'deductStock()' && n.repo === 'inventory-service');
  const code = await get('/api/code?id=' + encodeURIComponent(m.id));
  assert.ok(code.text.includes('deductStock'));
});

test('POST /api/remove mutates the index', async () => {
  const r = await fetch(base + '/api/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'web-frontend' }) });
  assert.equal(r.status, 200);
  const g = await get('/api/graph');
  assert.equal(g.repos.length, 2);
});

test('global config roundtrip', async () => {
  const d = await get('/api/global-config');
  assert.ok(d.defaults && d.defaults.gatewayRouters);
  const r = await fetch(base + '/api/global-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { gatewayRouters: [{ prefix: '/api-order', strip: 1 }] }, reindex: false }) });
  assert.equal(r.status, 200);
  const g2 = await get('/api/global-config');
  assert.equal(g2.global.gatewayRouters[0].prefix, '/api-order');
});

test('path traversal blocked', async () => {
  const r = await fetch(base + '/../package.json');
  assert.equal(r.status, 404);
});
