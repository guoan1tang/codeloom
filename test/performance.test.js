// Performance smoke: generate a synthetic repository and make sure full and
// incremental indexing stay within generous CI budgets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { ingestRepo } from '../src/ingest.js';

const CLASSES = 300;
const METHODS = 5;

function buildRepo(dir) {
  const src = path.join(dir, 'src/main/java/com/acme/gen');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pom.xml'),
    '<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.acme</groupId><artifactId>gen</artifactId><version>1.0.0</version></project>');
  for (let i = 0; i < CLASSES; i++) {
    const next = (i + 1) % CLASSES;
    const methods = Array.from({ length: METHODS }, (_, j) =>
      `  public void m${j}() { new S${next}().m${(j + 1) % METHODS}(); }`).join('\n');
    fs.writeFileSync(path.join(src, `S${i}.java`),
      `package com.acme.gen;\n\npublic class S${i} {\n${methods}\n}\n`);
  }
  fs.writeFileSync(path.join(src, 'ApiController.java'),
    'package com.acme.gen;\n\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class ApiController {\n  @GetMapping("/gen/ping")\n  public String ping() { new S0().m0(); return "pong"; }\n}\n');
}

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

test('performance: 300-class synthetic repo indexes fast and incrementally', { timeout: 120000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-perf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  buildRepo(tmp);
  git(tmp, ['init', '-q']);
  git(tmp, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  git(tmp, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'gen']);

  const db = openDb(path.join(tmp, 'graph.db'));
  const t0 = Date.now();
  const full = await ingestRepo(db, { source: tmp });
  const fullMs = Date.now() - t0;
  assert.ok(full.parsed >= CLASSES, 'all classes parsed');
  assert.ok(fullMs < 20000, `full index took ${fullMs}ms (budget 20000ms)`);

  fs.appendFileSync(path.join(tmp, 'src/main/java/com/acme/gen/S0.java'), '\n// touch\n');
  const t1 = Date.now();
  const inc = await ingestRepo(db, { source: tmp });
  const incMs = Date.now() - t1;
  assert.equal(inc.parsed, 1, 'incremental re-parses only the changed file');
  assert.ok(incMs < 5000, `incremental index took ${incMs}ms (budget 5000ms)`);
});