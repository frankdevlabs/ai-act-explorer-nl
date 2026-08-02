/**
 * Response shaping and tool-registration boilerplate — shared across the
 * explorer MCP servers (roadmap 4.3, see docs/mcp-core-extraction.md).
 *
 * Nothing here knows anything about a corpus: no instrument ids, no data
 * loaders, no site routes. Keep it that way — this directory is a package in
 * waiting, and mcp/scripts/check-core-isolation.mjs enforces the import rule.
 */
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

/** The single content-block markdown result every tool in this family returns. */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export const text = (md: string) => ({ content: [{ type: "text" as const, text: md }] });
export const err = (md: string) => ({ content: [{ type: "text" as const, text: md }], isError: true });

/**
 * Every tool on these servers reads a static corpus and mutates nothing, and no
 * tool reaches outside it. claude.ai's per-tool controls key off these hints,
 * so they belong on all tools, not only on new ones.
 */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export type ToolSpec<Args extends ZodRawShape> = {
  title: string;
  description: string;
  inputSchema: Args;
  /**
   * Protocol-level metadata forwarded verbatim to `registerTool`. The one use
   * today is the MCP Apps association `{ ui: { resourceUri } }`, which points a
   * host at the `ui://` resource that should render this tool's result — still
   * corpus-agnostic, hence here rather than in the call site's own wrapper.
   */
  _meta?: Record<string, unknown>;
  /**
   * Overrides READ_ONLY. Only a tool that writes should set this: an explorer
   * server that gained an authed write tool (aiact's `put_assessment`, roadmap
   * 4.1) would otherwise have to bypass `registerTool` altogether and lose the
   * single registration path. Corpus-agnostic — what a tool mutates is not a
   * property of the corpus it reads.
   */
  annotations?: ToolAnnotations;
};

/**
 * `server.registerTool` with the read-only annotations applied for free —
 * the one thing that was spelled out identically on every tool in both repos.
 * `title`, `description` and `inputSchema` are forwarded verbatim, so the
 * agent-facing contract is exactly what the call site writes.
 */
export function registerTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  spec: ToolSpec<Args>,
  handler: ToolCallback<Args>,
): void {
  server.registerTool(name, { ...spec, annotations: spec.annotations ?? READ_ONLY }, handler);
}
