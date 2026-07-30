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
| `get_context_pack` | `articles` (1–20) | per article: full text + omnibus status + related recitals, then every referenced recital once |
| `get_obligations` | `role?`, `riskClass?` | obligation catalog per role/risk class, grouped by module, with deep links |
| `get_questionnaire` | `module?` | self-assessment module list, or one module in full (questions, answer types, `showIf`, effects) |
| `get_recital_map` | `article?`, `recital?` | curated recital↔article map: the whole map, or one entry in either direction |

All output is markdown with deep links to `BASE_URL` so Claude can cite.
Every tool is annotated `readOnlyHint: true` / `openWorldHint: false` — the
whole server is a read of a static corpus, and claude.ai's per-tool controls
key off those annotations.

`get_context_pack` collapses the three calls a provision used to cost
(article, recitals, amendment status) into one. It is not a bulk dump: a pack
runs ~13k characters per article once recitals are included, so a 20-article
pack (~270k characters) will exceed most result budgets. Ask for the
provisions you need.

`get_obligations` serves the *catalog* — which obligations exist for a role or
risk class — and never a compliance status, which is a function of a concrete
system's answers (`/assessment` computes that). Obligations behind a gate the
filter cannot decide are returned with a `Voorwaarde:` line rather than
dropped.

`get_questionnaire` exposes the same curated questionnaire per module, so a
claude.ai-side skill can interpret a stored answer blob without a repo
checkout. `module` resolves by id (`"m19"`) first and only then by module
number (`"12"`): the ids are historical and not in module order (m19 is module
12, m12 is module 18). There is no all-modules mode — the questionnaire is
~108 kB of JSON. `showIf` and `effects` are emitted as raw JSON (authoritative;
they carry the all/any/not structure) plus an indicative Dutch gloss of the
atoms.

`get_recital_map` serves the curated recital↔article map as-is — editorial
metadata that never alters legal text, and still being curated, so a missing
entry means "not yet mapped", never "no relevant recital exists". Every result
repeats that caveat.

## Smoke test (stdio, no framework)

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_context_pack","arguments":{"articles":["6","50"]}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_obligations","arguments":{"role":"gebruiksverantwoordelijke","riskClass":"hoogrisico"}}}' \
  '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_questionnaire","arguments":{"module":"m19"}}}' \
  '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_recital_map","arguments":{"article":"6"}}}' \
  | node dist/mcp/src/stdio.js
```

Expect 10 tools, each with `annotations.readOnlyHint: true`; a pack containing
both articles with an omnibus-status block on article 6 and each recital
rendered exactly once; modules 9 + 10 in the obligation output with none of the
provider modules (11–16); `m19` rendered as *module 12*; and a recital list for
article 6.

The full gate is `npm run verify:mcp` from the repo root — it pins the tool
inventory, every input schema, and one call per branch.

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
| `AIACT_QUESTIONNAIRE` | `<repo>/data/questionnaire/assessment-v1.json` | assessment questionnaire (curated source, outside `AIACT_DATA_DIR`) |

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

The corpus is read **once at startup**. After `npm run parse`, the
`update-source` skill, **or an edit to `data/questionnaire/assessment-v1.json`**
(which `get_obligations` and `get_questionnaire` read directly, with no
generated derivative):

```sh
systemctl --user restart aiact-mcp     # remote server
# stdio servers pick up new data on next launch (Claude Desktop restart)
```
