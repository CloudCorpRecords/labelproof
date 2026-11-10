import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  createClient,
  callTool,
  DEFAULT_ENDPOINT_URL,
  isKnownTool,
  LabelproofClient,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test talks to a stub upstream that mimics the
 * streamable-HTTP session (initialize, then
 * notifications/initialized, then tools/call). The real
 * hosted endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/eu-energy-label-preflight-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const SEARCH = "search_eprel_products";
const RECORD = "get_eprel_product_record";
const LABEL = "get_eprel_energy_label_data";
const COMPARE = "compare_eprel_product_metrics";
const RECEIPT = "prepare_energy_label_preflight_receipt";

const SAMPLE = {
  content: [{ type: "text", text: "{\"matchKind\":\"exact_public_record\"}" }],
  structuredContent: { matchKind: "exact_public_record" },
};

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface StubOptions {
  result?: Record<string, unknown>;
  rawCallBody?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  failOn?: "initialize" | "tools/call";
  session?: string | null;
  hangCall?: boolean;
  sse?: boolean;
}

function stubResponse(
  status: number,
  text: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const map = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
    text: async () => text,
  };
}

function stubJson(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return stubResponse(status, JSON.stringify(payload), headers);
}

function buildUpstream(opts: StubOptions = {}): { fetchFn: FetchFn; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    seen.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (opts.failOn === method) throw new Error("connection reset");
    if (method === "initialize") {
      if (opts.initError !== undefined) {
        return stubJson(200, { jsonrpc: "2.0", id: body.id, error: opts.initError });
      }
      const headers: Record<string, string> = {};
      const sid = opts.session === undefined ? "sess-abc" : opts.session;
      if (sid !== null) headers["mcp-session-id"] = sid;
      return stubJson(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "eu-energy-label-preflight", version: "0.3.1" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") return stubResponse(202, "");
    if (method === "tools/call") {
      if (opts.hangCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (opts.rawCallBody !== undefined) {
        return stubResponse(opts.callStatus ?? 200, opts.rawCallBody);
      }
      if (opts.callError !== undefined) {
        return stubJson(200, { jsonrpc: "2.0", id: body.id, error: opts.callError });
      }
      const payload = { jsonrpc: "2.0", id: body.id, result: opts.result ?? SAMPLE };
      if (opts.sse) {
        return stubResponse(200, `event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      return stubJson(opts.callStatus ?? 200, payload);
    }
    return stubJson(200, {});
  };
  return { fetchFn, seen };
}

function clientWith(opts: StubOptions = {}, extra: Record<string, unknown> = {}) {
  const up = buildUpstream(opts);
  const client = new LabelproofClient({ fetchFn: up.fetchFn, env: {}, ...extra });
  return { client, seen: up.seen };
}

function firstText(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methodList(seen: Seen[]): string[] {
  return seen.map((s) => s.body.method as string);
}

function propsOf(tool: ToolDef): Record<string, Record<string, unknown>> {
  return (tool.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;
}

/* ------------------------------------------------------------------ */

describe("registration integrity against the captured fixture", () => {
  it("serves all five fixture tools deep-equal and in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 5);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("lists the five names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, [SEARCH, RECORD, LABEL, COMPARE, RECEIPT]);
  });

  it("keeps exactly the fixture keys on every tool, title included", () => {
    for (const tool of TOOL_DEFS) {
      assert.deepEqual(Object.keys(tool).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });

  it("serves the fixture titles verbatim", () => {
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      [
        "Search public energy-label records",
        "Get one public record",
        "Get declared label data",
        "Compare declared metrics",
        "Prepare a preflight receipt",
      ],
    );
  });

  it("serves required fields exactly as captured per tool", () => {
    for (let i = 0; i < 4; i += 1) {
      assert.equal(
        "required" in (TOOL_DEFS[i].inputSchema as object),
        false,
        `${TOOL_DEFS[i].name} must carry no required key`,
      );
      assert.equal(
        (TOOL_DEFS[i].inputSchema as { required?: string[] }).required,
        undefined,
      );
    }
    assert.deepEqual(
      (TOOL_DEFS[4].inputSchema as { required?: string[] }).required,
      ["bundle", "createdAt"],
    );
  });

  it("keeps every fixture property in order for all five tools", (t) => {
    if (skipWithoutFixture(t)) return;
    const expected: string[][] = [
      ["modelIdentifier", "supplierOrBrand", "productGroup", "registrationNumber"],
      ["publicRecordId"],
      ["publicRecordId"],
      ["publicRecordIds", "metricKeys"],
      ["bundle", "createdAt"],
    ];
    for (let i = 0; i < 5; i += 1) {
      assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[i])), expected[i]);
      assert.deepEqual(
        Object.keys(propsOf(TOOL_DEFS[i])),
        Object.keys(propsOf(fixture.tools[i])),
      );
    }
  });

  it("keeps type object and additionalProperties false on every schema", () => {
    for (const tool of TOOL_DEFS) {
      const schema = tool.inputSchema as { type?: unknown; additionalProperties?: unknown };
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
    }
  });

  it("keeps the search property constraints verbatim", () => {
    const p = propsOf(TOOL_DEFS[0]);
    assert.equal(p.modelIdentifier.type, "string");
    assert.equal(p.modelIdentifier.minLength, 1);
    assert.equal(p.modelIdentifier.maxLength, 120);
    assert.equal(p.supplierOrBrand.maxLength, 200);
    assert.equal(p.productGroup.maxLength, 80);
    assert.equal(p.registrationNumber.maxLength, 80);
  });

  it("keeps the single-record property constraints verbatim", () => {
    for (const idx of [1, 2]) {
      const p = propsOf(TOOL_DEFS[idx]);
      assert.equal(p.publicRecordId.type, "string");
      assert.equal(p.publicRecordId.minLength, 1);
      assert.equal(p.publicRecordId.maxLength, 80);
    }
  });

  it("keeps the comparison property constraints verbatim", () => {
    const p = propsOf(TOOL_DEFS[3]);
    assert.equal(p.publicRecordIds.type, "array");
    assert.equal(p.publicRecordIds.minItems, 1);
    assert.equal(p.publicRecordIds.maxItems, 5);
    assert.deepEqual(p.publicRecordIds.items, { type: "string", minLength: 1, maxLength: 80 });
    assert.equal(p.metricKeys.type, "array");
    assert.equal(p.metricKeys.maxItems, 10);
    assert.deepEqual(p.metricKeys.items, { type: "string", minLength: 1, maxLength: 60 });
  });

  it("keeps the receipt property constraints verbatim", () => {
    const p = propsOf(TOOL_DEFS[4]);
    assert.equal(p.bundle.type, "object");
    assert.equal(p.createdAt.type, "string");
    assert.equal(p.createdAt.minLength, 1);
    assert.equal(p.createdAt.maxLength, 40);
  });

  it("keeps the preflight-only wording in the captured descriptions", () => {
    assert.match(TOOL_DEFS[0].description, /never a conformity, CE, GPSR, safety or market-access determination/);
    assert.match(TOOL_DEFS[2].description, /independentlyVerifiedByJithox=false/);
    assert.match(TOOL_DEFS[3].description, /no ranking, no buying advice/);
    assert.match(TOOL_DEFS[4].description, /Ed25519-signed receipt/);
  });

  it("isKnownTool accepts the five tools and rejects anything else", () => {
    for (const n of [SEARCH, RECORD, LABEL, COMPARE, RECEIPT]) {
      assert.equal(isKnownTool(n), true);
    }
    assert.equal(isKnownTool("search_products"), false);
    assert.equal(isKnownTool(""), false);
  });
});

/* ------------------------------------------------------------------ */

describe("session handling", () => {
  it("opens with initialize, notifications/initialized, then tools/call", async () => {
    const { client, seen } = clientWith();
    const out = await client.callTool(SEARCH, { modelIdentifier: "WM-100" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(methodList(seen), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.equal(DEFAULT_ENDPOINT_URL, "https://energy.mcp.jithox.com/mcp");
    assert.ok(seen.every((s) => s.url === DEFAULT_ENDPOINT_URL));
    for (const s of seen) {
      assert.equal(s.headers["Content-Type"], "application/json");
      assert.equal(s.headers["Accept"], "application/json, text/event-stream");
    }
    assert.equal(seen[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(seen[1].headers["Mcp-Session-Id"], "sess-abc");
    assert.equal(seen[2].headers["Mcp-Session-Id"], "sess-abc");
  });

  it("identifies itself as labelproof with protocol 2025-03-26 on initialize", async () => {
    const { client, seen } = clientWith();
    await client.callTool(RECORD, { publicRecordId: "rec-1" });
    const params = seen[0].body.params as Record<string, unknown>;
    assert.equal(params.protocolVersion, "2025-03-26");
    assert.equal(params.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(params.capabilities, {});
    assert.deepEqual(params.clientInfo, { name: "labelproof", version: VERSION });
  });

  it("opens the session once and reuses it for later calls", async () => {
    const { client, seen } = clientWith();
    await client.callTool(SEARCH, {});
    await client.callTool(LABEL, { publicRecordId: "rec-9" });
    assert.deepEqual(methodList(seen), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(seen[3].headers["Mcp-Session-Id"], "sess-abc");
    assert.notEqual(seen[2].body.id, seen[3].body.id);
  });

  it("sends no session header when upstream issues none", async () => {
    const { client, seen } = clientWith({ session: null });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, undefined);
    assert.ok(seen.every((s) => s.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the EU_ENERGY_MCP_URL environment override", async () => {
    const up = buildUpstream();
    const client = new LabelproofClient({
      fetchFn: up.fetchFn,
      env: { EU_ENERGY_MCP_URL: "https://alt.example.org/mcp" },
    });
    await client.callTool(SEARCH, {});
    assert.ok(up.seen.every((s) => s.url === "https://alt.example.org/mcp"));
  });

  it("honours an explicit url override", async () => {
    const up = buildUpstream();
    const client = createClient({
      fetchFn: up.fetchFn,
      env: {},
      url: "https://direct.example.org/mcp",
    });
    await client.callTool(RECORD, {});
    assert.ok(up.seen.every((s) => s.url === "https://direct.example.org/mcp"));
  });

  it("prefers the explicit url over the env override", async () => {
    const up = buildUpstream();
    const client = createClient({
      fetchFn: up.fetchFn,
      env: { EU_ENERGY_MCP_URL: "https://env.example.org/mcp" },
      url: "https://direct.example.org/mcp",
    });
    await client.callTool(SEARCH, {});
    assert.ok(up.seen.every((s) => s.url === "https://direct.example.org/mcp"));
  });

  it("falls back to the pinned endpoint when the env override is blank", async () => {
    const up = buildUpstream();
    const client = new LabelproofClient({
      fetchFn: up.fetchFn,
      env: { EU_ENERGY_MCP_URL: "   " },
    });
    await client.callTool(SEARCH, {});
    assert.ok(up.seen.every((s) => s.url === DEFAULT_ENDPOINT_URL));
  });
});

/* ------------------------------------------------------------------ */

describe("optional key forwarding", () => {
  it("sends Authorization: Bearer on every request when EU_ENERGY_API_KEY is set", async () => {
    const up = buildUpstream();
    const client = new LabelproofClient({
      fetchFn: up.fetchFn,
      env: { EU_ENERGY_API_KEY: "energy-key-7" },
    });
    await client.callTool(SEARCH, {});
    assert.equal(up.seen.length, 3);
    assert.ok(
      up.seen.every((s) => s.headers["Authorization"] === "Bearer energy-key-7"),
    );
  });

  it("sends no Authorization header when EU_ENERGY_API_KEY is unset", async () => {
    const { client, seen } = clientWith();
    await client.callTool(SEARCH, {});
    assert.ok(seen.every((s) => s.headers["Authorization"] === undefined));
  });

  it("treats a blank EU_ENERGY_API_KEY as unset", async () => {
    const up = buildUpstream();
    const client = new LabelproofClient({
      fetchFn: up.fetchFn,
      env: { EU_ENERGY_API_KEY: "   " },
    });
    await client.callTool(SEARCH, {});
    assert.ok(up.seen.every((s) => s.headers["Authorization"] === undefined));
  });

  it("never sends an X-API-Key header in either branch", async () => {
    const withKey = buildUpstream();
    const c1 = new LabelproofClient({
      fetchFn: withKey.fetchFn,
      env: { EU_ENERGY_API_KEY: "energy-key-7" },
    });
    await c1.callTool(SEARCH, {});
    assert.ok(withKey.seen.every((s) => s.headers["X-API-Key"] === undefined));
    const { client: c2, seen } = clientWith();
    await c2.callTool(SEARCH, {});
    assert.ok(seen.every((s) => s.headers["X-API-Key"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("argument forwarding and result pass-through", () => {
  it("forwards a minimal search call verbatim", async () => {
    const { client, seen } = clientWith();
    const args = { registrationNumber: "EPREL-123" };
    await client.callTool(SEARCH, args);
    const params = seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a fully specified search call verbatim", async () => {
    const { client, seen } = clientWith();
    const args = {
      modelIdentifier: "WM-100",
      supplierOrBrand: "Acme",
      productGroup: "washingmachines",
      registrationNumber: "EPREL-123",
    };
    await client.callTool(SEARCH, args);
    const params = seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a product-record call verbatim", async () => {
    const { client, seen } = clientWith();
    await client.callTool(RECORD, { publicRecordId: "rec-42" });
    const params = seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, RECORD);
    assert.deepEqual(params.arguments, { publicRecordId: "rec-42" });
  });

  it("forwards an energy-label-data call verbatim", async () => {
    const { client, seen } = clientWith();
    await client.callTool(LABEL, { publicRecordId: "rec-42" });
    const params = seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, LABEL);
    assert.deepEqual(params.arguments, { publicRecordId: "rec-42" });
  });

  it("forwards a comparison call verbatim", async () => {
    const { client, seen } = clientWith();
    const args = {
      publicRecordIds: ["rec-1", "rec-2", "rec-3"],
      metricKeys: ["energyConsumptionPerCycle"],
    };
    await client.callTool(COMPARE, args);
    const params = seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, COMPARE);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a receipt call verbatim, bundle and timestamp included", async () => {
    const { client, seen } = clientWith();
    const args = {
      bundle: { lookups: [{ tool: SEARCH, state: "exact_public_record" }] },
      createdAt: "2026-10-28T09:00:00Z",
    };
    await client.callTool(RECEIPT, args);
    const params = seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, RECEIPT);
    assert.deepEqual(params.arguments, args);
  });

  it("returns the upstream result exactly, extra fields included", async () => {
    const { client } = clientWith();
    const out = await client.callTool(SEARCH, {});
    assert.deepEqual(out, SAMPLE);
  });

  it("returns an upstream isError result untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "source unavailable" }],
      isError: true,
    };
    const { client } = clientWith({ result: upstreamResult });
    const out = await client.callTool(RECORD, { publicRecordId: "rec-1" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed upstream reply", async () => {
    const { client } = clientWith({ sse: true });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE);
  });

  it("the one-shot callTool helper relays under the requested name", async () => {
    const up = buildUpstream();
    const out = await callTool(
      COMPARE,
      { publicRecordIds: ["a", "b"] },
      { fetchFn: up.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = up.seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, COMPARE);
    assert.deepEqual(params.arguments, { publicRecordIds: ["a", "b"] });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures become labelproof error results", () => {
  it("renders a tools/call JSON-RPC error", async () => {
    const { client } = clientWith({
      callError: { code: -32000, message: "upstream lookup failed" },
    });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "labelproof error: upstream lookup failed");
  });

  it("renders an initialize JSON-RPC error", async () => {
    const { client } = clientWith({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "labelproof error: bad initialize");
  });

  it("renders an unparseable reply as malformed", async () => {
    const { client } = clientWith({ rawCallBody: "<html>oops</html>" });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "labelproof error: malformed response");
  });

  it("renders a reply with no result object as malformed", async () => {
    const { client } = clientWith({
      rawCallBody: '{"jsonrpc":"2.0","id":3,"result":null}',
    });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "labelproof error: malformed response");
  });

  it("renders a non-2xx status with its code", async () => {
    const { client } = clientWith({ rawCallBody: "internal error", callStatus: 500 });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "labelproof error: HTTP 500");
  });

  it("renders a throwing tools/call fetch", async () => {
    const { client } = clientWith({ failOn: "tools/call" });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^labelproof error: /);
  });

  it("renders a throwing initialize fetch", async () => {
    const { client } = clientWith({ failOn: "initialize" });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.equal(firstText(out), "labelproof error: connection reset");
  });

  it("renders a timed-out call", async () => {
    const { client } = clientWith({ hangCall: true }, { timeoutMs: 20 });
    const out = await client.callTool(SEARCH, {});
    assert.equal(out.isError, true);
    assert.match(firstText(out), /^labelproof error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and honours the matching id", () => {
    assert.deepEqual(parseRpcBody('{"jsonrpc":"2.0","id":7,"result":{"ok":true}}', 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("selects the matching message among several SSE entries", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { n: 2 },
    });
  });

  it("skips the SSE [DONE] sentinel", () => {
    const body = 'data: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\ndata: [DONE]\n';
    assert.deepEqual(parseRpcBody(body, 4), {
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });

  it("returns null for empty, unparseable and array bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json"), null);
    assert.equal(parseRpcBody("[1,2,3]"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound and no network use", async () => {
    const up = buildUpstream();
    const client = createClient({ fetchFn: up.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(client, "not_a_tool", {}),
      (err: unknown) => err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(up.seen.length, 0);
  });

  it("rejects array arguments with InvalidParams and no network use", async () => {
    const up = buildUpstream();
    const client = createClient({ fetchFn: up.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(client, SEARCH, ["nope"]),
      (err: unknown) => err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(up.seen.length, 0);
  });

  it("rejects string arguments with InvalidParams and no network use", async () => {
    const up = buildUpstream();
    const client = createClient({ fetchFn: up.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(client, RECORD, "rec-1"),
      (err: unknown) => err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(up.seen.length, 0);
  });

  it("forwards a valid search call through the MCP layer unchanged", async () => {
    const up = buildUpstream();
    const client = createClient({ fetchFn: up.fetchFn, env: {} });
    const out = await handleCallTool(client, SEARCH, { modelIdentifier: "WM-100" });
    assert.deepEqual(out, SAMPLE);
    const params = up.seen[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { modelIdentifier: "WM-100" });
  });

  it("forwards a valid receipt call through the MCP layer unchanged", async () => {
    const up = buildUpstream();
    const client = createClient({ fetchFn: up.fetchFn, env: {} });
    const args = { bundle: { lookups: [] }, createdAt: "2026-10-28T09:00:00Z" };
    const out = await handleCallTool(client, RECEIPT, args);
    assert.deepEqual(out, SAMPLE);
    const params = up.seen[2].body.params as Record<string, unknown>;
    assert.equal(params.name, RECEIPT);
    assert.deepEqual(params.arguments, args);
  });

  it("treats omitted arguments as an empty object", async () => {
    const up = buildUpstream();
    const client = createClient({ fetchFn: up.fetchFn, env: {} });
    const out = await handleCallTool(client, RECORD, undefined);
    assert.deepEqual(out, SAMPLE);
    const params = up.seen[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI surface", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
    assert.equal(res.stdout.trim(), VERSION);
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli([SEARCH, "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli([SEARCH, "[]"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after mcp exit 2", () => {
    const res = runCli(["mcp", "extra"]);
    assert.equal(res.status, 2);
  });
});
