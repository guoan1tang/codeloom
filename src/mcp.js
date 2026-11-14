// MCP server: the agent-facing surface. All tools query the local SQLite index; no LLM, no network.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import { openDb, loadGraph, defaultDbPath } from './db.js';
import { searchSymbols, traverse, impactAnalysis, impactOfDiff, testsForChange, graphStatus, confRank } from './graph.js';
import { parseDiff, git } from './diff.js';

const LABEL_MAP = { Method: 'method', Type: 'type', Endpoint: 'endpoint', Topic: 'topic', Page: 'page', Test: 'test', Case: 'case', Repository: 'repo', File: 'file', Table: 'table', Cache: 'cache' };
const nodeName = n => n.label.replace(/\(\)$/, '');

export function changedFromCommit(db, g, p) {
  if (p.diff && p.diff.trim()) return parseDiff(p.diff, g);
  if (!p.commit) return [];
  const repo = g.repos.find(r => r.id === p.repo || r.name === p.repo) || (p.repo ? null : g.repos[0]);
  if (!repo) throw new Error('unknown repo: ' + p.repo);
  const dir = repo.local_path || repo.url;
  if (!fs.existsSync(dir)) throw new Error(`repo "${repo.name}" was indexed from a remote URL; pass unified diff text (diff param) or re-analyze from a local checkout to use commit mode`);
  const base = p.commit === 'HEAD' ? 'HEAD~1' : p.commit + '^';
  const text = git(dir, ['diff', '--unified=3', base, p.commit === 'HEAD' ? 'HEAD' : p.commit]);
  return parseDiff(text, g);
}

function findMethod(g, idOrLabel) {
  if (g.nodes.has(idOrLabel)) return idOrLabel;
  const hits = searchSymbols(g, idOrLabel, 5).filter(n => n.type === 'method' || n.type === 'test');
  return hits[0]?.id || null;
}

function traceEndpoint(g, epId) {
  const ep = g.nodes.get(epId);
  if (!ep || ep.type !== 'endpoint') return { error: 'endpoint not found: ' + epId };
  const providers = [], consumers = [], topics = [];
  for (const e of g.inn.get(epId) || []) {
    if (e.rel === 'EXPOSES') {
      const m = g.nodes.get(e.s);
      providers.push({ method: m.id, label: m.label, repo: m.repo, callees: traverse(g, m.id, { depth: 2, forward: true }).slice(0, 12) });
      for (const out of g.out.get(m.id) || []) if (out.rel === 'PRODUCES') topics.push(collectTopic(g, out.t));
    }
    if (e.rel === 'CONSUMES' || e.rel === 'CALLS_API') {
      const m = g.nodes.get(e.s);
      consumers.push({ method: m.id, label: m.label, repo: m.repo, client: e.rel, callers: traverse(g, m.id, { depth: 2 }).slice(0, 12) });
    }
  }
  return { endpoint: epId, path: ep.props?.path, providers, consumers, topics };
}
function collectTopic(g, tid) {
  const t = g.nodes.get(tid);
  const producers = [], subscribers = [];
  for (const e of g.inn.get(tid) || []) {
    if (e.rel === 'PRODUCES') producers.push({ method: e.s, repo: g.nodes.get(e.s)?.repo });
    if (e.rel === 'SUBSCRIBES') subscribers.push({ method: e.s, repo: g.nodes.get(e.s)?.repo });
  }
  return { topic: tid, label: t?.label, producers, subscribers };
}

function graphQuery(g, q) {
  const re = /^\s*MATCH\s*\((\w+):(\w+)\)\s*(<?)-\[:([A-Z_]+)\]-(>?)\s*\((\w+)(?::(\w+))?\)\s*(?:WHERE\s+(\w+)\.(name|fqn|repo|path)\s*(=|CONTAINS)\s*'([^']*)'\s*)?RETURN\s+(count\(\w+\)|\w+)\s*$/i;
  const m = String(q || '').match(re);
  if (!m) return { error: 'parse failed: single-hop patterns only', syntax: "MATCH (a:Method)-[:CALLS]->(b:Method) WHERE a.name = 'deductStock' RETURN b" };
  const [, va, la, lt, rel, gt, vb, lb, wv, wf, op, wval, ret] = m;
  const wantA = LABEL_MAP[la], wantB = lb ? LABEL_MAP[lb] : null;
  if (!wantA || (lb && !wantB)) return { error: 'unknown label', labels: Object.keys(LABEL_MAP) };
  const backward = lt === '<' && gt === '';
  const matches = [];
  for (const e of g.edges) {
    if (e.rel !== rel.toUpperCase()) continue;
    const a = g.nodes.get(backward ? e.t : e.s), b = g.nodes.get(backward ? e.s : e.t);
    if (!a || !b || a.type !== wantA || (wantB && b.type !== wantB)) continue;
    if (wv) {
      const target = wv === va ? a : b;
      const field = wf === 'name' ? nodeName(target) : (wf === 'path' ? target.props?.path : target[wf]) || '';
      const ok = op === '=' ? field === wval : String(field).includes(wval);
      if (!ok) continue;
    }
    matches.push({ a, b });
  }
  const isCount = /^count\(/i.test(ret);
  const retVar = ret.replace(/^count\(|\)$/gi, '');
  const seen = new Set(), uniq = [];
  for (const x of matches) {
    const n = retVar === va ? x.a : x.b;
    if (!seen.has(n.id)) { seen.add(n.id); uniq.push(n); }
  }
  if (isCount) return { pattern: q.trim(), count: uniq.length };
  return { pattern: q.trim(), count: uniq.length, results: uniq.slice(0, 20).map(n => ({ id: n.id, label: n.label, type: n.type, repo: n.repo })) };
}

