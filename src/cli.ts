#!/usr/bin/env node
/**
 * labelproof command line.
 *
 *   labelproof <tool> '<json-args>'
 *   labelproof mcp
 *   labelproof --version
 *
 * Each of the five captured tools is available as a
 * subcommand whose single argument is a JSON object
 * string with that tool's arguments. The call is relayed
 * exactly as the MCP path relays it, and the result
 * content is printed. Exit codes: 0 when the relayed
 * result is not an error, 1 when it is, 2 for usage
 * problems.
 */
import { callTool, TOOL_NAMES, VERSION } from "./forward.js";
import type { ToolResult } from "./types.js";

function usage(): never {
  console.error(`Usage:
  labelproof <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  labelproof mcp
  labelproof --version`);
  process.exit(2);
}

function leadingText(result: ToolResult): string {
  const content = result.content;
  if (Array.isArray(content)) {
    for (const entry of content) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        (entry as { type?: unknown }).type === "text" &&
        typeof (entry as { text?: unknown }).text === "string"
      ) {
        return (entry as { text: string }).text;
      }
    }
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
    return;
  }
  if (!TOOL_NAMES.includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        usage();
      }
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  const result = await callTool(cmd, args);
  if (result.isError) {
    console.error(`error: ${leadingText(result)}`);
    process.exit(1);
  }
  console.log(
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content, null, 2),
  );
}

void main();
