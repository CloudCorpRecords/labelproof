/**
 * Shared types for labelproof.
 *
 * The package performs no EPREL lookup of its own. It keeps
 * the captured tool definitions as plain data, serves them
 * unchanged for tools/list, and relays each call to the
 * hosted preflight endpoint through a fetch function that
 * callers can substitute, keeping tests off the network.
 */

/** A single captured tool entry, exactly as it is served for tools/list. */
export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

/** Decoded JSON arguments for one tool invocation. */
export type ToolArgs = Record<string, unknown>;

/** A tools/call outcome; upstream payloads keep every field they arrived with. */
export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

/** The slice of a fetch Response the relay actually reads. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Fetch signature used by the relay; tests supply a stub with this shape. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Optional dependencies a caller can inject into the relay. */
export interface ForwardDeps {
  /** Fetch implementation; falls back to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment map (EU_ENERGY_MCP_URL, EU_ENERGY_API_KEY); defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Direct endpoint override; beats the env override and the pinned default. */
  url?: string;
  /** Timeout per upstream request, in milliseconds; defaults to 30000. */
  timeoutMs?: number;
}
