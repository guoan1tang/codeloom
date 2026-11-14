// CodeLoom P0 verification: parse → contracts → impact → test selection → incremental → MCP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, loadGraph } from '../src/db.js';
import { ingestRepo } from '../src/ingest.js';
import { impactAnalysis, testsForChange, impactOfDiff, graphStatus, searchSymbols } from '../src/graph.js';
import { createServer } from '../src/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');
let tmp, db, dbPath, g;

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
function gitInit(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codeloom-test-'));
  for (const svc of ['inventory-service', 'order-service', 'web-frontend']) {
    fs.cpSync(path.join(FIX, svc), path.join(tmp, svc), { recursive: true });
    gitInit(path.join(tmp, svc));
  }
  dbPath = path.join(tmp, 'graph.db');
  db = openDb(dbPath);
  for (const svc of ['inventory-service', 'order-service', 'web-frontend']) {
    await ingestRepo(db, { source: path.join(tmp, svc) });
  }
  g = loadGraph(db);
});
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const invImpl = 'inventory-service#src/main/java/com/demo/inventory/InventoryServiceImpl.java::com.demo.inventory.InventoryServiceImpl';
const invDeduct = invImpl + '.deductStock';
const invCtrlDeduct = 'inventory-service#src/main/java/com/demo/inventory/InventoryController.java::com.demo.inventory.InventoryController.deduct';
const orderCreate = 'order-service#src/main/java/com/demo/order/OrderServiceImpl.java::com.demo.order.OrderServiceImpl.createOrder';
const feignDeduct = 'order-service#src/main/java/com/demo/order/InventoryFeignClient.java::com.demo.order.InventoryFeignClient.deduct';

test('symbols: types and methods with source ranges', () => {
  const t = g.nodes.get(invImpl);
  assert.equal(t.type, 'type');
  assert.equal(t.kind, 'class');
  const m = g.nodes.get(invDeduct);
  assert.equal(m.type, 'method');
  assert.ok(m.start_line > 0 && m.end_line >= m.start_line);
});

test('DI dispatch: interface call + inferred impl edge', () => {
  const ifaceMethod = 'inventory-service#src/main/java/com/demo/inventory/InventoryService.java::com.demo.inventory.InventoryService.deductStock';
  const direct = g.edges.find(e => e.s === invCtrlDeduct && e.t === ifaceMethod && e.rel === 'CALLS');
  assert.ok(direct, 'controller → interface method');
  const dispatch = g.edges.find(e => e.s === ifaceMethod && e.t === invDeduct && e.rel === 'CALLS');
  assert.ok(dispatch, 'interface → impl dispatch');
  assert.equal(dispatch.conf, 'inferred');
});

test('cross-repo HTTP contract: Feign consumer meets provider endpoint', () => {
  const ep = 'ep:POST /inventory/deduct';
  assert.ok(g.nodes.has(ep));
  assert.ok(g.edges.some(e => e.s === invCtrlDeduct && e.t === ep && e.rel === 'EXPOSES'));
  assert.ok(g.edges.some(e => e.s === feignDeduct && e.t === ep && e.rel === 'CONSUMES'));
  assert.equal(g.nodes.get(ep).repo, 'inventory-service');
});

test('cross-repo MQ contract: producer meets subscriber', () => {
  const t = 'topic:stock-low';
  assert.ok(g.edges.some(e => e.s === invDeduct && e.t === t && e.rel === 'PRODUCES'));
  const consumer = 'order-service#src/main/java/com/demo/order/StockLowConsumer.java::com.demo.order.StockLowConsumer.onMessage';
  assert.ok(g.edges.some(e => e.s === consumer && e.t === t && e.rel === 'SUBSCRIBES'));
  assert.equal(g.nodes.get(consumer).entry, 'mq');
});

test('data layer: mapper XML, @Select and redis key calls', () => {
  const mapper = 'order-service#src/main/java/com/demo/order/mapper/OrderMapper.java::com.demo.order.mapper.OrderMapper';
  assert.ok(g.edges.some(e => e.s === mapper + '.selectById' && e.t === 'table:t_order' && e.rel === 'READS_TABLE'), 'xml select → t_order read');
  assert.ok(g.edges.some(e => e.s === mapper + '.touch' && e.t === 'table:t_order' && e.rel === 'WRITES_TABLE'), 'xml update → t_order write');
  assert.ok(g.edges.some(e => e.s === mapper + '.countAudit' && e.t === 'table:t_order_audit' && e.rel === 'READS_TABLE'), '@Select → t_order_audit');
  const cache = 'order-service#src/main/java/com/demo/order/cache/OrderCache.java::com.demo.order.cache.OrderCache.get';
  assert.ok(g.edges.some(e => e.s === cache && e.t === 'cache:order:cache' && e.rel === 'USES_CACHE'), 'redis key edge');
});

