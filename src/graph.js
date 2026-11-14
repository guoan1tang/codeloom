// Query engines over the loaded graph: traversal, impact, test selection, status.
import { parseDiff } from './diff.js';

const CONF_RANK = { certain: 0, inferred: 1, speculative: 2 };
export const confRank = c => CONF_RANK[c] ?? 0;

export function searchSymbols(g, q, limit = 20) {
  const s = String(q || '').toLowerCase();
  const hits = [];
  for (const n of g.nodes.values()) {
    if (n.type === 'repo' || n.type === 'file') continue;
    const doc = ((n.props && (n.props.doc || '') + ' ' + (n.props.apidoc || '')) || '').toLowerCase();
    if (n.label.toLowerCase().includes(s) || (n.fqn || '').toLowerCase().includes(s) || (n.props?.path || '').toLowerCase().includes(s) || doc.includes(s)) hits.push(n);
  }
  hits.sort((a, b) => a.label.length - b.label.length);
  return hits.slice(0, limit);
}

export function traverse(g, startId, { depth = 3, forward = false, minConf = 'inferred' } = {}) {
  const maxRank = confRank(minConf);
  const seen = new Map([[startId, 0]]);
  const results = [];
  const queue = [{ id: startId, d: 0 }];
  while (queue.length) {
    const { id, d } = queue.shift();
    if (d >= depth) continue;
    const edges = forward ? (g.out.get(id) || []) : (g.inn.get(id) || []);
    for (const e of edges) {
      if (e.rel !== 'CALLS') continue;
      if (confRank(e.conf || 'certain') > maxRank) continue;
      const other = forward ? e.t : e.s;
      if (seen.has(other)) continue;
      seen.set(other, d + 1);
      const n = g.nodes.get(other);
      results.push({ id: other, label: n.label, repo: n.repo, depth: d + 1, confidence: e.conf || 'certain', via: e.site || undefined });
      queue.push({ id: other, d: d + 1 });
    }
  }
  return results;
}

export function impactAnalysis(g, startId, { depth = 8, confs = new Set(['certain', 'inferred']), fanin = 30 } = {}) {
  const start = g.nodes.get(startId);
  if (!start) return null;
  const visited = new Map([[startId, { parent: null, edge: null, dist: 0 }]]);
  const affected = new Set([startId]);
  const truncated = [];
  const queue = [{ id: startId, dist: 0 }];
  let depthCut = 0;
  while (queue.length) {
    const { id, dist } = queue.shift();
    const n = g.nodes.get(id);
    if (dist >= depth) { depthCut++; continue; }
    const deps = [];
    for (const e of g.inn.get(id) || []) {
      // dispatch edges (interface→impl) are included even when speculative:
      // "who could reach this impl" inherently includes every interface caller;
      // the path keeps its speculative confidence badge so uncertainty stays visible
      const isDispatch = e.conf === 'speculative' && (e.ev || '').startsWith('接口');
      if (e.rel === 'CALLS' && (confs.has(e.conf || 'certain') || isDispatch)) deps.push({ id: e.s, edge: e });
      if (n.type === 'endpoint' && ['CONSUMES', 'CALLS_API'].includes(e.rel)) deps.push({ id: e.s, edge: e });
      if (n.type === 'topic' && e.rel === 'SUBSCRIBES') deps.push({ id: e.s, edge: e });
      if (n.type === 'method' && e.rel === 'CONTAINS') { const p = g.nodes.get(e.s); if (p && p.type === 'page') deps.push({ id: e.s, edge: e }); }
    }
    if (n.type === 'method') {
      for (const e of g.out.get(id) || []) {
        if (e.rel === 'EXPOSES' || e.rel === 'PRODUCES') deps.push({ id: e.t, edge: e });
        // interface change also impacts its implementations (dispatch edges, downstream)
        if (e.rel === 'CALLS' && (e.conf === 'inferred' || e.conf === 'speculative') && confs.has(e.conf)) deps.push({ id: e.t, edge: e });
      }
    }
    for (const d of deps) {
      const dn = g.nodes.get(d.id);
      if (!dn || visited.has(d.id)) continue;
      // truncate only utility-looking hubs (high fan-in AND util path/name),
      // never business seams — matches production review-skill semantics
      const isUtil = /\/(util|utils|common|enums|helper|constant)\//.test(dn.file || '') || /(Util|Utils|Helper|Constants?)\./.test(dn.fqn || '');
      if (dn.type === 'method' && isUtil && (g.callsIn.get(d.id) || 0) > fanin) {
        if (!truncated.find(t => t.id === d.id)) truncated.push({ id: d.id, label: dn.label, repo: dn.repo, fanin: g.callsIn.get(d.id) });
        continue;
      }
      visited.set(d.id, { parent: id, edge: d.edge, dist: dist + 1 });
      affected.add(d.id);
      queue.push({ id: d.id, dist: dist + 1 });
    }
  }
  const entries = [];
  for (const id of affected) {
    const n = g.nodes.get(id);
    if (id !== startId && (n.type === 'page' || n.entry || n.type === 'external')) entries.push(id);
  }
  const paths = entries.map(eid => {
    const chain = [];
    let cur = eid;
    while (cur) { chain.push(cur); cur = visited.get(cur).parent; }
    let worst = 'certain';
    for (const id of chain) {
      const v = visited.get(id);
      if (v?.edge?.conf) {
        if (v.edge.conf === 'speculative') worst = 'speculative';
        else if (v.edge.conf === 'inferred' && worst === 'certain') worst = 'inferred';
      }
    }
    const en = g.nodes.get(eid);
    return { entry: eid, entryKind: en.type === 'page' ? 'page' : (en.entry || 'external'), chain, conf: worst, hops: chain.length - 1 };
  });
  const topPaths = paths.filter(p => !paths.some(o => o !== p && o.chain.includes(p.entry)));
  topPaths.sort((a, b) => a.hops - b.hops);
  const repos = new Set();
  for (const id of affected) { const r = g.nodes.get(id).repo; if (r && r !== 'external') repos.add(r); }
  return {
    start: startId, affected: [...affected], paths: topPaths, truncated, repos: [...repos], depthCut,
    summary: {
      repos: repos.size,
      http: topPaths.filter(p => p.entryKind === 'http').length,
      pages: topPaths.filter(p => p.entryKind === 'page').length,
      mq: topPaths.filter(p => p.entryKind === 'mq').length,
      job: topPaths.filter(p => p.entryKind === 'job').length,
      test: topPaths.filter(p => p.entryKind === 'test').length,
      truncated: truncated.length,
    },
  };
}

