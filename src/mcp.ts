/**
 * labelproof MCP server (stdio).
 *
 * Registration goes through the SDK's low-level Server
 * type, not the high-level McpServer helper: the helper
 * rebuilds input schemas from zod definitions and would
 * alter the captured literals. Here the ListTools handler
 * returns the stored definitions exactly as captured,
 * and the CallTool handler validates the request shape
 * locally before relaying it upstream through the client
 * in forward.ts.
 *
 * Relayed results are returned as received, isError and
 * any extra fields included. Upstream failures arrive
 * already rendered by the relay as isError results with
 * `labelproof error:` text. Calls naming a tool outside
 * the captured surface fail with McpError MethodNotFound,
 * and calls whose arguments are not a JSON object fail
 * with McpError InvalidParams; neither reaches the
 * network.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createClient,
  isKnownTool,
  TOOL_DEFS,
  VERSION,
  type LabelproofClient,
} from "./forward.js";
import type { ForwardDeps, ToolResult } from "./types.js";

/**
 * Validate one tools/call and pass it to the relay.
 * Exported for direct testing without a transport.
 */
export async function handleCallTool(
  client: LabelproofClient,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  if (!isKnownTool(name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  if (
    args !== undefined &&
    (typeof args !== "object" || args === null || Array.isArray(args))
  ) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Arguments for tool ${name} must be a JSON object`,
    );
  }
  return client.callTool(name, (args ?? {}) as Record<string, unknown>);
}

/** Assemble the server; the caller connects a transport. */
export function createServer(deps: ForwardDeps = {}): Server {
  const client = createClient(deps);
  const server = new Server(
    { name: "labelproof", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await handleCallTool(client, name, args);
    return result as never;
  });

  return server;
}

/** Start the server on stdio (used by the `mcp` CLI subcommand). */
export async function startMcpServer(deps: ForwardDeps = {}): Promise<void> {
  await createServer(deps).connect(new StdioServerTransport());
}
