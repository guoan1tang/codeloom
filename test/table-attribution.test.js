// Regression cases from the roster-audit/page trace diagnosis (2026-11-14).
//
// java-table-naming: table-name derivation — convention fallback for suffixed
//   entities, @TableName precedence, MyBatis-Plus CRUD read/write classification.
// java-roster-chain: end-to-end replica of the real customer-service chain —
//   bare-name entities (ShopGroup/UserPermission/ShopInfo, no @TableName, no
//   suffix) and queries delegated through a generic IService<T> utility must
//   still attribute all five tables to the right methods.
// graph_query: same-name methods in different classes must be disambiguated
//   (the real expandDeptToShopIds pair caused a false table attribution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupFixture, assertFixture } from './harness/index.js';
import { createServer } from '../src/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

test('java-table-naming: convention fallback, annotation precedence, MP CRUD read/write', async (t) => {
  const fx = await setupFixture(t, 'java-table-naming');
  assertFixture(fx.g, 'java-table-naming');
});

test('java-roster-chain: all five tables attributed along the real call chain', async (t) => {
  const fx = await setupFixture(t, 'java-roster-chain');
  assertFixture(fx.g, 'java-roster-chain');
});

test('graph_query: same-name methods return distinct ids with fqn and ambiguous flag', async (t) => {
  const fx = await setupFixture(t, 'java-roster-chain');
  const server = createServer(fx.dbPath);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const res = await client.callTool({
    name: 'graph_query',
    arguments: { query: "MATCH (c:Type)-[:CONTAINS]->(m:Method) WHERE m.name = 'expandDeptToShopIds' RETURN m" },
  });
  const q = JSON.parse(res.content[0].text);
  assert.equal(q.count, 2, 'both same-name methods must be returned');
  assert.equal(new Set(q.results.map(r => r.id)).size, 2, 'distinct full ids');
  for (const r of q.results) {
    assert.ok(r.fqn, 'fqn present for disambiguation');
    assert.equal(r.ambiguous, true, 'ambiguous flag set on same-label results');
  }
  assert.ok(q.results.some(r => r.id.includes('UserShopCorrelationManager')));
  assert.ok(q.results.some(r => r.id.includes('ShopGroupJobService')));
});