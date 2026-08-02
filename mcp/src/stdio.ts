import { createServer } from "./server.js";
import { serveStdio } from "./core/transport.js";

// Entrypoint path is load-bearing: scripts/verify-mcp.ts and the aiact-mcp
// systemd unit both point at mcp/dist/mcp/src/stdio.js.
serveStdio({ createServer, logPrefix: "aiact-mcp" });
