# BUILD REPORT — labelproof

Rebuild of `com.jithox/eu-energy-label-preflight` v0.3.1 (remote-only)
as `@reneturcios/labelproof` 0.1.0 / `io.github.CloudCorpRecords/labelproof`.
**Full surface built: all 5 captured tools (5/5).**

## Fixture conflicts

**None.** The spec, the brief, and the fixture agree on the five tool
names, their titles, and their required fields. Required fields as
served, taken from the fixture
(`harness/fixtures/eu-energy-label-preflight-tools-original.json`):

- `search_eprel_products` — NO `required` key in its schema
- `get_eprel_product_record` — NO `required` key in its schema
- `get_eprel_energy_label_data` — NO `required` key in its schema
- `compare_eprel_product_metrics` — NO `required` key in its schema
- `prepare_energy_label_preflight_receipt` — required: `bundle`, `createdAt`

The fixture's tool literals (name, title, description, inputSchema —
exactly the keys the fixture carries per tool) are served verbatim
from `src/forward.ts`; the literals were generated programmatically
from the fixture JSON (parsed and re-serialised by
`/tmp/b39-labelproof-gen.py`, never retyped) and verified by the
registration-integrity test (served tools/list deep-equals the
fixture's 5 tool objects, in order) and again by the parity harness.

## What was built

All 19 factory files under `builds/labelproof/`:

- `package.json` (`@reneturcios/labelproof` 0.1.0, bin
  `labelproof` → `dist/cli.js`, `mcpName`
  `io.github.CloudCorpRecords/labelproof`, deps exactly
  `@modelcontextprotocol/sdk ^1` + `zod ^3`; devDeps `@types/node ^20`,
  `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 83-char string
  "Read-only EU energy-label preflight checks against supplier-declared EPREL records.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/labelproof:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/labelproof"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/labelproof`, smoke assertion on server
  name `labelproof`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://energy.mcp.jithox.com/mcp` (pinned),
  overridable via `EU_ENERGY_MCP_URL` (LABELLED RECONSTRUCTION).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `labelproof`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `EU_ENERGY_API_KEY` is set, an `Authorization: Bearer <key>`
  header is sent on every upstream request. When unset (or blank), no
  key header is sent. No `X-API-Key` header is sent in either case.
  Both branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `labelproof error:` text
  results (LABELLED RECONSTRUCTION).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers)
  serving the fixture literals exactly; no `McpServer` + zod
  registration (per the task brief, overriding TEMPLATE.md §2 item 12).
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed beyond the coordinator's tools/list
  captures.

## Labelled reconstructions (from the spec's Wire section)

- `EU_ENERGY_MCP_URL` env override of the pinned endpoint
  `https://energy.mcp.jithox.com/mcp`.
- `EU_ENERGY_API_KEY` env name and the forwarding of its value as
  `Authorization: Bearer <value>` (the header name is pinned by the
  registry record's own remote declaration, which declares a required
  secret `Authorization` header; the Bearer form and the env
  forwarding are reconstructions — the record pins no package env
  name and the capture was keyless).
- The `labelproof error:` failure rendering for upstream failures.

## Lockfile (Route 3, clean from birth)

Generated in the build dir with no `node_modules` present and no
pre-existing lockfile:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified after the later `npm install --offline --ignore-scripts`:
parses, `name == @reneturcios/labelproof`,
**128 package entries**, sha256
`02bdc1a776351bed3cf9a1105ec39bc2575adcfb6932a365af16a0bc8b17deae`.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js, forward.js, mcp.js, index.js,
  types.js, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **60 tests, 60 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 5 tool
  objects, names/titles in order, exactly the fixture's keys per tool,
  required fields per tool (four tools with no `required` key, receipt
  with `bundle`/`createdAt`), every property key in order, type-object /
  additionalProperties-false, search/record/comparison/receipt property
  constraints, preflight wording, isKnownTool; session
  establishment/reuse/session-id handling, clientInfo/protocol version;
  env URL override, explicit url override, explicit-over-env precedence,
  blank-env fallback; Authorization Bearer header present on every
  request when the key is set / absent when unset or blank / no
  X-API-Key header in either case; verbatim argument forwarding for all
  five tools incl. fully-specified calls; verbatim result pass-through
  incl. upstream isError and SSE; JSON-RPC/init/malformed/no-result/
  HTTP/throw/timeout failures → `labelproof error:`; parseRpcBody JSON +
  SSE + matching-id + [DONE] cases; MCP-layer MethodNotFound /
  InvalidParams validation; CLI --version / -v / unknown exit 2 /
  bad-JSON exit 2 / `mcp extra` exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/eu-energy-label-preflight-tools-original.json
  --rebuild "stdio:node builds/labelproof/dist/cli.js mcp" --out
  builds/labelproof/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 5/5 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 83 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for labelproof from the
spec; only factory mechanics were patterned on the reference imgpage
build, and only the fixture's tool literals are served verbatim.