test('MyBatis-Plus BaseMapper + @TableName and Spring @Cacheable', () => {
  const load = 'order-service#src/main/java/com/demo/order/service/OrderCrudService.java::com.demo.order.service.OrderCrudService.load';
  const save = 'order-service#src/main/java/com/demo/order/service/OrderCrudService.java::com.demo.order.service.OrderCrudService.save';
  assert.ok(g.edges.some(e => e.s === load && e.t === 'table:t_order_entity' && e.rel === 'READS_TABLE'), 'selectById → table read');
  assert.ok(g.edges.some(e => e.s === save && e.t === 'table:t_order_entity' && e.rel === 'WRITES_TABLE'), 'insert → table write');
  const cached = 'order-service#src/main/java/com/demo/order/cache/OrderCache.java::com.demo.order.cache.OrderCache.getCached';
  const evict = 'order-service#src/main/java/com/demo/order/cache/OrderCache.java::com.demo.order.cache.OrderCache.evict';
  assert.ok(g.edges.some(e => e.s === cached && e.t === 'cache:orderDetailCache' && e.rel === 'USES_CACHE'), '@Cacheable edge');
  assert.ok(g.edges.some(e => e.s === evict && e.t === 'cache:orderDetailCache' && e.rel === 'USES_CACHE'), '@CacheEvict edge');
});

test('config: gateway prefix stripping stitches frontend to backend endpoint', () => {
  const fn='web-frontend#src/api/gateway.ts::createViaGateway';
  assert.ok(g.edges.some(e=>e.s===fn&&e.t==='ep:POST /orders'&&e.rel==='CALLS_API'), 'prefixed path stripped to canonical endpoint');
  assert.equal(g.nodes.get('ep:POST /orders').repo, 'order-service');
});

test('JPA repositories: JpaRepository Entity → table, @Query SQL', () => {
  const load='order-service#src/main/java/com/demo/order/service/JpaOrderService.java::com.demo.order.service.JpaOrderService.load';
  assert.ok(g.edges.some(e=>e.s===load&&e.t==='table:t_order_entity'&&e.rel==='READS_TABLE'), 'findById → @TableName table');
  const q='order-service#src/main/java/com/demo/order/repo/JpaOrderRepository.java::com.demo.order.repo.JpaOrderRepository.countByStatus';
  assert.ok(g.edges.some(e=>e.s===q&&e.t==='table:t_jpa_order'&&e.rel==='READS_TABLE'), '@Query SQL tables');
});

test('frontend: object-literal API modules call wrappers', () => {
  const list='web-frontend#src/api/modules.ts::OrderApi.list';
  assert.ok(g.edges.some(e=>e.s===list&&e.t==='ep:GET /orders/list'&&e.rel==='CALLS_API'), 'object method → CALLS_API');
});

test('frontend: singular src/page dirs and axios wrapper clients', () => {
  const page='page:web-frontend:/home';
  assert.ok(g.nodes.has(page), 'src/page file becomes a page node');
  const fn='web-frontend#src/page/home.ts::loadHome';
  assert.ok(g.edges.some(e=>e.s===page&&e.t===fn&&e.rel==='CONTAINS'), 'page contains handler');
  assert.ok(g.edges.some(e=>e.s===fn&&e.t==='ep:GET /home/data'&&e.rel==='CALLS_API'), 'wrapper call becomes CALLS_API');
});

test('javadoc and ApiOperation are searchable metadata', () => {
  const api = 'inventory-service#src/main/java/com/demo/inventory/api/InventoryApi.java::com.demo.inventory.api.InventoryApi';
  const m = 'inventory-service#src/main/java/com/demo/inventory/api/InventoryApi.java::com.demo.inventory.api.InventoryApi.deduct';
  assert.ok((g.nodes.get(api).props.doc || '').includes('库存服务对外契约'));
  assert.ok((g.nodes.get(m).props.doc || '').includes('扣减指定 SKU 的库存数量'));
  assert.equal(g.nodes.get(m).props.apidoc, '扣减库存');
  const hits = searchSymbols(g, '扣减指定', 5);
  assert.ok(hits.some(n => n.id === m), 'doc text searchable');
});

test('cross-repo Feign call: caller method resolves into the other repo interface', () => {
  const caller = 'order-service#src/main/java/com/demo/order/client/InventoryApiClient.java::com.demo.order.client.InventoryApiClient.callDeduct';
  const target = 'inventory-service#src/main/java/com/demo/inventory/api/InventoryApi.java::com.demo.inventory.api.InventoryApi.deduct';
  assert.ok(g.edges.some(e => e.s === caller && e.t === target && e.rel === 'CALLS'), 'cross-repo CALLS edge');
});

