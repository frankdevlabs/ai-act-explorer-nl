/**
 * The two transports every explorer MCP server ships: stdio (Claude Desktop /
 * Claude Code) and a stateless streamable HTTP endpoint behind nginx. Identical
 * across the repos apart from the listen port and the log prefix, so both are
 * parameters here.
 *
 * Each repo keeps its own thin entrypoint files (`mcp/src/stdio.ts`,
 * `mcp/src/http.ts`) because the compiled paths `mcp/dist/mcp/src/{stdio,http}.js`
 * are hardcoded in verify-mcp.ts and in the systemd unit.
 */
import express, { type Request, type Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface TransportOptions {
  createServer: () => McpServer;
  /** Prefixes every log line, e.g. "dora-mcp". */
  logPrefix: string;
}

/** stdout is the protocol channel — never log to it. */
export function serveStdio({ createServer, logPrefix }: TransportOptions): void {
  async function main() {
    const server = createServer();
    await server.connect(new StdioServerTransport());
    console.error(`${logPrefix}: stdio server ready`);
  }

  main().catch((e) => {
    console.error(`${logPrefix}: fatal:`, e);
    process.exit(1);
  });
}

export interface HttpOptions extends TransportOptions {
  /** Listen port when PORT is unset; binds 127.0.0.1 either way. */
  defaultPort: number;
}

export function serveHttp({ createServer, logPrefix, defaultPort }: HttpOptions): void {
  const PORT = Number(process.env.PORT ?? defaultPort);
  const MCP_TOKEN = process.env.MCP_TOKEN; // unset = open (claude.ai custom connectors)

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    if (MCP_TOKEN && req.headers.authorization !== `Bearer ${MCP_TOKEN}`) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    try {
      // Stateless pattern: fresh server + transport per request, no session ids.
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error(`${logPrefix}: request failed:`, e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const reject405 = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", reject405);
  app.delete("/mcp", reject405);

  app.listen(PORT, "127.0.0.1", () => {
    console.error(`${logPrefix}: streamable HTTP server on 127.0.0.1:${PORT}`);
  });
}
