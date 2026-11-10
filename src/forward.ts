/**
 * labelproof core: a relay to the hosted EU energy-label
 * preflight MCP service.
 *
 * Locally this module does only two things: it holds the
 * captured tool definitions and returns them for
 * tools/list, and it forwards each tools/call to the
 * upstream endpoint. The forwarding speaks streamable
 * HTTP JSON-RPC: an initialize request, then the
 * notifications/initialized notification, then the call
 * itself. If the initialize response carries an
 * Mcp-Session-Id header, that identifier is attached to
 * every following request. The session is opened on
 * first use and kept for the lifetime of the client.
 *
 * The upstream address is fixed to
 * https://energy.mcp.jithox.com/mcp unless the
 * EU_ENERGY_MCP_URL environment variable replaces it
 * (a labelled reconstruction). If EU_ENERGY_API_KEY is
 * present in the environment, each upstream request
 * also carries `Authorization: Bearer <value>`; the
 * header name comes from the original registry record,
 * while the env name, the Bearer form and the act of
 * forwarding a key from the environment are labelled
 * reconstructions, because the record names no package
 * env variable and the surface was captured without a
 * key. Without the variable, no key header is sent.
 *
 * Whatever the upstream returns as its result is handed
 * back untouched. Problems on the way there — a JSON-RPC
 * error object, a non-2xx status, an unreadable body, a
 * failed or timed-out request — are reported as an
 * isError result whose text starts with
 * `labelproof error:` (also a labelled reconstruction).
 * Upstream bodies may be plain JSON or server-sent
 * events; in the SSE case the message matching the
 * request id is the one that counts.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://energy.mcp.jithox.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Captured tool definitions, served verbatim for tools/list.          */
/* Produced by /tmp/b39-labelproof-gen.py from                         */
/* harness/fixtures/eu-energy-label-preflight-tools-original.json      */
/* (fixture JSON parsed and re-serialised; never retyped).             */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "search_eprel_products",
    "title": "Search public energy-label records",
    "description": "Search the queried source by model identifier, registration number, or supplier/brand + product group. Returns CANDIDATE public records with deterministic match kinds and visible ambiguity: 'exact_public_record' / 'possible_match' / 'multiple_matches' / 'no_match_in_queried_source' — a no-match is never 'not registered'. Outage → 'unavailable'; unverified schema → 'source_schema_unverified'; stale → 'stale'. Answers come from the queried source at the stated retrieval time: the official EPREL Public API in live mode, or a clearly-labelled synthetic fixture in dev/test — provenance.sourceAuthority names which. Supplier-declared data only; Jithox verifies nothing. Preflight evidence only — never a conformity, CE, GPSR, safety or market-access determination.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "modelIdentifier": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120,
          "description": "The supplier's model identifier to search for."
        },
        "supplierOrBrand": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200,
          "description": "Supplier or trade brand to narrow the search."
        },
        "productGroup": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "description": "Product group to narrow the search (must be covered by the queried source). The official live source searches ONE group at a time: text searches (model/brand) REQUIRE it; registration-number lookups do not."
        },
        "registrationNumber": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "description": "A public registration number, when known."
        }
      }
    }
  },
  {
    "name": "get_eprel_product_record",
    "title": "Get one public record",
    "description": "Structure ONE public record by its public record identifier: declared supplier/brand, product group, declared public fields, documents, missing fields, provenance and freshness. 'exact_public_record' / 'no_match_in_queried_source' / 'unavailable'. Answers come from the queried source at the stated retrieval time: the official EPREL Public API in live mode, or a clearly-labelled synthetic fixture in dev/test — provenance.sourceAuthority names which. Supplier-declared data only; Jithox verifies nothing. Preflight evidence only — never a conformity, CE, GPSR, safety or market-access determination.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "publicRecordId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "description": "The public record identifier (from a prior search candidate)."
        }
      }
    }
  },
  {
    "name": "get_eprel_energy_label_data",
    "title": "Get declared label data",
    "description": "Structure the supplier-DECLARED energy-label / product-sheet data for one public record. The result states supplierDeclared=true and independentlyVerifiedByJithox=false explicitly — nothing is independently verified. Answers come from the queried source at the stated retrieval time: the official EPREL Public API in live mode, or a clearly-labelled synthetic fixture in dev/test — provenance.sourceAuthority names which. Preflight evidence only — never a conformity, CE, GPSR, safety or market-access determination.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "publicRecordId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "description": "The public record identifier whose declared label data to return."
        }
      }
    }
  },
  {
    "name": "compare_eprel_product_metrics",
    "title": "Compare declared metrics",
    "description": "Compare two or more COMPATIBLE records on their COMMON supplier-declared metrics — a value table only. Cross-product-group comparison fails safely as 'incompatible_comparison'; no 'best product', no ranking, no buying advice. Answers come from the queried source at the stated retrieval time: the official EPREL Public API in live mode, or a clearly-labelled synthetic fixture in dev/test — provenance.sourceAuthority names which. Supplier-declared data only; Jithox verifies nothing.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "publicRecordIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 5,
          "description": "Public record identifiers to compare; a comparison needs at least 2 (fewer returns 'insufficient_identifiers'), up to 5."
        },
        "metricKeys": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60
          },
          "maxItems": 10,
          "description": "Optional metric keys to restrict the comparison to."
        }
      }
    }
  },
  {
    "name": "prepare_energy_label_preflight_receipt",
    "title": "Prepare a preflight receipt",
    "description": "Bundle the preflight lookups into one idempotent Ed25519-signed receipt committing to the FINGERPRINTED inputs, record references, sources, freshness and decision states — provable evidence of WHAT was looked up and WHEN. Attests the lookups, never a registration, conformity or market-access outcome. Preflight evidence only — never a conformity, CE, GPSR, safety or market-access determination.",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "bundle",
        "createdAt"
      ],
      "properties": {
        "bundle": {
          "type": "object",
          "description": "The preflight results to attest (fingerprinted inputs, sources, decision states — no raw query values)."
        },
        "createdAt": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40,
          "description": "ISO timestamp the bundle was assembled."
        }
      }
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** True when `name` is one of the five captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Relay client                                                        */
/* ------------------------------------------------------------------ */

function failureResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `labelproof error: ${detail}` }],
    isError: true,
  };
}

function describeRpcError(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Extract a JSON-RPC message from a response body that may
 * use SSE framing. Prefers the message whose id equals
 * `expectedId`; otherwise returns the last readable message,
 * or null if the body holds no JSON object at all.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const found: Record<string, unknown>[] = [];
  const collect = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        found.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Skip fragments that are not JSON objects.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const entry = line.trim();
      if (!entry.startsWith("data:")) continue;
      const payload = entry.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") collect(payload);
    }
  } else {
    collect(trimmed);
  }
  if (found.length === 0) return null;
  if (expectedId !== undefined) {
    const hit = found.find((m) => m.id === expectedId);
    if (hit !== undefined) return hit;
  }
  return found[found.length - 1];
}

async function globalFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * Relay client holding one upstream session. Construction
 * performs no I/O; the session starts on the first call.
 */
export class LabelproofClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private established = false;
  private opening: Promise<void> | null = null;
  private counter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchImpl(): FetchFn {
    return this.deps.fetchFn ?? globalFetch;
  }

  private resolveUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const fromEnv = (this.deps.env ?? process.env).EU_ENERGY_MCP_URL;
    if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private resolveKey(): string | null {
    const raw = (this.deps.env ?? process.env).EU_ENERGY_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private resolveTimeout(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private allocateId(): number {
    this.counter += 1;
    return this.counter;
  }

  private async send(
    body: unknown,
    includeSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.resolveKey();
    if (key !== null) headers["Authorization"] = `Bearer ${key}`;
    if (includeSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.resolveTimeout());
    try {
      return await this.fetchImpl()(this.resolveUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async openSession(): Promise<void> {
    if (this.established) return;
    if (this.opening === null) {
      this.opening = (async () => {
        const initId = this.allocateId();
        const initResponse = await this.send(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "labelproof", version: VERSION },
            },
          },
          false,
        );
        const issued = initResponse.headers.get("mcp-session-id");
        if (issued) this.sessionId = issued;
        const initText = await initResponse.text();
        const initMessage = parseRpcBody(initText, initId);
        if (initMessage !== null && initMessage.error) {
          throw new Error(describeRpcError(initMessage.error));
        }
        if (initResponse.status < 200 || initResponse.status >= 300) {
          throw new Error(`HTTP ${initResponse.status}`);
        }
        if (initMessage === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const noteResponse = await this.send(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await noteResponse.text();
        } catch {
          // The notification reply body carries nothing we need.
        }
        this.established = true;
      })();
    }
    try {
      await this.opening;
    } catch (err) {
      this.opening = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Relay one call; upstream trouble becomes an isError result, never a throw. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.openSession();
    } catch (err) {
      return failureResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.allocateId();
    let callResponse: FetchResponseLike;
    try {
      callResponse = await this.send(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return failureResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const message = parseRpcBody(await callResponse.text(), callId);
    if (message !== null && message.error) {
      return failureResult(describeRpcError(message.error));
    }
    if (callResponse.status < 200 || callResponse.status >= 300) {
      return failureResult(`HTTP ${callResponse.status}`);
    }
    if (message === null) return failureResult("malformed response");
    const result = message.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return failureResult("malformed response");
    }
    return result;
  }
}

/** Convenience constructor used by the MCP layer and tests. */
export function createClient(deps: ForwardDeps = {}): LabelproofClient {
  return new LabelproofClient(deps);
}

/** Single-call helper for the CLI: a fresh client per invocation. */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new LabelproofClient(deps).callTool(name, args);
}