test('RabbitMQ + XXL-Job conventions: listener, sender, job handler', () => {
  const q = 'topic:stock-low-queue';
  const consumer = 'order-service#src/main/java/com/demo/order/mq/RabbitStockConsumer.java::com.demo.order.mq.RabbitStockConsumer.process';
  assert.equal(g.nodes.get(consumer).entry, 'mq');
  assert.ok(g.edges.some(e => e.s === consumer && e.t === q && e.rel === 'SUBSCRIBES'));
  const sender = 'order-service#src/main/java/com/demo/order/mq/RabbitStockSender.java::com.demo.order.mq.RabbitStockSender.send';
  assert.ok(g.edges.some(e => e.s === sender && e.t === q && e.rel === 'PRODUCES'));
  const exSender = 'order-service#src/main/java/com/demo/order/mq/RabbitStockSender.java::com.demo.order.mq.RabbitStockSender.sendToExchange';
  assert.ok(g.edges.some(e => e.s === exSender && e.t === 'topic:STOCK_EXCHANGE' && e.rel === 'PRODUCES'), 'sendToMQ exchange producer');
  const job = 'order-service#src/main/java/com/demo/order/mq/StockSyncJob.java::com.demo.order.mq.StockSyncJob.execute';
  assert.equal(g.nodes.get(job).entry, 'job');
  assert.equal(g.nodes.get(job).props.jobHandler, 'stockSyncJob');
});

test('API-interface convention: controller implements @FeignClient API → exposes endpoints', () => {
  const impl = 'order-service#src/main/java/com/demo/order/controller/OrderQueryController.java::com.demo.order.controller.OrderQueryController';
  for (const ep of ['ep:POST /orders/query', 'ep:GET /orders/stats']) {
    assert.ok(g.nodes.has(ep), 'endpoint exists: ' + ep);
    assert.ok(g.edges.some(e => e.s === impl + '.query' || e.s === impl + '.stats'), 'controller method present');
  }
  const queryMid = impl + '.query';
  assert.equal(g.nodes.get(queryMid).entry, 'http');
  assert.ok(g.edges.some(e => e.s === queryMid && e.t === 'ep:POST /orders/query' && e.rel === 'EXPOSES'));
  // the API interface keeps its CONSUMES edge (it is also the contract external callers use)
  const apiQuery = 'order-service#src/main/java/com/demo/order/api/OrderApi.java::com.demo.order.api.OrderApi.query';
  assert.ok(g.edges.some(e => e.s === apiQuery && e.rel === 'CONSUMES'), 'contract interface keeps CONSUMES');
});

test('TS: imports, HTTP call contract, page node', () => {
  const api = 'web-frontend#src/api/order.ts';
  const pageFile = 'web-frontend#src/pages/order/confirm.ts';
  assert.ok(g.edges.some(e => e.s === pageFile && e.t === api && e.rel === 'IMPORTS'));
  const submit = 'web-frontend#src/api/order.ts::submitOrder';
  assert.ok(g.edges.some(e => e.s === submit && e.t === 'ep:POST /orders' && e.rel === 'CALLS_API'));
  const page = 'page:web-frontend:/order/confirm';
  assert.ok(g.nodes.has(page));
  assert.ok(g.edges.some(e => e.s === page && e.rel === 'CONTAINS'));
});

test('test code ingested with entry=test and covering calls', () => {
  const jt = 'inventory-service#src/test/java/com/demo/inventory/InventoryServiceImplTest.java::com.demo.inventory.InventoryServiceImplTest.testDeductStock';
  assert.equal(g.nodes.get(jt).entry, 'test');
  assert.ok(g.edges.some(e => e.s === jt && e.t === invDeduct && e.rel === 'CALLS'));
  const jest = [...g.nodes.values()].find(n => n.type === 'test' && n.repo === 'web-frontend');
  assert.ok(jest, 'jest it() node');
  assert.ok(g.edges.some(e => e.s === jest.id && e.rel === 'CALLS'));
});

test('impact: changed inventory method reaches page + tests across repos', () => {
  const r = impactAnalysis(g, invDeduct, { depth: 12 });
  const kinds = r.paths.map(p => p.entryKind);
  assert.ok(kinds.includes('test'), 'unit test entry');
  assert.ok(kinds.includes('page'), 'frontend page entry');
  assert.ok(kinds.includes('mq'), 'mq consumer entry');
  assert.ok(r.summary.repos >= 3);
});

