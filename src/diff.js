// Unified-diff → changed methods, via hunk line ranges intersecting node source ranges.
import { execFileSync } from 'node:child_process';

export function parseDiff(text, graph) {
  const changed = new Set();
  let file = null;
  for (const line of String(text || '').split('\n')) {
    const f = line.match(/^\+\+\+ b\/(\S+)/);
    if (f) { file = f[1]; continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = parseInt(h[1], 10);
      const count = h[2] != null ? parseInt(h[2], 10) : 1;
      const end = start + Math.max(count, 1) - 1;
      for (const n of graph.nodes.values()) {
        // change unit = method/test; type & file nodes span whole classes and would over-match
        if ((n.type === 'method' || n.type === 'test') && n.file === file &&
            n.start_line != null && n.end_line != null &&
            n.start_line <= end && n.end_line >= start) changed.add(n.id);
      }
    }
  }
  return [...changed];
}

export function git(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function repoMeta(repoDir) {
  const commit = git(repoDir, ['rev-parse', 'HEAD']).trim();
  let branch = '';
  try { branch = git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(); } catch { /* detached */ }
  return { commit, branch };
}

export function diffSince(repoDir, base) {
  return git(repoDir, ['diff', '--unified=3', base]);
}

export function listFiles(repoDir) {
  return git(repoDir, ['ls-files', '-z']).split('\0').filter(Boolean);
}