// Capability matrix tests: one test per fixture project (see test/fixtures/<name>/expect.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupFixture, setupGroup, assertFixture } from './harness/index.js';

test('java-basic-rest: single-module MVC with annotation variants', async (t) => {
  const fx = await setupFixture(t, 'java-basic-rest');
  const r = assertFixture(fx.g, 'java-basic-rest');
  assert.ok(r.checked >= 10, 'expectations executed');
});

test('java-api-interface: API interface annotations + controller implementation', async (t) => {
  const fx = await setupFixture(t, 'java-api-interface');
  assertFixture(fx.g, 'java-api-interface');
});

test('java-multimodule: cross-module calls, shared util, tests', async (t) => {
  const fx = await setupFixture(t, 'java-multimodule');
  assertFixture(fx.g, 'java-multimodule');
});

test('java-orm: MyBatis XML, @Select, BaseMapper, JPA @Query', async (t) => {
  const fx = await setupFixture(t, 'java-orm');
  assertFixture(fx.g, 'java-orm');
});

test('java-events: RocketMQ / RabbitMQ / Kafka / jobs / producers', async (t) => {
  const fx = await setupFixture(t, 'java-events');
  assertFixture(fx.g, 'java-events');
});

test('java-configurable: custom annotations, wrapper config, gateway prefix', async (t) => {
  const fx = await setupFixture(t, 'java-configurable');
  assertFixture(fx.g, 'java-configurable');
});

test('edge-cases: cycles, overloads, plain methods, syntax errors', async (t) => {
  const fx = await setupFixture(t, 'edge-cases');
  assertFixture(fx.g, 'edge-cases');
});

test('cross-repo: gateway prefixes, Feign contracts, MQ and frontend stitching', async (t) => {
  const fx = await setupGroup(t, 'cross-repo');
  assertFixture(fx.g, 'cross-repo');
});

test('limitations: documented blind spots stay undocumented-free (no false positives)', async (t) => {
  const fx = await setupFixture(t, 'limitations');
  assertFixture(fx.g, 'limitations');
});

test('java-mapper-base: custom BaseMapper subclass resolves entity tables', async (t) => {
  const fx = await setupFixture(t, 'java-mapper-base');
  assertFixture(fx.g, 'java-mapper-base');
});
