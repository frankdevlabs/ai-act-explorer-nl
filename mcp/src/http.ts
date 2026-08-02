import { createServer } from "./server.js";
import { serveHttp } from "./core/transport.js";

// Entrypoint path is load-bearing: the aiact-mcp systemd unit points at
// mcp/dist/mcp/src/http.js.
serveHttp({ createServer, logPrefix: "aiact-mcp", defaultPort: 3106 });