function diffFor(nodeId) {
  const n = g.nodes.get(nodeId);
  return `diff --git a/${n.file} b/${n.file}\n--- a/${n.file}\n+++ b/${n.file}\n@@ -${n.start_line},3 +${n.start_line},4 @@ context\n+// changed\n`;
}

test('tests_for_change: precise unit selection + uncovered risk', () => {
  const r = testsForChange(g, [invDeduct]);
  assert.ok(r.unitTests.some(u => u.label === 'testDeductStock()'));
  assert.equal(r.uncovered.length, 0);
  const consumer = 'order-service#src/main/java/com/demo/order/StockLowConsumer.java::com.demo.order.StockLowConsumer.onMessage';
  const r2 = testsForChange(g, [consumer]);
  assert.ok(r2.uncovered.some(u => u.id === consumer), 'uncovered surfaced');
});

test('impact_of_diff: hunk ranges map to methods and aggregate entries', () => {
  const changed = [invDeduct, orderCreate];
  const r = impactOfDiff(g, changed);
  assert.equal(r.summary.changed, 2);
  assert.ok(r.entries.length >= 3);
  const pageEntry = r.entries.find(e => e.kind === 'page');
  assert.ok(pageEntry.causedBy.includes(invDeduct) || pageEntry.causedBy.includes(orderCreate));
});

test('incremental: unchanged files skipped, changed file reparsed', async () => {
  const s1 = await ingestRepo(db, { source: path.join(tmp, 'inventory-service') });
  assert.equal(s1.parsed, 0);
  assert.ok(s1.skipped > 0);
  const f = path.join(tmp, 'inventory-service/src/main/java/com/demo/inventory/StockRepository.java');
  fs.appendFileSync(f, '\n// touch\n');
  const s2 = await ingestRepo(db, { source: path.join(tmp, 'inventory-service') });
  assert.equal(s2.parsed, 1);
  g = loadGraph(db);
  assert.ok(g.nodes.has(invDeduct), 'old nodes survive incremental');
});

test('repo copy isolation: indexing a copy must not wipe original edges', async () => {
  const before = loadGraph(db).edges.filter(e => e.s.startsWith('order-service#')).length;
  fs.cpSync(path.join(tmp, 'order-service'), path.join(tmp, 'order-copy'), { recursive: true, filter: s => !s.includes('/.git') });
  gitInit(path.join(tmp, 'order-copy'));
  await ingestRepo(db, { source: path.join(tmp, 'order-copy') });
  const mid = loadGraph(db).edges.filter(e => e.s.startsWith('order-service#')).length;
  assert.equal(mid, before, 'original edges survive copy ingestion');
  const { deleteRepo } = await import('../src/db.js');
  deleteRepo(db, 'order-copy');
  const after = loadGraph(db).edges.filter(e => e.s.startsWith('order-service#')).length;
  assert.equal(after, before, 'original edges survive copy removal');
  g = loadGraph(db);
});

test('graph_status: coverage and freshness', () => {
  const st = graphStatus(g, db);
  assert.equal(st.totals.repos, 3);
  const inv = st.repos.find(r => r.repo === 'inventory-service');
  assert.ok(inv.testMethods >= 1);
  assert.ok(inv.staticCoverage > 0);
});

test('MCP server: 9 tools, real answers over stdio-shaped transport', async () => {
  const server = createServer(dbPath);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 9);
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  const search = await call('search_symbol', { query: 'deductStock' });
  assert.ok(search.results.some(r => r.id === invDeduct));
  const imp = await call('impact_analysis', { method: invDeduct, depth: 12 });
  assert.ok(imp.paths.length >= 3);
  const diff = await call('impact_of_diff', { diff: diffFor(invDeduct) });
  assert.equal(diff.summary.changed, 1);
  const tests = await call('tests_for_change', { diff: diffFor(invDeduct) });
  assert.ok(tests.summary.unit >= 1);
  const q = await call('graph_query', { query: "MATCH (m:Method)-[:CONSUMES]->(e:Endpoint) RETURN m" });
  assert.ok(q.count >= 1, 'CONSUMES edges present');
  const st = await call('graph_status', {});
  assert.equal(st.totals.repos, 3);
  const trace = await call('cross_repo_trace', { endpoint: 'ep:POST /inventory/deduct' });
  assert.ok(trace.providers.length >= 1, 'trace providers');
  assert.ok(trace.consumers.length >= 1, 'trace consumers');
  assert.ok(trace.providers[0].file, 'providers carry source location');
  assert.ok(trace.providers[0].callees.every(c => c.file && c.line), 'callees carry source location');
  await client.close();
  await server.close();
});