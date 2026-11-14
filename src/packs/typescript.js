// TypeScript / JavaScript language pack: imports, calls, HTTP client calls → contract edges, pages, jest tests.
import { endpointId, normPath } from '../contracts.js';
import { applyGateway } from '../config.js';
import path from 'node:path';

export const id = 'typescript';
export const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
export const grammarFor = file => (/\.tsx?$/.test(file) ? (file.endsWith('.tsx') ? 'tree-sitter-tsx' : 'tree-sitter-typescript') : 'tree-sitter-javascript');
export const grammar = 'tree-sitter-typescript';

const strip = s => (s || '').replace(/^["'`]|["'`]$/g, '');
const HTTP_OBJ = /^(axios|http|https|api|request|client|service)$/i;
const VERBS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export function pass1(ctx, tree) {
  const { repo, file } = ctx;
  const scope = { bindings: new Map(), locals: new Map(), classes: new Map() };
  ctx.scopes.set(file, scope);
  const isTestFile = /\.(test|spec)\.[cm]?[tj]sx?$/.test(file) || file.includes('__tests__/');
  const pageDirs = (ctx.config && ctx.config.pageDirs) || ['src/page','src/pages','src/views'];
  const isPage = pageDirs.some(d => file.startsWith(d.replace(/\/$/,'') + '/') || file.includes('/' + d.replace(/^\//,'').replace(/\/$/,'') + '/'));
  const fileNodeId = `${repo}#${file}`;
  const symId = name => `${repo}#${file}::${name}`;
  const exports = new Map();
  ctx.fileExports.set(file, exports);

  if (isPage) {
    const rel = file.replace(/^(.*\/)?src\/(pages?|views)\//, '').replace(/\.[cm]?[tj]sx?$/, '').replace(/\/index$/, '');
    const route = '/' + rel;
    const pid = `page:${repo}:${route}`;
    ctx.node({ id: pid, type: 'page', label: route, props: { route } });
    ctx.edge({ s: `${repo}#repo`, t: pid, rel: 'CONTAINS' });
    scope.pageId = pid;
  }

  function fnNode(name, node, kind, classId) {
    const id = classId ? `${classId}.${name}` : symId(name);
    const entry = isTestFile ? 'test' : '';
    ctx.node({ id, type: 'method', kind, label: name + '()', fqn: `${file}::${name}`, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, entry });
    ctx.edge({ s: classId || (scope.pageId || fileNodeId), t: id, rel: 'CONTAINS' });
    ctx.methodPush(classId || fileNodeId, name, id);
    if (!classId) exports.set(name, id);
    return id;
  }

  function httpCall(node, mid) {
    const fn = node.childForFieldName('function');
    const args = node.childForFieldName('arguments');
    if (!fn || !args) return false;
    let verb = null, isHttp = false;
    if (fn.type === 'identifier' && fn.text === 'fetch') { isHttp = true; verb = 'GET'; }
    else if (fn.type === 'member_expression' && HTTP_OBJ.test(fn.childForFieldName('object')?.text || '') && VERBS.has(fn.childForFieldName('property')?.text || '')) {
      isHttp = true; verb = fn.childForFieldName('property').text.toUpperCase();
    }
    if (!isHttp) return false;
    const first = args.namedChildren[0];
    if (!first || (first.type !== 'string' && first.type !== 'template_string')) return false;
    let p = normPath(strip(first.text));
    p = applyGateway(p, ctx.config);
    if (fn.type === 'identifier') {
      const opts = args.namedChildren[1];
      if (opts?.type === 'object') for (const pr of opts.namedChildren) {
        if (pr.type === 'pair' && pr.childForFieldName('key')?.text === 'method') verb = strip(pr.childForFieldName('value')?.text).toUpperCase();
      }
    }
    const ep = endpointId(verb, p);
    ctx.node({ id: ep, type: 'endpoint', label: `${verb} ${p}`, props: { httpMethod: verb, path: p } });
    ctx.edge({ s: mid, t: ep, rel: 'CALLS_API', site: `${file}:${node.startPosition.row + 1}` });
    return true;
  }

  function walkCalls(node, mid, classId, locals) {
    if (node.type === 'variable_declarator') {
      const vn = node.childForFieldName('name')?.text;
      const val = node.childForFieldName('value');
      if (vn && val?.type === 'new_expression') locals.set(vn, val.childForFieldName('constructor')?.text);
    }
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      const fname = fn?.type === 'identifier' ? fn.text : null;
      // jest it/test → test node wrapping callback calls
      if ((fname === 'it' || fname === 'test') && args) {
        const label = strip(args.namedChildren[0]?.text || 'case');
        const cb = args.namedChildren.find(c => c.type === 'arrow_function' || c.type === 'function');
        const tid = symId(`it:${label}:${node.startPosition.row}`);
        ctx.node({ id: tid, type: 'test', kind: 'test-method', label, entry: 'test', start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
        ctx.edge({ s: fileNodeId, t: tid, rel: 'CONTAINS' });
        if (cb) walkCalls(cb, tid, classId, locals);
        return;
      }
      if (httpCall(node, mid)) { /* contract edge emitted */ }
      else if (fn?.type === 'identifier') {
        ctx.pending.push({ file, methodId: mid, classId, recv: { kind: 'binding', name: fn.text }, name: fn.text, line: node.startPosition.row + 1 });
      } else if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object');
        const prop = fn.childForFieldName('property')?.text;
        if (obj?.type === 'identifier') {
          const t = obj.text;
          // custom HTTP wrapper (e.g. class HttpApi wrapping axios.request)
          const bind = scope.bindings.get(t);
          if (((bind && bind.file && ctx.httpWrappers && ctx.httpWrappers.has(bind.file)) || ((ctx.config && ctx.config.httpWrappers) || []).includes(t)) && VERBS.has(prop)) {
            const callArgs = node.childForFieldName('arguments');
            const firstArg = callArgs && callArgs.namedChildren[0];
            if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
              let p = normPath(strip(firstArg.text));
              p = applyGateway(p, ctx.config);
              const ep = endpointId(prop.toUpperCase(), p);
              ctx.node({ id: ep, type: 'endpoint', label: prop.toUpperCase() + ' ' + p, props: { httpMethod: prop.toUpperCase(), path: p } });
              ctx.edge({ s: mid, t: ep, rel: 'CALLS_API', site: file + ':' + (node.startPosition.row + 1) });
              return;
            }
          }
          if (locals.has(t)) ctx.pending.push({ file, methodId: mid, classId, recv: { kind: 'type', name: locals.get(t) }, name: prop, line: node.startPosition.row + 1 });
          else if (scope.bindings.has(t)) ctx.pending.push({ file, methodId: mid, classId, recv: { kind: 'ns', name: t }, name: prop, line: node.startPosition.row + 1 });
          else if (scope.classes.has(t)) ctx.pending.push({ file, methodId: mid, classId, recv: { kind: 'type', name: t }, name: prop, line: node.startPosition.row + 1 });
        } else if (obj?.type === 'this') {
          ctx.pending.push({ file, methodId: mid, classId, recv: { kind: 'this' }, name: prop, line: node.startPosition.row + 1 });
        }
      }
    }
    for (const c of node.namedChildren) walkCalls(c, mid, classId, locals);
  }

  function classBody(body, tid) {
    for (const c of body.namedChildren) {
      if (c.type === 'method_definition' || c.type === 'public_field_definition') {
        if (c.type !== 'method_definition') continue;
        const name = c.childForFieldName('name')?.text;
        if (!name) continue;
        const mid = fnNode(name, c, 'method', tid);
        const locals = new Map();
        const params = c.childForFieldName('parameters');
        if (params) for (const p of params.namedChildren) {
          const pn = p.childForFieldName('pattern')?.text || p.childForFieldName('name')?.text;
          const pt = p.childForFieldName('type')?.text;
          if (pn && pt) locals.set(pn, pt.replace(/<.*>/, ''));
        }
        const b = c.childForFieldName('body');
        if (b) walkCalls(b, mid, tid, locals);
      }
    }
  }

  function handleDecl(node, exported) {
    if (node.type === 'class_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (!name) return;
      const tid = symId(name);
      ctx.node({ id: tid, type: 'type', kind: 'class', label: name, fqn: `${file}::${name}`, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
      ctx.edge({ s: `${repo}#repo`, t: tid, rel: 'CONTAINS' });
      scope.classes.set(name, tid);
      ctx.typeIndexPush(name, tid);
      exports.set(name, tid);
      for (const h of node.namedChildren) {
        if (h.type === 'implements_clause' || h.type === 'extends_clause') {
          for (const t of h.namedChildren) {
            const nm = t.type === 'type_identifier' ? t.text : t.childForFieldName('name')?.text;
            if (nm) ctx.typeRels.push({ file, tid, superName: h.type === 'extends_clause' ? nm : null, ifaceNames: h.type === 'implements_clause' ? [nm] : [] });
          }
        }
      }
      const body = node.childForFieldName('body');
      if (body) classBody(body, tid);
    } else if (node.type === 'interface_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (!name) return;
      const tid = symId(name);
      ctx.node({ id: tid, type: 'type', kind: 'interface', label: name, fqn: `${file}::${name}`, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
      ctx.edge({ s: `${repo}#repo`, t: tid, rel: 'CONTAINS' });
      scope.classes.set(name, tid);
      ctx.typeIndexPush(name, tid);
      exports.set(name, tid);
      const body = node.childForFieldName('body');
      if (body) for (const m of body.namedChildren) {
        if (m.type === 'method_signature') {
          const mn = m.childForFieldName('name')?.text;
          if (mn) { const mid = `${tid}.${mn}`; ctx.node({ id: mid, type: 'method', kind: 'method', label: mn + '()', start_line: m.startPosition.row + 1, end_line: m.endPosition.row + 1 }); ctx.edge({ s: tid, t: mid, rel: 'CONTAINS' }); ctx.methodPush(tid, mn, mid); }
        }
      }
    } else if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (!name) return;
      const mid = fnNode(name, node, 'function');
      const locals = new Map();
      const b = node.childForFieldName('body');
      if (b) walkCalls(b, mid, null, locals);
    } else if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const d of node.namedChildren) {
        if (d.type !== 'variable_declarator') continue;
        const name = d.childForFieldName('name')?.text;
        const val = d.childForFieldName('value');
        if (name && val && (val.type === 'arrow_function' || val.type === 'function')) {
          const mid = fnNode(name, val, 'function');
          const b = val.childForFieldName('body');
          if (b) walkCalls(b, mid, null, new Map());
        } else if (name && val && val.type === 'object') {
          // API modules often export an object of arrow functions:
          //   const UserApi = { login: () => HttpApi.post('/x') }
          for (const pair of val.namedChildren) {
            if (pair.type !== 'pair') continue;
            const keyNode = pair.childForFieldName('key');
            const key = keyNode && strip(keyNode.text);
            const value = pair.childForFieldName('value');
            if (!key || !value || !(value.type === 'arrow_function' || value.type === 'function')) continue;
            const mid = symId(name + '.' + key);
            ctx.node({ id: mid, type: 'method', kind: 'function', label: key + '()', fqn: file + '::' + name + '.' + key, start_line: value.startPosition.row + 1, end_line: value.endPosition.row + 1, entry: isTestFile ? 'test' : '' });
            ctx.edge({ s: fileNodeId, t: mid, rel: 'CONTAINS' });
            exports.set(key, mid);
            const body = value.childForFieldName('body');
            if (body) walkCalls(body, mid, null, new Map());
          }
        }
      }
    }
  }

  for (const top of tree.rootNode.namedChildren) {
    if (top.type === 'import_statement') {
      const src = strip(top.childForFieldName('source')?.text || '');
      const resolved = resolveModule(ctx, file, src);
      if (resolved) ctx.edge({ s: fileNodeId, t: `${repo}#${resolved}`, rel: 'IMPORTS' });
      const clause = top.namedChildren.find(c => c.type === 'import_clause');
      if (clause) for (const c of clause.namedChildren) {
        if (c.type === 'identifier') scope.bindings.set(c.text, { file: resolved, name: 'default' });
        else if (c.type === 'named_imports') for (const sp of c.namedChildren) {
          if (sp.type !== 'import_specifier') continue;
          const nm = sp.childForFieldName('name')?.text;
          const alias = sp.childForFieldName('alias')?.text || nm;
          if (nm) scope.bindings.set(alias, { file: resolved, name: nm });
        } else if (c.type === 'namespace_import') {
          const ns = c.namedChildren.find(x => x.type === 'identifier')?.text;
          if (ns) scope.bindings.set(ns, { file: resolved, name: '*' });
        }
      }
    } else if (top.type === 'export_statement') {
      const d = top.childForFieldName('declaration');
      if (d) handleDecl(d, true);
    } else if (top.type === 'expression_statement') {
      walkCalls(top, fileNodeId, null, new Map());
    } else {
      handleDecl(top, false);
    }
  }
}

export function resolveModule(ctx, file, src) {
  if (!src) return null;
  let base;
  if (src.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(file), src));
  else {
    const aliases = (ctx.config && ctx.config.pathAliases) || { '@src/*': 'src/*', '@/*': 'src/*' };
    let hit = null;
    for (const [pat, tgt] of Object.entries(aliases)) {
      const pre = pat.replace(/\*$/, '');
      if (src.startsWith(pre)) { hit = tgt.replace(/\*$/, '') + src.slice(pre.length); break; }
    }
    if (hit == null) return null;
    base = hit;
  }
  const tries = [base, base + '.ts', base + '.tsx', base + '.js', base + '.jsx', base + '.mjs', base + '/index.ts', base + '/index.tsx', base + '/index.js'];
  for (const t of tries) if (ctx.fileSet.has(t)) return t;
  return null;
}

export function pass2Types(ctx, file) {
  const scope = ctx.scopes.get(file);
  if (!scope) return;
  const resolveType = name => {
    const b = scope.bindings.get(name);
    if (b && b.file) {
      const ex = ctx.fileExports.get(b.file);
      const tid = ex?.get(b.name === 'default' ? name : b.name);
      if (tid && ctx.nodes.get(tid)?.type === 'type') return [tid];
    }
    if (scope.classes.has(name)) return [scope.classes.get(name)];
    return ctx.typeIndex.get(name) || [];
  };
  for (const r of ctx.typeRels.filter(r => r.file === file)) {
    if (r.superName) for (const t of resolveType(r.superName)) ctx.edge({ s: r.tid, t, rel: 'EXTENDS', file });
    for (const i of r.ifaceNames) for (const t of resolveType(i)) { ctx.edge({ s: r.tid, t, rel: 'IMPLEMENTS', file }); ctx.implPush(t, r.tid); }
  }
}

export function pass2Calls(ctx, file) {
  const scope = ctx.scopes.get(file);
  if (!scope) return;
  const exports = ctx.fileExports.get(file) || new Map();
  const resolveType = name => {
    const b = scope.bindings.get(name);
    if (b && b.file) {
      const ex = ctx.fileExports.get(b.file);
      const tid = ex?.get(b.name === 'default' ? name : b.name);
      if (tid && ctx.nodes.get(tid)?.type === 'type') return [tid];
    }
    if (scope.classes.has(name)) return [scope.classes.get(name)];
    return ctx.typeIndex.get(name) || [];
  };
  for (const site of ctx.pending.filter(p => p.file === file)) {
    let targets = [];
    if (site.recv.kind === 'this') targets = [ctx.methodsOf.get(site.classId)?.get(site.name)].filter(Boolean);
    else if (site.recv.kind === 'binding') {
      const b = scope.bindings.get(site.recv.name);
      if (b && b.file) targets = [ctx.fileExports.get(b.file)?.get(b.name)].filter(Boolean);
      else targets = [exports.get(site.recv.name)].filter(Boolean);
    } else if (site.recv.kind === 'ns') {
      const b = scope.bindings.get(site.recv.name);
      if (b && b.file) targets = [ctx.fileExports.get(b.file)?.get(site.name)].filter(Boolean);
    } else if (site.recv.kind === 'type') {
      for (const tid of resolveType(site.recv.name)) {
        const m = ctx.methodsOf.get(tid)?.get(site.name);
        if (m) targets.push(m);
      }
    }
    if (!targets.length) { ctx.stats.unresolved++; continue; }
    for (const target of targets) {
      ctx.edge({ s: site.methodId, t: target, rel: 'CALLS', conf: targets.length > 1 ? 'speculative' : 'certain', site: `${file}:${site.line}`, file });
      const owner = [...ctx.methodsOf.entries()].find(([, m]) => [...m.values()].includes(target))?.[0];
      const tnode = owner ? ctx.nodes.get(owner) : null;
      if (tnode && tnode.kind === 'interface') {
        const impls = ctx.impls.get(owner) || [];
        for (const impl of impls) {
          const im = ctx.methodsOf.get(impl)?.get(site.name);
          if (im) ctx.edge({ s: target, t: im, rel: 'CALLS', conf: impls.length === 1 ? 'inferred' : 'speculative', ev: impls.length === 1 ? '接口唯一实现' : '接口多实现候选', site: `${file}:${site.line}`, file });
        }
      }
    }
  }
}