import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// stdout is the protocol channel — never log to it.
async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("aiact-mcp: stdio server ready");
}

main().catch((e) => {
  console.error("aiact-mcp: fatal:", e);
  process.exit(1);
});
