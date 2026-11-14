# Contributing to CodeLoom

Thanks for helping. Two contributions matter most: **fixtures** (proof a project
structure works) and **language packs** (new languages).

## Development

```bash
npm install
npm test            # node:test — unit, fixture matrix, MCP, server, Web API, perf smoke
```

Requirements: Node >= 22.13 and Git. No native builds.

## Adding a capability fixture (no test code required)

1. Create `test/fixtures/<name>/` with a **minimal** sample project (10–20 files).
2. Add `expect.json` describing the graph you expect:

```json
{
  "edges": [
    { "s": "OrderController.create", "t": "ep:POST /orders", "rel": "EXPOSES" },
    { "s": "OrderServiceImpl.createOrder", "t": "table:t_order", "rel": "WRITES_TABLE" }
  ],
  "noOutgoing": [
    { "s": "DynamicMapper.byTable", "rel": "READS_TABLE" }
  ],
  "nodes": [
    { "id": "StockSyncJob.run", "props": { "entry": "job", "jobHandler": "stock-sync" } }
  ],
  "noNodes": ["InnerClass"],
  "summary": { "repos": 1, "endpoints": 2, "tables": 1 }
}
```

Reference syntax and semantics: `test/fixtures/README.md`.

For multi-repository scenarios put subdirectories under one group plus an optional
`global-config.json` (gateway routes) and a group-level `expect.json`; see
`test/fixtures/cross-repo/`.

Then add one line to `test/capabilities.test.js`:

```js
test('<name>: <what it proves>', async (t) => {
  const fx = await setupFixture(t, '<name>');   // or setupGroup for multi-repo
  assertFixture(fx.g, '<name>');
});
```

## Adding a language pack

A pack is a module in `src/packs/` exporting:

- `extensions` — file extensions it owns
- `grammar` (or `grammarFor(file)`) — a `tree-sitter-wasms` grammar name
- `pass1(ctx, tree)` — emit `type` / `method` / `endpoint` / `topic` nodes and call sites
- `pass2Types(ctx, file)` — imports and inheritance (repo-wide index available)
- `pass2Calls(ctx, file)` — resolve call sites, emit `CALLS` with confidence

Packs read per-repo conventions from `ctx.config` (`codeloom.config.json` or the
global config in the web UI). See `src/packs/java.js` and `src/packs/typescript.js`.

Ship a fixture for the language and document any known gaps in its `expect.json`
using `noOutgoing` / `noNodes` so blind spots stay explicit.

## Pull request checklist

- `npm test` passes (fixtures, MCP contract, API, perf smoke)
- New capabilities come with a fixture + `expect.json`
- Known limitations are recorded (negative assertions or README notes), not hidden
- No new native dependencies (install must stay `npx`-able)