# aiact-mcp — MCP server for AI Act Explorer NL

Exposes the Dutch AI Act corpus (base text + digital-omnibus amendment layer)
over the Model Context Protocol: stdio for Claude Desktop/Code, streamable
HTTP for claude.ai custom connectors.

Search relevance is identical to the site: both use
`src/lib/search-core.ts` (MiniSearch config, Dutch normalization, snippets).

## Tools

| Tool | Input | Returns |
|---|---|---|
| `search_ai_act` | `query`, `limit?`, `type?` | hits with deep links + snippets |
| `get_article` | `number` (`"6"`, `"75 bis"`) | full article text, omnibus flag |
| `get_recital` | `number` (1–180) | recital text |
| `get_annex` | `roman` (`"III"`) | annex text (incl. omnibus annexes) |
| `get_structure` | — | compact TOC with omnibus insertions |
| `get_amendments` | `article?` | omnibus overview or per-article diff |

All output is markdown with deep links to `BASE_URL` so Claude can cite.

## Build

```sh
cd mcp
npm install
npm run build       # tsc → dist/ (compiled CommonJS)
```

Layout note: `rootDir` is the repo root (the build compiles
`src/lib/{types,search-core}.ts` alongside), so entrypoints land at
`dist/mcp/src/{stdio,http}.js` and the shared libs at `dist/src/lib/`.
The whole build is CommonJS — the repo root `package.json` has no
`"type": "module"`, so the cross-compiled `src/lib` files must be CJS and the
`mcp` sources follow suit.

## Claude Desktop / Claude Code (stdio)

```json
{
  "mcpServers": {
    "ai-act-nl": {
      "command": "node",
      "args": ["/home/supergoose/ai-act-explorer-nl/mcp/dist/mcp/src/stdio.js"]
    }
  }
}
```

## Remote (streamable HTTP)

- Endpoint: `https://aia.mrfrank.dev/mcp` (claude.ai → Settings → Connectors →
  Add custom connector). Stateless: no session ids, JSON responses, safe to
  restart the service at any time.
- `GET /healthz` for liveness; `GET`/`DELETE /mcp` return 405 by design.

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3106` | listen port (binds 127.0.0.1) |
| `BASE_URL` | `https://aia.mrfrank.dev` | prefix for deep links in output |
| `MCP_TOKEN` | unset | if set, require `Authorization: Bearer` (Claude API MCP connector / Agents). Leave unset for claude.ai custom connectors — they have no static-token field. |
| `AIACT_DATA_DIR` | `<repo>/data/generated` | corpus location override |

## Deployment (this VPS)

systemd user unit `~/.config/systemd/user/aiact-mcp.service`
(linger is enabled):

```sh
systemctl --user daemon-reload
systemctl --user enable --now aiact-mcp
systemctl --user status aiact-mcp
curl -s 127.0.0.1:3106/healthz
```

nginx: `/etc/nginx/sites-available/aia.mrfrank.dev` proxies `/mcp` →
`127.0.0.1:3106` (buffering off, 300s read timeout) and serves the static
site from `/var/www/aia.mrfrank.dev` (publish with `scripts/deploy-site.sh`).
TLS = Cloudflare Origin CA cert (`/etc/nginx/ssl/mrfrank.dev.{pem,key}`),
zone SSL mode Full (strict).

Fallback without systemd: `tmux new-session -d -s aiact-mcp 'node /home/supergoose/ai-act-explorer-nl/mcp/dist/mcp/src/http.js'`.

**nvm caveat**: `ExecStart` hardcodes the node path
(`~/.nvm/versions/node/v24.14.0/bin/node`). After a node upgrade, update the
unit and `systemctl --user daemon-reload && systemctl --user restart aiact-mcp`.

## Reloading data

The corpus is read **once at startup**. After `npm run parse` or the
`update-source` skill:

```sh
systemctl --user restart aiact-mcp     # remote server
# stdio servers pick up new data on next launch (Claude Desktop restart)
```
