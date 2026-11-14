// Per-repository configuration for framework adapters.
// File: <repo>/codeloom.config.json (all keys optional — generic defaults below).
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  // TypeScript/JS
  httpWrappers: [],                 // extra wrapper identifiers, e.g. ["HttpApi", "request"]
  pathAliases: { '@src/*': 'src/*', '@/*': 'src/*' },
  pageDirs: ['src/page', 'src/pages', 'src/views'],
  // Java
  jobAnnotations: ['Scheduled', 'XxlJob', 'ElasticSimpleJob'],
  mqListenerAnnotations: ['RabbitListener', 'KafkaListener'],   // method-level consumers
  tableAnnotations: ['TableName', 'Table'],
  // derive a table name for *DO / *Entity / *PO / *VO / *DTO classes without @TableName
  // using MyBatis-Plus default naming (camelCase → snake_case after dropping the suffix)
  tableNameFallback: false,
  // Gateway prefix stripping for consumer paths: [{prefix:'/api-order', strip:1}]
  gatewayRouters: [],
  gatewayRoutesFile: null,
};

function parseGatewayYaml(text) {
  // minimal Spring Cloud Gateway yaml scan: Path=/prefix/** … StripPrefix=n
  const out = [];
  for (const block of String(text).split(/\n(?=\s*-\s+(?:id|uri):)/)) {
    const p = block.match(/Path\s*=\s*([^,\s]+)/) || block.match(/path\(['"]([^'"]+)['"]\)/);
    if (!p) continue;
    const strip = block.match(/StripPrefix\s*=\s*(\d+)/);
    const prefix = p[1].replace(/\/\*\*?$/, '');
    if (!prefix || prefix === '/') continue;
    out.push({ prefix, strip: strip ? parseInt(strip[1], 10) : 0 });
  }
  return out;
}

export function loadFileConfig(repoDir) {
  const file = path.join(repoDir, 'codeloom.config.json');
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.warn('[codeloom] bad codeloom.config.json: ' + e.message); return {}; }
}

export function loadConfig(repoDir) {
  let cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const file = path.join(repoDir, 'codeloom.config.json');
  if (fs.existsSync(file)) {
    try {
      const user = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg = { ...cfg, ...user, pathAliases: { ...cfg.pathAliases, ...(user.pathAliases || {}) } };
    } catch (e) {
      console.warn('[codeloom] bad codeloom.config.json: ' + e.message);
    }
  }
  if (cfg.gatewayRoutesFile) {
    try {
      const y = path.join(repoDir, cfg.gatewayRoutesFile);
      if (fs.existsSync(y)) cfg.gatewayRouters = [...cfg.gatewayRouters, ...parseGatewayYaml(fs.readFileSync(y, 'utf8'))];
    } catch { /* ignore */ }
  }
  return cfg;
}

// consumer path → provider path using gateway prefix routes
export function applyGateway(p, cfg) {
  if (!cfg || !Array.isArray(cfg.gatewayRouters) || !cfg.gatewayRouters.length) return p;
  const routers = [...cfg.gatewayRouters].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const r of routers) {
    const prefix = String(r.prefix || '').replace(/\/$/, '');
    if (!prefix) continue;
    if (p === prefix || p.startsWith(prefix + '/')) {
      const parts = p.split('/').filter(Boolean).slice(Number(r.strip) || 0);
      return '/' + parts.join('/');
    }
  }
  return p;
}