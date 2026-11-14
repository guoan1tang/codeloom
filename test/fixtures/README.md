# Fixtures & capability expectations

Each directory here is a **self-contained sample project** indexed by the test harness
(`test/harness/index.js`) and checked against its declarative `expect.json`.

Adding a capability test does not require writing test code:

1. Create `test/fixtures/<name>/` with a minimal project (git history is created by the harness).
2. Add `expect.json` describing what the graph must contain:

```json
{
  "edges": [
    { "s": "OrderController.create", "t": "ep:POST /orders/create", "rel": "EXPOSES" },
    { "s": "OrderService.createOrder", "t": "OrderServiceImpl.createOrder", "rel": "CALLS", "conf": "inferred" }
  ],
  "noEdges": [
    { "s": "VendorApi", "t": "ep:POST /x", "rel": "CONSUMES" }
  ],
  "nodes": [
    { "id": "OrderController", "type": "type", "props": { "controller": true } },
    { "id": "OrderServiceImpl.createOrder", "props": { "doc": "~创建订单" } }
  ],
  "summary": { "repos": 1, "endpoints": 4, "http": 4, "test": 1 }
}
```

Reference syntax:
- node id as-is (`ep:POST /orders`, `topic:order-created`, `table:t_order`, `cache:key`)
- shorthand `Class.method`, `method()`, `Class` (matched against `fqn`)
- string values prefixed with `~` assert a substring (handy for docs and evidence)

Semantics worth remembering:
- `Controller → interface method` is `CALLS` with `conf: "certain"`; the
  `interface method → implementation` dispatch edge is `conf: "inferred"` (or `speculative`
  when several implementations exist).
- `summary` counts are computed by `graphSummary()` in the harness (entries by kind,
  endpoints/topics/tables/caches/pages/tests).