export function resolveChanged(g, p) {
  if (p.diff && p.diff.trim()) return { source: 'custom-diff', methods: parseDiff(p.diff, g) };
  return { source: p.commit || 'HEAD', methods: parseDiff(p.diffText || '', g) };
}

export function impactOfDiff(g, changed, opts = {}) {
  const confs = opts.confs || new Set(['certain', 'inferred', 'speculative']);
  const affected = new Set(), entryMap = new Map(), truncated = new Map();
  let depthCut = 0;
  for (const mid of changed) {
    const r = impactAnalysis(g, mid, { depth: opts.depth || 8, confs, fanin: opts.fanin ?? 30 });
    if (!r) continue;
    r.affected.forEach(id => affected.add(id));
    r.truncated.forEach(t => truncated.set(t.id, t));
    depthCut += r.depthCut;
    for (const pa of r.paths) {
      const en = g.nodes.get(pa.entry);
      const e = entryMap.get(pa.entry) || { entry: pa.entry, kind: pa.entryKind, label: en.label, repo: en.repo, causedBy: [], hops: pa.hops, conf: pa.conf };
      if (!e.causedBy.includes(mid)) e.causedBy.push(mid);
      e.hops = Math.min(e.hops, pa.hops);
      if (confRank(pa.conf) > confRank(e.conf)) e.conf = pa.conf;
      entryMap.set(pa.entry, e);
    }
  }
  const repos = new Set();
  for (const id of affected) { const r = g.nodes.get(id).repo; if (r && r !== 'external') repos.add(r); }
  return {
    changedMethods: changed.map(id => { const n = g.nodes.get(id); return { id, label: n.label, repo: n.repo, lines: n.start_line != null ? [n.start_line, n.end_line] : null }; }),
    summary: { changed: changed.length, repos: repos.size, entries: entryMap.size, affected: affected.size, truncated: truncated.size },
    entries: [...entryMap.values()].sort((a, b) => a.hops - b.hops),
    affected: [...affected], truncated: [...truncated.values()], depthCut,
  };
}

