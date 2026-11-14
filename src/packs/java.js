// Java language pack: tree-sitter syntax + Spring/Feign/MQ contract extraction + DI dispatch.
import { endpointId, topicId, joinPath } from '../contracts.js';
import { applyGateway } from '../config.js';

export const id = 'java';
export const extensions = ['.java'];
export const grammar = 'tree-sitter-java';

const strip = s => (s || '').replace(/^["']|["']$/g, '');
const lastSeg = s => (s || '').split('.').pop();

// Grammar-version tolerant accessors: some tree-sitter-java builds expose these
// as plain children rather than named fields.
const modsOf = node => node.childForFieldName('modifiers') || node.namedChildren.find(c => c.type === 'modifiers');
const fieldName = (node, field, types) => node.childForFieldName(field)?.text || node.namedChildren.find(c => types.includes(c.type))?.text;
const fieldNode = (node, field, types) => node.childForFieldName(field) || node.namedChildren.find(c => types.includes(c.type));

// Javadoc: comments are preceding siblings (optionally behind a modifiers node)
function docOf(node) {
  let raw = [];
  let sib = node.previousNamedSibling;
  while (sib) {
    if (sib.type === 'line_comment' || sib.type === 'block_comment') { raw.unshift(sib.text); sib = sib.previousNamedSibling; continue; }
    if (sib.type === 'modifiers') { sib = sib.previousNamedSibling; continue; }
    break;
  }
  if (!raw.length) return '';
  return raw.join('\n')
    .replace(/\/\*\*?|\*\//g, '')
    .split('\n').map(l => l.replace(/^\s*(\*|\/\/)\s?/, '').trim())
    .filter(l => l && !l.startsWith('@')).join(' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}
const DOC_ANNOS = new Set(['ApiOperation', 'Operation', 'Api', 'ApiModelProperty', 'Description', 'Tag']);
function annoDoc(anns) {
  const vals = [];
  for (const a of anns) {
    if (!DOC_ANNOS.has(a.name)) continue;
    for (const [, v] of a.args) {
      if (typeof v === 'string' && v.length > 1 && !/^[A-Z0-9_.]+$/.test(v)) vals.push(v);
    }
  }
  return [...new Set(vals)].join(' · ').slice(0, 300);
}

function annotations(node) {
  const mods = modsOf(node);
  if (!mods) return [];
  const list = [];
  for (const c of mods.namedChildren) {
    if (c.type !== 'annotation' && c.type !== 'marker_annotation') continue;
    const name = lastSeg(fieldName(c, 'name', ['identifier', 'scoped_identifier']) || '');
    const args = new Map();
    const argList = fieldNode(c, 'arguments', ['annotation_argument_list']);
    if (argList) for (const a of argList.namedChildren) {
      if (a.type === 'element_value_pair') {
        const key = a.childForFieldName('key')?.text || a.namedChildren[0]?.text;
        const val = a.childForFieldName('value')?.text || a.namedChildren[1]?.text;
        args.set(key, strip(val));
      } else if (a.type === 'string_literal') {
        args.set('value', strip(a.text));
      } else if (['identifier', 'field_access', 'scoped_identifier'].includes(a.type)) {
        // bare constant expression, e.g. @RabbitListener(queues = Constants.X) / @XxlJob(Constants.Y)
        args.set('value', a.text);
      }
    }
    list.push({ name, args });
  }
  return list;
}
const ann = (list, n) => list.find(a => a.name === n);
const annValue = a => a ? (a.args.get('value') ?? a.args.get('path') ?? '') : '';

const MAPPING = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH' };
const SEND_NAMES = new Set(['send', 'convertAndSend', 'syncSend', 'asyncSend', 'sendOneWay']);
const SEND_OBJECT = /(mqproducer|rocketmqtemplate|kafkatemplate|rabbittemplate|amqptemplate|producer|mqtemplate)/i;
// queue/exchange names may be literals, constants (Constants.X) or property placeholders (${x.y})
function topicLabel(x){
  x=strip(x).trim();
  const prop=x.match(/^\$\{(.+)\}$/);          // keep braces: placeholder must be matched first
  if(prop){
    const inner=prop[1];
    const m=inner.match(/(?:queue|exchange|topic)\.(.+)$/);
    return m?m[1]:lastSeg(inner);
  }
  x=x.replace(/^\{|\}$/g,'').trim();
  return x.includes('.')?lastSeg(x):x;
}
function topicNames(v){
  if(!v) return [];
  return String(v).split(',').map(x=>topicLabel(x.trim())).filter(Boolean);
}
/* ---- data layer: SQL tables + Redis cache keys ---- */
const SQL_ANNOS=new Set(['Select','Insert','Update','Delete','Query']);
const REDIS_OBJ=/(redis|redisson|jedis|stringredistemplate|redistemplate|cache)/i;
const REDIS_OPS=new Set(['get','set','hget','hset','hdel','del','delete','expire','incr','decr','put','getBucket','getMap','getAtomicLong','tryLock']);
function tableRefs(sql){
  const out=new Map();
  const s=String(sql).replace(/\s+/g,' ');
  const re=/\b(from|join|into|update)\s+[`"']?([A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)?)[`"']?/gi;
  let m;
  while((m=re.exec(s))){
    const verb=m[1].toLowerCase();
    const name=m[2].split('.').pop();
    if(/^(select|where|set|values|dual|table)$/i.test(name)) continue;
    const write=verb==='into'||verb==='update';
    const cur=out.get(name)||{name,read:false,write:false};
    if(write) cur.write=true; else cur.read=true;
    out.set(name,cur);
  }
  return [...out.values()];
}
export function emitTableEdges(ctx,mid,sql,site){
  for(const tb of tableRefs(sql)){
    const id='table:'+tb.name;
    ctx.node({id,type:'table',label:tb.name,props:{}});
    if(tb.read) ctx.edge({s:mid,t:id,rel:'READS_TABLE',site:site||''});
    if(tb.write) ctx.edge({s:mid,t:id,rel:'WRITES_TABLE',site:site||''});
  }
}

export function pass1(ctx, tree) {
  const { repo, file } = ctx;
  const scope = { package: '', imports: new Map(), classes: new Map(), fields: new Map(), injected: new Map() };
  ctx.scopes.set(file, scope);
  const isTestFile = file.includes('/src/test/') || file.includes('\\src\\test\\');
  const typeRels = [];

  const typeId = (pkg, name) => `${repo}#${file}::${pkg ? pkg + '.' : ''}${name}`;
  const methodId = (tid, name) => `${tid}.${name}`;

  function emitType(node, kind) {
    const name = node.childForFieldName('name')?.text;
    if (!name) return null;
    const tid = typeId(scope.package, name);
    const anns = annotations(node);
    const isTest = isTestFile || /Test$/.test(name) || kind === 'test-class';
    const isController = !!(ann(anns, 'RestController') || ann(anns, 'Controller'));
    const tableAnn = (ctx.config && ctx.config.tableAnnotations || ['TableName','Table']).map(n => ann(anns, n)).find(Boolean);
    if (tableAnn) {
      const tname = annValue(tableAnn) || tableAnn.args.get('name') || tableAnn.args.get('value') || '';
      const clean = String(tname).replace(/^["'{]+|["'}]+$/g, '').trim();
      if (clean) {
        ctx.node({ id: 'table:' + clean, type: 'table', label: clean, props: {} });
        ctx.entityTables.set(tid, clean);
      }
    }
    ctx.node({ id: tid, type: 'type', kind: isTest ? 'test-class' : kind, label: name, fqn: `${scope.package ? scope.package + '.' : ''}${name}`, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, props: { annotations: anns.map(a => a.name), controller: isController, doc: docOf(node) || undefined, apidoc: annoDoc(anns) || undefined } });
    ctx.edge({ s: `${repo}#repo`, t: tid, rel: 'CONTAINS' });
    scope.classes.set(name, tid);
    ctx.typeIndexPush(name, tid);
    const sup = node.childForFieldName('superclass');
    const ifaces = node.childForFieldName('interfaces');
    typeRels.push({ tid, superName: sup ? lastSeg(sup.text.replace(/^extends\s+/, '')) : null, ifaceNames: ifaces ? ifaces.namedChildren.map(c => lastSeg(c.text)) : [] });
    const superText = [sup && sup.text, ifaces && ifaces.text, ...node.namedChildren.filter(c => c.type === 'extends_interfaces').map(c => c.text)].filter(Boolean).join(' ');
    const bm = superText.match(/(?:BaseMapper|JpaRepository|CrudRepository|PagingAndSortingRepository)\s*<\s*([\w.]+)/);
    if (bm) ctx.mapperEntity.set(tid, lastSeg(bm[1]));
    const si = superText.match(/ServiceImpl\s*<\s*[\w.]+\s*,\s*([\w.]+)\s*>/);
    if (si) ctx.implEntity.set(tid, lastSeg(si[1]));
    return { tid, anns, isTest };
  }

  function emitMethod(node, owner, isTest) {
    const name = node.childForFieldName('name')?.text;
    if (!name || !owner) return null;
    const mid = methodId(owner.tid, name);
    const anns = annotations(node);
    let entry = '';
    if (isTest || ann(anns, 'Test')) entry = 'test';
    else if ((ctx.config && ctx.config.jobAnnotations || ['Scheduled','XxlJob','ElasticSimpleJob']).some(n => ann(anns, n))) entry = 'job';
    const mapping = Object.keys(MAPPING).find(k => ann(anns, k)) || (ann(anns, 'RequestMapping') ? 'RequestMapping' : null);
    if (mapping && owner.isController) entry = 'http';
    if (owner.isConsumer) entry = 'mq';
    const props = {};
    props.doc = docOf(node) || undefined;
    props.apidoc = annoDoc(anns) || undefined;
    const sched = ann(anns, 'Scheduled'); if (sched) props.cron = sched.args.get('cron') || '';
    const jobAnn = (ctx.config && ctx.config.jobAnnotations || ['Scheduled','XxlJob','ElasticSimpleJob']).map(n => [n, ann(anns, n)]).find(([n, a]) => a && n !== 'Scheduled');
    if (jobAnn) {
      const raw = jobAnn[1].args.get('value') || '';
      props.jobHandler = raw.includes('.') ? lastSeg(raw) : strip(raw);
    }
    ctx.node({ id: mid, type: entry === 'test' ? 'test' : 'method', kind: entry === 'test' ? 'test-method' : (node.type === 'constructor_declaration' ? 'constructor' : 'method'), label: name + '()', fqn: owner.fqn + '.' + name, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, entry, props });
    ctx.edge({ s: owner.tid, t: mid, rel: 'CONTAINS' });
    ctx.methodPush(owner.tid, name, mid);

    // contracts: provider endpoints
    if (owner.isController && mapping) {
      const mAnn = ann(anns, mapping);
      const verb = mapping === 'RequestMapping' ? (mAnn.args.get('method') || 'GET').replace(/RequestMethod\./, '') : MAPPING[mapping];
      const p = joinPath(owner.basePath, annValue(mAnn));
      const ep = endpointId(verb, p);
      ctx.node({ id: ep, type: 'endpoint', label: `${verb.toUpperCase()} ${p}`, props: { httpMethod: verb.toUpperCase(), path: p, doc: props.doc, apidoc: props.apidoc } });
      ctx.edge({ s: mid, t: ep, rel: 'EXPOSES' });
    }
    // contracts: feign consumer
    if (owner.isFeign && mapping) {
      const mAnn = ann(anns, mapping);
      const verb = mapping === 'RequestMapping' ? 'GET' : MAPPING[mapping];
      const p = joinPath(owner.basePath, annValue(mAnn));
      const p2 = applyGateway(p, ctx.config);
      const ep = endpointId(verb, p2);
      ctx.node({ id: ep, type: 'endpoint', label: `${verb} ${p2}`, props: { httpMethod: verb, path: p2 } });
      ctx.edge({ s: mid, t: ep, rel: 'CONSUMES', conf: 'certain', ev: 'feign' });
    }
    // contracts: MQ consumer
    if (owner.isConsumer && owner.topic) {
      ctx.node({ id: topicId(owner.topic), type: 'topic', label: owner.topic, props: { broker: owner.broker } });
      ctx.edge({ s: mid, t: topicId(owner.topic), rel: 'SUBSCRIBES' });
    }
    // configurable method-level MQ listeners (RabbitListener handled above with class-level queues)
    for (const lName of (ctx.config && ctx.config.mqListenerAnnotations || ['RabbitListener', 'KafkaListener'])) {
      if (lName === 'RabbitListener') continue;
      const la = ann(anns, lName);
      if (!la) continue;
      const broker = /kafka/i.test(lName) ? 'Kafka' : /rabbit/i.test(lName) ? 'RabbitMQ' : 'MQ';
      for (const tn of topicNames(la.args.get('topics') || la.args.get('queues') || la.args.get('value'))) {
        ctx.node({ id: topicId(tn), type: 'topic', label: tn, props: { broker } });
        ctx.edge({ s: mid, t: topicId(tn), rel: 'SUBSCRIBES' });
        ctx.setEntry(mid, 'mq');
      }
    }
    // Spring Cache: @Cacheable / @CachePut / @CacheEvict
    for (const cName of ['Cacheable', 'CachePut', 'CacheEvict']) {
      const ca = ann(anns, cName);
      if (!ca) continue;
      const rawVal = ca.args.get('value') || ca.args.get('cacheNames') || owner.cacheNS || '';
      const label = rawVal ? (String(rawVal).includes('{') ? topicNames(rawVal)[0] : topicLabel(rawVal)) : '';
      if (!label) continue;
      ctx.node({ id: 'cache:' + label, type: 'cache', label, props: { store: 'Cache' } });
      ctx.edge({ s: mid, t: 'cache:' + label, rel: 'USES_CACHE', ev: '@' + cName });
    }
    // MyBatis mapper annotations: @Select/@Insert/@Update/@Delete("SQL")
    for(const a of anns){
      if(!SQL_ANNOS.has(a.name)) continue;
      const sql=a.args.get('value')||'';
      if(sql) emitTableEdges(ctx,mid,sql,`${file}:method`);
    }
    // RabbitMQ: method-level @RabbitListener or class-level listener + @RabbitHandler
    const rabbit = ann(anns, 'RabbitListener');
    const rabbitHandler = ann(anns, 'RabbitHandler');
    const queues = [...new Set([
      ...(rabbit ? topicNames(rabbit.args.get('queues') || rabbit.args.get('value')) : []),
      ...(rabbitHandler ? (owner.rabbitQueues || []) : []),
    ])];
    for (const q of queues) {
      ctx.node({ id: topicId(q), type: 'topic', label: q, props: { broker: 'RabbitMQ', doc: props.doc } });
      ctx.edge({ s: mid, t: topicId(q), rel: 'SUBSCRIBES' });
      ctx.setEntry(mid, 'mq');
    }
    // locals + params for receiver resolution (method-scoped)
    const locals = new Map();
    const params = fieldNode(node, 'parameters', ['formal_parameters']);
    if (params) for (const p of params.namedChildren) {
      const pn = fieldName(p, 'name', ['identifier']), pt = fieldName(p, 'type', ['type_identifier', 'scoped_type_identifier', 'generic_type', 'integral_type', 'floating_point_type', 'boolean_type', 'array_type']);
      if (pn && pt) locals.set(pn, lastSeg(pt));
    }
    const body = node.childForFieldName('body');
    if (body) walkCalls(body, mid, owner.tid, locals);
    return mid;
  }

  function walkCalls(node, mid, classId, locals) {
    if (node.type === 'local_variable_declaration') {
      const decl = fieldNode(node, 'declarator', ['variable_declarator']);
      const vn = decl ? fieldName(decl, 'name', ['identifier']) : null;
      const vt = fieldName(node, 'type', ['type_identifier', 'scoped_type_identifier', 'generic_type', 'array_type']);
      if (vn && vt) locals.set(vn, lastSeg(vt));
    }
    if (node.type === 'method_invocation') {
      const name = node.childForFieldName('name')?.text;
      const obj = node.childForFieldName('object');
      const args = node.childForFieldName('arguments');
      const firstStr = args?.namedChildren.find(c => c.type === 'string_literal');
      // MQ producer detection
      if (SEND_NAMES.has(name) && obj && SEND_OBJECT.test(obj.text) && firstStr) {
        const tn = strip(firstStr.text);
        if (tn) {
          ctx.node({ id: topicId(tn), type: 'topic', label: tn, props: { broker: 'RocketMQ' } });
          ctx.edge({ s: mid, t: topicId(tn), rel: 'PRODUCES' });
        }
      }
      // duliday-style RabbitMQ sender: sendToMQ(message, Constants.EXCHANGE, Constants.ROUTING_KEY)
      if (name === 'sendToMQ' && args && args.namedChildren.length >= 3) {
        const ex = args.namedChildren[1], rk = args.namedChildren[2];
        // skip abstract-base signatures whose args are plain parameter names (exchange/routingKey)
        const isConst = ex && (ex.type === 'string_literal' || ex.type === 'field_access' || ex.type === 'scoped_identifier' || (ex.type === 'identifier' && /^[A-Z0-9_]+$/.test(ex.text)));
        const exText = ex ? ex.text : '';
        const label = isConst ? topicLabel(exText) : '';
        if (label) {
          const rkText = rk ? rk.text : '';
          ctx.node({ id: topicId(label), type: 'topic', label, props: { broker: 'RabbitMQ', routingKey: topicLabel(rkText) } });
          ctx.edge({ s: mid, t: topicId(label), rel: 'PRODUCES' });
        }
      }
      // SQL passed as a string literal (JdbcTemplate / mapper wrappers)
      if (args) for (const argNode of args.namedChildren) {
        if (argNode.type === 'string_literal') {
          const sql = strip(argNode.text);
          if (/\b(from|join|into|update)\s+[\w`]/i.test(sql)) emitTableEdges(ctx, mid, sql, `${file}:${node.startPosition.row + 1}`);
        }
      }
      // Redis / cache client calls: redisTemplate.opsForValue().get("key")
      if (obj && REDIS_OPS.has(name) && REDIS_OBJ.test(obj.text)) {
        const keyArg = args && args.namedChildren[0];
        let key = '';
        if (keyArg) {
          if (keyArg.type === 'string_literal') key = strip(keyArg.text);
          else if (keyArg.type === 'field_access' || keyArg.type === 'identifier') key = lastSeg(keyArg.text);
        }
        const GENERIC_KEY=/^(key|keys|cachekey|existskey|rediskey|subscribekey|lockkey|value|id|\d+)$/i;
        if (key && !GENERIC_KEY.test(key)) {
          const cid = 'cache:' + key;
          ctx.node({ id: cid, type: 'cache', label: key, props: { store: /redisson|jedis/i.test(obj.text) ? 'Redis' : 'Cache' } });
          ctx.edge({ s: mid, t: cid, rel: 'USES_CACHE', site: `${file}:${node.startPosition.row + 1}` });
        }
      }
      let recv;
      if (!obj) recv = { kind: 'this' };
      else if (obj.type === 'this') recv = { kind: 'this' };
      else if (obj.type === 'super') recv = { kind: 'super' };
      else if (obj.type === 'identifier') {
        const t = obj.text;
        if (locals.has(t)) recv = { kind: 'type', name: locals.get(t) };
        else if (scope.fields.has(t)) recv = { kind: 'type', name: scope.fields.get(t) };
        else if (scope.classes.has(t) || scope.imports.has(t)) recv = { kind: 'type', name: t };
        else recv = { kind: 'unknown' };
      } else if (obj.type === 'object_creation_expression') {
        recv = { kind: 'type', name: lastSeg(fieldName(obj, 'type', ['type_identifier', 'scoped_type_identifier', 'generic_type']) || '') };
      } else recv = { kind: 'unknown' };
      ctx.pending.push({ file, methodId: mid, classId, recv, name, line: node.startPosition.row + 1 });
    }
    for (const c of node.namedChildren) walkCalls(c, mid, classId, locals);
  }

  function walkClassBody(body, owner) {
    for (const c of body.namedChildren) {
      if (c.type === 'field_declaration') {
        const ft = lastSeg(fieldName(c, 'type', ['type_identifier', 'scoped_type_identifier', 'generic_type', 'array_type']) || '');
        const anns = annotations(c);
        for (const d of c.namedChildren) if (d.type === 'variable_declarator') {
          const fn = fieldName(d, 'name', ['identifier']);
          if (fn) {
            scope.fields.set(fn, ft);
            if (ann(anns, 'Autowired') || ann(anns, 'Resource')) scope.injected.set(fn, ft);
          }
        }
      } else if (c.type === 'method_declaration' || c.type === 'constructor_declaration') {
        if (c.type === 'constructor_declaration') {
          const params = fieldNode(c, 'parameters', ['formal_parameters']);
          if (params) for (const p of params.namedChildren) {
            const pn = fieldName(p, 'name', ['identifier']), pt = fieldName(p, 'type', ['type_identifier', 'scoped_type_identifier', 'generic_type']);
            if (pn && pt) scope.injected.set(pn, lastSeg(pt));
          }
        }
        emitMethod(c, owner, owner.isTest);
      }
    }
  }

  for (const top of tree.rootNode.namedChildren) {
    if (top.type === 'package_declaration') {
      scope.package = top.namedChildren.map(c => c.text).join('.');
    } else if (top.type === 'import_declaration') {
      const p = top.namedChildren.map(c => c.text).join('.');
      scope.imports.set(lastSeg(p), p);
    } else if (top.type === 'class_declaration' || top.type === 'interface_declaration' || top.type === 'enum_declaration') {
      const kind = top.type === 'interface_declaration' ? 'interface' : top.type === 'enum_declaration' ? 'enum' : 'class';
      const info = emitType(top, kind);
      if (!info) continue;
      const anns = info.anns;
      const feign = ann(anns, 'FeignClient');
      const controller = ann(anns, 'RestController') || ann(anns, 'Controller');
      const listener = ann(anns, 'RocketMQMessageListener');
      const rabbitClass = ann(anns, 'RabbitListener');
      const cacheCfg = ann(anns, 'CacheConfig');
      const owner = {
        tid: info.tid, fqn: `${scope.package ? scope.package + '.' : ''}${top.childForFieldName('name').text}`,
        isTest: info.isTest, isFeign: !!feign, isController: !!controller && top.type === 'class_declaration',
        isConsumer: !!listener, topic: listener ? (listener.args.get('topic') || '') : '',
        broker: listener ? 'RocketMQ' : '',
        rabbitQueues: rabbitClass ? topicNames(rabbitClass.args.get('queues') || rabbitClass.args.get('value')) : [],
        basePath: feign ? (feign.args.get('path') || '') : (controller ? annValue(ann(anns, 'RequestMapping')) : ''),
        cacheNS: cacheCfg ? (cacheCfg.args.get('cacheNames') || cacheCfg.args.get('value') || '') : '',
      };
      if (feign) ctx.feignServices.push({ tid: info.tid, service: feign.args.get('name') || feign.args.get('value') || '' });
      // API-interface convention (@FeignClient interface + Controller implements it):
      // register mapping annotations so the implementing controller can expose them
      if (top.type === 'interface_declaration') {
        const methods = new Map();
        const body = top.childForFieldName('body');
        if (body) for (const m of body.namedChildren) {
          if (m.type !== 'method_declaration') continue;
          const mn = fieldName(m, 'name', ['identifier']);
          const mas = annotations(m);
          const mk = Object.keys(MAPPING).find(k => ann(mas, k)) || (ann(mas, 'RequestMapping') ? 'RequestMapping' : null);
          if (!mn || !mk) continue;
          const ma = ann(mas, mk);
          const verb = mk === 'RequestMapping' ? (ma.args.get('method') || 'GET').replace(/RequestMethod\./, '').replace(/[{}]/g, '') : MAPPING[mk];
          methods.set(mn, { verb, path: annValue(ma) });
        }
        if (methods.size) ctx.apiIfaces.set(info.tid, { basePath: owner.basePath || '', methods });
      }
      ctx.classBase.set(info.tid, owner.basePath || '');
      const body = top.childForFieldName('body');
      if (body) walkClassBody(body, owner);
    }
  }
  ctx.typeRels.push(...typeRels.map(r => ({ ...r, file })));
}

export function pass2Types(ctx, file) {
  const scope = ctx.scopes.get(file);
  if (!scope) return;
  const resolveType = name => {
    if (!name) return [];
    const imp = scope.imports.get(name);
    if (imp && ctx.fqnIndex.has(imp)) return [ctx.fqnIndex.get(imp)];
    const samePkg = ctx.fqnIndex.get(scope.package ? scope.package + '.' + name : name);
    if (samePkg) return [samePkg];
    return ctx.typeIndex.get(name) || [];
  };
  // import edges
  for (const [simple, fqn] of scope.imports) {
    const tid = ctx.fqnIndex.get(fqn);
    if (tid) ctx.edge({ s: `${ctx.repo}#${file}`, t: tid, rel: 'IMPORTS', file });
  }
  // inheritance
  for (const r of ctx.typeRels.filter(r => r.file === file)) {
    if (r.superName) for (const t of resolveType(r.superName)) ctx.edge({ s: r.tid, t, rel: 'EXTENDS', file });
    for (const i of r.ifaceNames) for (const t of resolveType(i)) {
      ctx.edge({ s: r.tid, t, rel: 'IMPLEMENTS', file });
      ctx.implPush(t, r.tid);
      // controller implements an API interface → its methods expose the interface's endpoints
      const api = ctx.apiIfaces.get(t);
      const cls = ctx.nodes.get(r.tid);
      if (api && cls && cls.props && cls.props.controller) {
        // keep the API interface's CONSUMES edge: the interface is also the contract
        // external services call through; same-repo consumers are filtered in the UI
        const base = (ctx.classBase.get(r.tid) || api.basePath || '');
        for (const [mName, m] of api.methods) {
          const mid = ctx.methodsOf.get(r.tid)?.get(mName);
          if (!mid) continue;
          const p = joinPath(base, m.path);
          const ep = endpointId(m.verb, p);
          const mnode = ctx.nodes.get(mid);
          ctx.node({ id: ep, type: 'endpoint', label: `${m.verb} ${p}`, props: { httpMethod: m.verb, path: p, doc: mnode && mnode.props && mnode.props.doc, apidoc: mnode && mnode.props && mnode.props.apidoc } });
          ctx.edge({ s: mid, t: ep, rel: 'EXPOSES' });
          ctx.setEntry(mid, 'http');
        }
      }
    }
  }
}

export function pass2Calls(ctx, file) {
  const scope = ctx.scopes.get(file);
  if (!scope) return;
  const resolveType = name => {
    if (!name) return [];
    const imp = scope.imports.get(name);
    if (imp && ctx.fqnIndex.has(imp)) return [ctx.fqnIndex.get(imp)];
    const samePkg = ctx.fqnIndex.get(scope.package ? scope.package + '.' + name : name);
    if (samePkg) return [samePkg];
    return ctx.typeIndex.get(name) || [];
  };
  for (const site of ctx.pending.filter(p => p.file === file)) {
    let typeIds = [];
    if (site.recv.kind === 'this') typeIds = [site.classId];
    else if (site.recv.kind === 'super') {
      const sup = ctx.edgesSnapshot.find(e => e.s === site.classId && e.rel === 'EXTENDS');
      typeIds = sup ? [sup.t] : [];
    } else if (site.recv.kind === 'type') typeIds = resolveType(site.recv.name);
    if (!typeIds.length) { ctx.stats.unresolved++; continue; }
    for (const tid of typeIds) {
      const target = ctx.methodsOf.get(tid)?.get(site.name);
      if (!target) {
        const entName = ctx.mapperEntity.get(tid) || ctx.implEntity.get(tid);
        if (entName) {
          const entIds = resolveType(entName);
          let table = '';
          for (const eid of entIds) { table = ctx.entityTables.get(eid) || ''; if (table) break; }
          if (table) {
            const write = /^(insert|save|update|delete|remove|saveOrUpdate|saveBatch|updateById)/i.test(site.name);
            ctx.edge({ s: site.methodId, t: 'table:' + table, rel: write ? 'WRITES_TABLE' : 'READS_TABLE', site: `${file}:${site.line}`, file });
            continue;
          }
        }
        ctx.stats.unresolved++; continue;
      }
      const ambiguous = typeIds.length > 1;
      ctx.edge({ s: site.methodId, t: target, rel: 'CALLS', conf: ambiguous ? 'speculative' : 'certain', ev: ambiguous ? 'simple-name 多候选' : '', site: `${file}:${site.line}`, file });
      const tnode = ctx.nodes.get(tid);
      if (tnode && tnode.kind === 'interface') {
        const impls = ctx.impls.get(tid) || [];
        for (const impl of impls) {
          const im = ctx.methodsOf.get(impl)?.get(site.name);
          if (im) ctx.edge({ s: target, t: im, rel: 'CALLS', conf: impls.length === 1 ? 'inferred' : 'speculative', ev: impls.length === 1 ? '接口唯一实现 (DI)' : '接口多实现候选', site: `${file}:${site.line}`, file });
        }
      }
    }
  }
}