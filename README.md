# labelproof

labelproof helps you check, before you ship or list a
product, what the public EPREL register actually says
about its energy label — and helps you keep a receipt
of exactly what you checked.

EPREL holds supplier-declared records: the brand, the
model, the declared label and product-sheet values.
None of that is independently verified, and this tool
treats it accordingly. A search reports candidate
records with an explicit match kind, so a miss reads
as "no match in the queried source", never as "not
registered". Comparisons stay a plain table of common
declared values, with no winner picked. The receipt
tool bundles your own lookups into a signed,
idempotent record of what was looked up and when.
Everything here is preflight evidence only: nothing
in this package decides conformity, CE marking, GPSR
or safety questions, or market access.

The lookups themselves run on a hosted preflight
service. This package is the local half: it answers
tools/list from a captured copy of that service's
surface and relays every call upstream, returning the
answer unchanged.

## Tools

- `search_eprel_products` — find candidate public
  records by `modelIdentifier`, by
  `registrationNumber`, or by `supplierOrBrand`
  narrowed with `productGroup`. Text searches need a
  product group because the live source searches one
  group at a time; registration-number lookups do not.
  All arguments are optional in the captured schema.
  Matches come back labelled `exact_public_record`,
  `possible_match`, `multiple_matches` or
  `no_match_in_queried_source`, with `unavailable`,
  `source_schema_unverified` and `stale` states for a
  source that cannot answer cleanly.
- `get_eprel_product_record` — expand one candidate
  via its `publicRecordId` into the structured record:
  declared supplier and group, declared fields,
  documents, missing fields, provenance and freshness.
- `get_eprel_energy_label_data` — the declared label
  and product-sheet values for one `publicRecordId`.
  The reply states plainly that the data is
  supplier-declared and not independently verified.
- `compare_eprel_product_metrics` — line up two to
  five records (`publicRecordIds`, optionally narrowed
  by `metricKeys`) on the metrics they share. Records
  from different product groups fail safely as
  `incompatible_comparison`; fewer than two usable
  identifiers returns `insufficient_identifiers`.
- `prepare_energy_label_preflight_receipt` — attest a
  set of lookups. Requires `bundle` (the fingerprinted
  results to attest, without raw query values) and
  `createdAt` (the ISO timestamp the bundle was
  assembled). The signed receipt commits to inputs,
  record references, sources, freshness and decision
  states — evidence of the checks, not of any outcome.

## Configuration

- `EU_ENERGY_MCP_URL` (optional) — replace the
  upstream endpoint, which defaults to
  `https://energy.mcp.jithox.com/mcp`. This override
  hook is a labelled reconstruction by this rebuild.
- `EU_ENERGY_API_KEY` (optional) — when set, its value
  is sent upstream on every request as
  `Authorization: Bearer <value>`; when unset, no key
  header leaves the machine. The `Authorization`
  header name is declared in the original service's
  registry record, but that record names no package
  environment variable and the surface was captured
  without a key, so the env name, the Bearer form and
  the forwarding itself are labelled reconstructions.

### How forwarding works

The first call opens a streamable-HTTP JSON-RPC
session upstream: an `initialize` request
(protocolVersion `2025-03-26`, clientInfo name
`labelproof`), a `notifications/initialized`
notification, then the `tools/call` request carrying
your arguments exactly as given. If the upstream
issues an `Mcp-Session-Id`, it is sent on all later
requests and the session is reused for the rest of
the process. Replies in plain JSON and in
server-sent-event framing are both understood.

Upstream results pass through verbatim, including an
`isError` flag set upstream. Local relay failures —
an upstream JSON-RPC error, a non-2xx reply, a body
that cannot be read, or a request that never
completes — surface as an `isError` result whose text
begins `labelproof error:` (a labelled
reconstruction of this rebuild).

## CLI

Every tool doubles as a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/labelproof search_eprel_products '{"modelIdentifier":"WM-100","productGroup":"washingmachines"}'
npx @reneturcios/labelproof get_eprel_product_record '{"publicRecordId":"rec-42"}'
npx @reneturcios/labelproof prepare_energy_label_preflight_receipt '{"bundle":{"lookups":[]},"createdAt":"2026-10-28T09:00:00Z"}'
npx @reneturcios/labelproof --version
```

Exit codes: `0` for a non-error result, `1` for an
`isError` result, `2` for a usage error.

## MCP server

```bash
npx -y @reneturcios/labelproof mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "labelproof": {
      "command": "npx",
      "args": ["-y", "@reneturcios/labelproof", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/labelproof
docker run --rm ghcr.io/cloudcorprecords/labelproof --version
```

The image defaults to the `mcp` command, so the first
form runs the stdio MCP server; other arguments go to
the CLI.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

Tests stub the upstream JSON-RPC service; the suite
makes no live network calls.

## License

MIT — see `LICENSE`.