// Case bridge format: nodes of type 'case' with props {caseKind:'api'|'ui', priority:'P0'…,
// auto:'api'|'ui'|'ui-partial'} and COVERS edges to endpoint/page/topic nodes.
// Produce them from your test-management export (e.g. testcase-generator xlsx/md).
export function testsForChange(g, changed, opts = {}) {
  const confs = opts.confs || new Set(['certain', 'inferred', 'speculative']);
  const fanin = opts.fanin ?? 30;
  const unit = [], uncovered = [], affected = new Set();
  for (const mid of changed) {
    const r = impactAnalysis(g, mid, { depth: opts.depth || 8, confs, fanin });
    if (!r) continue;
    r.affected.forEach(id => affected.add(id));
    const tests = r.affected.filter(id => g.nodes.get(id).type === 'test');
    if (!tests.length) { const n = g.nodes.get(mid); uncovered.push({ id: mid, label: n.label, repo: n.repo }); }
    for (const tid of tests) {
      const u = unit.find(x => x.id === tid);
      if (u) { if (!u.covers.includes(mid)) u.covers.push(mid); }
      else {
        const n = g.nodes.get(tid);
        const pp = r.paths.find(x => x.entry === tid);
        unit.push({ id: tid, label: n.label, repo: n.repo, covers: [mid], depth: pp ? pp.hops : 1 });
      }
    }
  }
  const caseMap = new Map();
  if (opts.includeCases !== false) {
    for (const id of affected) {
      for (const e of g.inn.get(id) || []) {
        if (e.rel !== 'COVERS') continue;
        const c = g.nodes.get(e.s);
        if (!c || c.type !== 'case') continue;
        const x = caseMap.get(c.id) || { id: c.id, label: c.label, kind: c.props.caseKind, priority: c.props.priority, auto: c.props.auto, covers: [] };
        if (!x.covers.includes(id)) x.covers.push(id);
        caseMap.set(c.id, x);
      }
    }
  }
  const cases = [...caseMap.values()].sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || a.id.localeCompare(b.id));
  const api = cases.filter(c => c.kind === 'api'), ui = cases.filter(c => c.kind === 'ui');
  return {
    changedMethods: changed, unitTests: unit.sort((a, b) => a.depth - b.depth), uncovered,
    apiCases: api, uiCases: ui,
    summary: { changed: changed.length, unit: unit.length, api: api.length, ui: ui.length, uncovered: uncovered.length },
  };
}

export function graphStatus(g, db) {
  const repos = g.repos.map(r => {
    const methods = [], tests = [];
    for (const n of g.nodes.values()) {
      if (n.repo !== r.id) continue;
      if (n.type === 'method') methods.push(n.id);
      if (n.type === 'test') tests.push(n.id);
    }
    const covered = new Set();
    for (const tid of tests) {
      const seen = new Set([tid]), q = [{ id: tid, d: 0 }];
      while (q.length) {
        const { id, d } = q.shift();
        if (d >= 6) continue;
        for (const e of g.out.get(id) || []) {
          if (e.rel !== 'CALLS' || seen.has(e.t)) continue;
          seen.add(e.t); covered.add(e.t); q.push({ id: e.t, d: d + 1 });
        }
      }
    }
    const cov = methods.filter(m => covered.has(m)).length;
    return {
      repo: r.name, branch: r.branch, indexedCommit: r.commit_sha, stale: r.status === 'stale',
      nodes: methods.length + tests.length, testMethods: tests.length,
      staticCoverage: methods.length ? Math.round(cov / methods.length * 100) : 0,
    };
  });
  let testTotal = 0, caseTotal = 0, cross = 0;
  for (const n of g.nodes.values()) { if (n.type === 'test') testTotal++; if (n.type === 'case') caseTotal++; }
  for (const e of g.edges) {
    const a = g.nodes.get(e.s), b = g.nodes.get(e.t);
    if (a && b && a.repo && b.repo && a.repo !== b.repo && ['CONSUMES', 'EXPOSES', 'PRODUCES', 'SUBSCRIBES', 'CALLS_API'].includes(e.rel)) cross++;
  }
  return {
    mcp: 'codeloom v0.1.0',
    totals: { repos: g.repos.length, nodes: g.nodes.size, edges: g.edges.length, crossRepoEdges: cross, testMethods: testTotal, cases: caseTotal },
    freshnessWarnings: repos.filter(x => x.stale).map(x => x.repo),
    repos,
  };
}