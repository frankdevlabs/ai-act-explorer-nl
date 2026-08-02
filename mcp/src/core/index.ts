/**
 * `explorer-core` in waiting: the corpus-agnostic half of an explorer MCP
 * server. Nothing in this directory may import a repo's data, types or routes —
 * mcp/scripts/check-core-isolation.mjs fails the build if it does.
 *
 * Extraction rationale, the shared/corpus-specific boundary and what the
 * sibling repos must mirror: docs/mcp-core-extraction.md.
 */
export {
  READ_ONLY,
  err,
  registerTool,
  text,
  type ToolResult,
  type ToolSpec,
} from "./tools.js";
export {
  createMarkdown,
  type Markdown,
  type MarkdownOptions,
  type MdFootnote,
  type MdLinkRef,
  type MdListItem,
  type MdNode,
  type MdRefSpan,
} from "./markdown.js";
export { fmt, helpLines, plural, type HelpContentLike } from "./text.js";
export { baseUrlFromEnv, loadJson, normalizeArticleInput } from "./loader.js";
export {
  DEFAULT_PACK_LIMITS,
  checkPackSize,
  estTokens,
  packLimitsFromEnv,
  tooManyArticlesMessage,
  type PackFacts,
  type PackLimits,
  type PackVerdict,
} from "./size.js";
export { serveHttp, serveStdio, type HttpOptions, type TransportOptions } from "./transport.js";
