# Changelog

## 0.1.0 (2026-10-28)

- First release: a local forwarding client for the hosted EU energy-label preflight service. The five captured tools are served locally for tools/list, and every tools/call is relayed upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, with the Mcp-Session-Id header honoured when the upstream issues one).
- Tools: `search_eprel_products`, `get_eprel_product_record`, `get_eprel_energy_label_data`, `compare_eprel_product_metrics`, and `prepare_energy_label_preflight_receipt`. The surface is read-only preflight evidence over supplier-declared EPREL records; it submits nothing to any authority.
- Upstream results pass through verbatim; relay failures surface as `labelproof error:` text results.
- One bin provides the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). The upstream endpoint can be overridden with `EU_ENERGY_MCP_URL`; when `EU_ENERGY_API_KEY` is set it is forwarded as an `Authorization: Bearer` header.
