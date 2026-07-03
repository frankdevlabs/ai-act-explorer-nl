# Epic 3 — MCP server (stdio + remote on VPS)

**Status**: ready to implement after (or in parallel with) epic 1. Run plan mode on this doc for final step breakdown.
**Goal**: expose the corpus to Claude Desktop/Code (stdio) and claude.ai custom connectors (streamable HTTP on this VPS).

## Design decisions

- **Location `mcp/`** with its own `package.json` + `tsconfig.json` (deps: `@modelcontextprotocol/sdk`, `zod`, `express`, `minisearch`; build with tsc → `dist/` so Claude Desktop doesn't need tsx). Site dependency tree untouched — `next build` never sees MCP deps. Reads `../data/generated/*.json` from disk at startup; imports `../src/lib/types.ts` + search core via relative imports.
- **Search reuse**: extract pure parts of `src/lib/search.ts` into `src/lib/search-core.ts` — `DUTCH_STOPWORDS`, `normalizeTerm`, `createSearchIndex(docs: SearchDoc[])` (exact existing MiniSearch options), `searchDocs`, `makeSnippet`. `search.ts` shrinks to the browser fetch + lazy singleton. Identical relevance on site and MCP; one place to tune.
- **Server shape**: one `createServer()` factory (`McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`), two thin entrypoints:
  - `mcp/src/stdio.ts` — `StdioServerTransport`. Claude Desktop config: `{"command": "node", "args": ["<repo>/mcp/dist/stdio.js"]}`.
  - `mcp/src/http.ts` — express + `StreamableHTTPServerTransport` **stateless** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`): read-only static data, no session store, proxy-friendly, survives restarts. `POST /mcp` (405 on GET/DELETE per stateless pattern), `GET /healthz`. Bind `127.0.0.1:3106` (dev site uses 3105).

## Tools

All zod-validated; outputs = markdown text blocks with canonical site deep-link URLs (`BASE_URL` env) so Claude can cite:
- `search_ai_act { query, limit?, type? }` → hits with heading, url, snippet (via `makeSnippet` + result terms).
- `get_article { number: string }` — string so `"75bis"` works after epic 2; returns title, chapter/afdeling, full body via `mcp/src/render.ts` (ContentNode → markdown walker), footnotes, anchor list.
- `get_recital { number }`, `get_annex { roman }`, `get_structure {}` (compact TOC).
- Post-epic-2: `get_amendments { article? }` reading amendments.json/amendment-diffs.json.

Data loaded once at startup — corpus updates require service restart (document in mcp/README.md; add restart note to `update-source` skill).

## Auth

**Open data plane** (approved): corpus is published EU law, already publicly served; threat is only abuse/load. claude.ai custom connectors support OAuth 2.0 (with DCR) or unauthenticated — no static bearer field — so a required token would force a full OAuth AS for zero confidentiality gain. Meanwhile Claude API MCP connector and Agents vaults *do* take bearer tokens → if `MCP_TOKEN` env is set, `http.ts` enforces `Authorization: Bearer`; unset (claude.ai path) = open. Abuse mitigation at the proxy: rate limiting + optional unguessable path prefix (`/mcp-<random>` as connector URL). **Re-verify claude.ai connector auth options at implementation time** — this changes fast; if OAuth becomes cheap (SDK `mcpAuthRouter`), layer it later without changing the tool surface.

## Deployment (this VPS, no root)

- Prefer systemd user unit `~/.config/systemd/user/aiact-mcp.service` + `loginctl enable-linger` (check availability first); fallback: repo tmux pattern `tmux new-session -d -s aiact-mcp 'node mcp/dist/http.js'`.
- Reverse proxy: `https://<domain>/mcp` → `127.0.0.1:3106`; **disable response buffering**, raise read timeouts (streamable HTTP can hold SSE responses), pass `Accept`/`Mcp-Session-Id` headers untouched. Domain/proxy choice: unresolved — see open questions.

## Files

New: `mcp/package.json`, `mcp/tsconfig.json`, `mcp/src/server.ts`, `mcp/src/data.ts` (fs loaders), `mcp/src/render.ts`, `mcp/src/stdio.ts`, `mcp/src/http.ts`, `mcp/README.md` (Desktop config, connector URL, deploy/systemd/tmux, reload procedure), `src/lib/search-core.ts`.
Modified: `src/lib/search.ts` (thin wrapper re-exporting from search-core).

## Order & verification

1. `search-core.ts` extraction + site regression (`verify-app`: palette, /zoeken).
2. mcp scaffold + data loading + render.ts.
3. Tools + stdio — verify with `npx @modelcontextprotocol/inspector node mcp/dist/stdio.js` (tools/list, `get_article 6` output matches site text).
4. http — curl JSON-RPC `initialize` → `tools/call` against localhost; check stateless behavior across restarts.
5. Deploy (unit/tmux + proxy) + e2e from Claude Desktop (stdio) and a claude.ai custom connector.

## Risks

- claude.ai connector auth requirements drift — verify at build time.
- Node 24 + `"type":"module"` ESM interop with the SDK — use `.js`-suffixed imports.
- Data staleness after `update-source` — restart note in that skill.

## Open questions

- Which domain/reverse proxy on the VPS fronts `https://<domain>/mcp`? (Nothing found in repo; decide at deploy step.)
