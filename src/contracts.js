// Contract normalization: the cross-repo join keys.
// Endpoint ids are global (not repo-scoped) so consumer and provider meet on the same node.

export function normPath(p) {
  if (!p) return '/';
  let s = String(p).trim();
  s = s.split('?')[0];
  s = s.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');      // express / react-router style
  s = s.replace(/<[^>]*:([^>]+)>/g, '{$1}');                // flask style
  s = s.replace(/\$\{[^}]*\}/g, '{param}');                 // JS template literals
  s = s.replace(/\{[^}]*\}/g, m => '{' + m.slice(1, -1).split(':')[0] + '}');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}

export function endpointId(httpMethod, p) {
  return `ep:${String(httpMethod || 'GET').toUpperCase()} ${normPath(p)}`;
}

export function topicId(name) {
  return `topic:${String(name).trim()}`;
}

export function joinPath(base, sub) {
  const b = (base || '').replace(/\/$/, '');
  const s = (sub || '').startsWith('/') ? (sub || '') : '/' + (sub || '');
  return normPath(b + s);
}

// After ingestion: mark endpoints with no provider as external boundaries.
export function finalizeContracts(db, graph) {
  const provider = new Map();
  for (const e of graph.edges) if (e.rel === 'EXPOSES') provider.set(e.t, graph.nodes.get(e.s)?.repo || '');
  const upd = db.prepare('UPDATE nodes SET repo=?, props=? WHERE id=?');
  for (const [id, n] of graph.nodes) {
    if (n.type !== 'endpoint') continue;
    if (provider.has(id)) {
      const repo = provider.get(id);
      const props = { ...n.props, external: false };
      if (n.repo !== repo || n.props.external) { upd.run(repo, JSON.stringify(props), id); n.repo = repo; n.props = props; }
    } else if (n.repo !== 'external') {
      const props = { ...n.props, external: true };
      upd.run('external', JSON.stringify(props), id);
      n.repo = 'external'; n.props = props;
    }
  }
  // topics belong to their producer repo (else first subscriber, else external)
  const topicRepo = new Map();
  for (const e of graph.edges) {
    if (e.rel === 'PRODUCES' && !topicRepo.has(e.t)) topicRepo.set(e.t, graph.nodes.get(e.s)?.repo || '');
  }
  for (const e of graph.edges) {
    if (e.rel === 'SUBSCRIBES' && !topicRepo.has(e.t)) topicRepo.set(e.t, graph.nodes.get(e.s)?.repo || '');
  }
  for (const [id, n] of graph.nodes) {
    if (n.type !== 'topic' || n.repo) continue;
    const repo = topicRepo.get(id) || 'external';
    upd.run(repo, JSON.stringify(n.props || {}), id);
    n.repo = repo;
  }
}