export function createServer(dbPath = defaultDbPath()) {
  const db = openDb(dbPath);
  const server = new McpServer({ name: 'codeloom', version: '0.1.0' });
  const json = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
  const G = () => loadGraph(db);

  server.registerTool('search_symbol', {
    description: 'Search code symbols (methods, types, endpoints, topics, pages, tests) by name / FQN / API path.',
    inputSchema: { query: z.string().describe('substring of label, fqn or path'), limit: z.number().optional() },
  }, async ({ query, limit }) => {
    const g = G();
    const hits = searchSymbols(g, query, limit || 20);
    return json({ query, count: hits.length, results: hits.map(n => ({ id: n.id, label: n.label, type: n.type, repo: n.repo, fqn: n.fqn || undefined, entry: n.entry || undefined, doc: n.props && (n.props.apidoc || n.props.doc) ? String(n.props.apidoc || n.props.doc).slice(0, 240) : undefined })) });
  });

  server.registerTool('find_callers', {
    description: 'Reverse call traversal: who calls this method, up to depth, filtered by edge confidence.',
    inputSchema: { method: z.string().describe('node id or method name'), depth: z.number().optional(), minConfidence: z.enum(['certain', 'inferred', 'speculative']).optional() },
  }, async ({ method, depth, minConfidence }) => {
    const g = G();
    const id = findMethod(g, method);
    if (!id) return json({ error: 'method not found: ' + method });
    return json({ method: id, direction: 'callers', results: traverse(g, id, { depth: depth || 3, minConf: minConfidence || 'inferred' }) });
  });

  server.registerTool('find_callees', {
    description: 'Forward call traversal: what this method calls, up to depth.',
    inputSchema: { method: z.string(), depth: z.number().optional() },
  }, async ({ method, depth }) => {
    const g = G();
    const id = findMethod(g, method);
    if (!id) return json({ error: 'method not found: ' + method });
    return json({ method: id, direction: 'callees', results: traverse(g, id, { depth: depth || 2, forward: true }) });
  });

  server.registerTool('impact_analysis', {
    description: 'Reverse dependency traversal from a changed method/endpoint/topic to entry points (HTTP, pages, MQ consumers, jobs, tests). Confidence-aware, high fan-in utilities truncated.',
    inputSchema: { method: z.string(), depth: z.number().optional(), fanin: z.number().optional(), includeSpeculative: z.boolean().optional() },
  }, async ({ method, depth, fanin, includeSpeculative }) => {
    const g = G();
    const id = g.nodes.has(method) ? method : findMethod(g, method);
    if (!id) return json({ error: 'node not found: ' + method });
    const confs = new Set(includeSpeculative === false ? ['certain', 'inferred'] : ['certain', 'inferred', 'speculative']);
    const r = impactAnalysis(g, id, { depth: depth || 8, confs, fanin: fanin ?? 30 });
    return json(r);
  });

  server.registerTool('cross_repo_trace', {
    description: 'Contract-level trace around an HTTP endpoint: providers, consumers (Feign / frontend), and MQ topics stitched across repositories.',
    inputSchema: { endpoint: z.string().describe('endpoint node id, e.g. "ep:POST /orders"') },
  }, async ({ endpoint }) => json(traceEndpoint(G(), endpoint)));

  server.registerTool('graph_query', {
    description: 'Single-hop graph pattern query (Cypher subset): MATCH (a:Label)-[:REL]->(b:Label) WHERE a.name = \'x\' RETURN b | count(b).',
    inputSchema: { query: z.string() },
  }, async ({ query }) => json(graphQuery(G(), query)));

  server.registerTool('impact_of_diff', {
    description: 'Batch impact of a change set: unified diff text (or commit in a locally-indexed repo) → changed methods → union impact aggregated per entry point.',
    inputSchema: { diff: z.string().optional(), commit: z.string().optional(), repo: z.string().optional(), depth: z.number().optional(), fanin: z.number().optional() },
  }, async (p) => {
    const g = G();
    let changed;
    try { changed = changedFromCommit(db, g, p); } catch (e) { return json({ error: e.message }); }
    if (!changed.length) return json({ error: 'no changed methods matched; check diff paths/line ranges against indexed files', changedMethods: [] });
    return json({ source: p.commit || 'custom-diff', ...impactOfDiff(g, changed, p) });
  });

  server.registerTool('tests_for_change', {
    description: 'Precise test selection: unit tests statically reaching the changed methods, bridged API/UI regression cases, and uncovered-change risk list.',
    inputSchema: { diff: z.string().optional(), commit: z.string().optional(), repo: z.string().optional(), includeCases: z.boolean().optional(), fanin: z.number().optional() },
  }, async (p) => {
    const g = G();
    let changed;
    try { changed = changedFromCommit(db, g, p); } catch (e) { return json({ error: e.message }); }
    if (!changed.length) return json({ error: 'no changed methods matched', changedMethods: [] });
    return json({ source: p.commit || 'custom-diff', ...testsForChange(g, changed, p) });
  });

  server.registerTool('graph_status', {
    description: 'Index trust: per-repo indexed commit, freshness warnings, node/edge counts, static test coverage.',
    inputSchema: {},
  }, async () => json(graphStatus(G(), db)));

  return server;
}

export async function startMcp(dbPath) {
  const server = createServer(dbPath);
  await server.connect(new StdioServerTransport());
}