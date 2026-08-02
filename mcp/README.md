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
| `get_context_pack` | `articles` (1–20, and under the size ceiling) | per article: full text + omnibus status + related recitals, then every referenced recital once |
| `get_obligations` | `role?`, `riskClass?` | obligation catalog per role/risk class, grouped by module, with deep links |
| `get_questionnaire` | `module?` | self-assessment module list, or one module in full (questions, answer types, `showIf`, effects) |
| `get_recital_map` | `article?`, `recital?` | curated recital↔article map: the whole map, or one entry in either direction |
| `get_assessment` † | `system?` | the stored assessment blob (see "Assessment state") |
| `put_assessment` † | `blob` | validates and persists a full v1 assessment blob — **authenticated, not read-only** |

† Registered only when `AIACT_ASSESSMENT_STATE` is set. The public deployment
does not set it, so it advertises the ten corpus tools and nothing else.

All output is markdown with deep links to `BASE_URL` so Claude can cite.
Every corpus tool is annotated `readOnlyHint: true` / `openWorldHint: false` —
they read a static corpus, and claude.ai's per-tool controls key off those
annotations. The one exception is `put_assessment`, which carries
`readOnlyHint: false` / `destructiveHint: true` / `idempotentHint: true`
because it really does overwrite a stored record.

`get_context_pack` collapses the three calls a provision used to cost
(article, recitals, amendment status) into one. It is not a bulk dump — see
the guardrails below.

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

## Result-size guardrails

Two client ceilings bound any tool result:

- **claude.ai / Claude Desktop** truncate a tool result at roughly **150,000
  characters**;
- **Claude Code** caps at `MAX_MCP_OUTPUT_TOKENS`, default **25,000 tokens**,
  and warns from ~10,000.

Crossing either yields a *truncated* result, which is worse than an error: a
contract review built on half a pack still looks complete. `get_context_pack`
— the only tool that composes an unbounded number of provisions — therefore
**refuses** rather than trims, and the refusal names the request size, the
ceiling and the per-article breakdown so the caller can re-split deliberately.

Constants in `mcp/src/server.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_PACK_ARTICLES` | `20` | more articles than this → refused before any text is assembled |
| `MAX_PACK_CHARS` | `85000` (env `MCP_MAX_RESULT_CHARS`) | assembled pack over this → refused; 25k tokens × 3.4, also well under 150k |
| `WARN_PACK_CHARS` | `34000` | over this → the pack is returned, prefixed with a `> **Omvang:**` banner |
| `CHARS_PER_TOKEN` | `3.4` | estimate only; the guard enforces characters, which are exact |

The banner goes **first** in the result on purpose: if a client truncates
anyway, the size notice is in the part that survives.

Measured pack sizes (articles 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 25, 26,
27, 43, 47, 49, 50, 53, 55, 72, taken in that order, guard disabled). Character
counts are exact; token counts are the 3.4 estimate, not a tokenizer run.

| Articles | Characters | ~Tokens | Verdict at the default ceiling |
|---:|---:|---:|---|
| 1 | 41,358 | ~12,200 | ok, with banner |
| 2 | 50,664 | ~14,900 | ok, with banner |
| 3 | 61,755 | ~18,200 | ok, with banner |
| 5 | 68,278 | ~20,100 | ok, with banner |
| 10 | 106,240 | ~31,200 | **refused** |
| 20 | 219,648 | ~64,600 | **refused** |

So in practice **3–6 articles** fit a Claude Code budget and **~13** fit
claude.ai's 150k — well short of the nominal 20. The cost is dominated by
recital text, not article text (a 7-article pack is ~34k characters of
articles and ~57k of recitals), and recitals are deduplicated across the pack,
so the marginal cost of an extra article falls as the pack grows. `MAX_PACK_ARTICLES`
is the coarse cap; `MAX_PACK_CHARS` is the one that actually binds.

`get_obligations` is the other large result: the unfiltered catalog is ~56 kB
(~16k tokens) — under Claude Code's budget, but the reason its description
tells callers to filter by role and risk class. It has no refusal branch,
because it is bounded by the questionnaire, not by caller input.

## Assessment state (authed)

The one writable surface here (roadmap 4.1). It replaces the manual copy hop
through the legal-workbench `inbox/` drop-zone: a skill can pull the current
assessment, reason over it against `get_questionnaire` / `get_obligations`, and
write a corrected blob back.

| Tool | Auth | Does |
|---|---|---|
| `get_assessment` | none (read-only) | returns the stored blob as markdown plus the exact JSON in a fenced block, so it round-trips |
| `put_assessment` | `MCP_TOKEN` required | validates a **full** v1 blob and merges it into the state file by system id |

The payload is exactly the `aiact-assessments` shape the app's *Export JSON*
button produces and `legal-workbench/inbox/FORMAT.md` specifies:
`{"v":1,"systems":[{id,name,answers,createdAt,updatedAt}]}`. A bridge envelope
(`{"bridge":1,…,"blob":{…}}`, FORMAT.md §3) is unwrapped; anything with both
`bridge` and a top-level `v` is refused as malformed.

**What `put_assessment` is not.** Not a patch surface (send the whole blob, not
a delta). Not a deletion surface (see conflict semantics). Not a verdict: a
blob holds answers only — risk class, roles and obligation status are never
stored, they are recomputed by `/assessment` and, for the catalog half, by
`get_obligations`.

**Auth.** `MCP_TOKEN` is the credential, the same variable `http.ts` already
checks. Over HTTP the transport rejects a bad bearer before the tool runs; over
stdio there is no header, so possession of the env var *is* the credential.
Either way, **`MCP_TOKEN` unset ⇒ every write is refused** with an error naming
the missing variable — never silently accepted. On claude.ai the value goes in
the connector's *Request headers* field (beta rollout, allowlisted header
names, value sent verbatim), so it must be entered as `Bearer <token>`
including the space — see `explorer-ai-research/notes/w5-platform-checks-0.4.md`.
Note that setting `MCP_TOKEN` on an HTTP deployment gates *all* tools, reads
included; that is the pre-existing `http.ts` behaviour, not something this
feature changes.

**Enablement.** `AIACT_ASSESSMENT_STATE` unset ⇒ neither tool is registered at
all. That is deliberate: the deployed read server keeps a ten-tool inventory
with no write path to disable, and `npm run verify:mcp` asserts that inventory
on every run.

**State file.** One JSON file at `AIACT_ASSESSMENT_STATE`, written atomically
(`.tmp` + rename). Nothing is ever written under `data/` or `public/` — the
verify script fingerprints both directories around the write tests. Suggested
local value `<repo>/.state/assessment.json`, which `.gitignore` excludes. A
missing file reads as empty state; a *malformed* file is an error rather than a
silent reset.

**Validation.** Every answer key must exist in
`data/questionnaire/assessment-v1.json`, and for `choice` / `janee` /
`janeenvt` questions the value must be one of that question's options (`""`
means "answer cleared"). An unknown id or an invalid value rejects the **whole**
write, naming every offence, and nothing is stored. This is stricter than the
drop-zone norm, where `assess.mjs` reports an unknown id as `unknownIds`
staleness: a blob exported before a questionnaire change is refused here, and
the caller must repair the export. Records that fail the id/name/answers shape
are likewise reported, not silently dropped — the app's own import drops them,
which FORMAT.md §6 calls the sharpest failure mode of the bridge.

**Conflict semantics.** Merge is by system id, last write wins per record. A
system id present in the submitted blob replaces the stored record wholesale
(so a stale blob can lose an answer — hence `destructiveHint`). A system id
*absent* from the blob is left untouched: omission never deletes. Deletion is
out of band — edit the state file. There is no history and no rollback beyond
the filesystem: the file is replaced, not versioned.

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
  '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_context_pack","arguments":{"articles":["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21"]}}}' \
  | node dist/mcp/src/stdio.js
```

Expect 10 tools, each with `annotations.readOnlyHint: true`; a pack containing
both articles, opening with the `> **Omvang:**` banner (it is ~58k characters),
with an omnibus-status block on article 6 and each recital rendered exactly
once; modules 9 + 10 in the obligation output with none of the provider
modules (11–16); `m19` rendered as *module 12*; a recital list for article 6;
and the 21-article call refused with `isError: true` and a message naming both
21 and 20.

The full gate is `npm run verify:mcp` from the repo root — it pins the tool
inventory, every input schema, and one call per branch, plus the size refusal
against a server started with a deliberately tiny `MCP_MAX_RESULT_CHARS`, plus
the assessment pair against two more servers (state dir only → the write is
refused and no file appears; state dir + `MCP_TOKEN` → write, round-trip,
invalid-id and merge-by-id cases), with `data/` and `public/` fingerprinted
around the whole section.

The write path, end to end:

```sh
export AIACT_ASSESSMENT_STATE=$PWD/.state/assessment.json
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"put_assessment","arguments":{"blob":{"v":1,"systems":[]}}}}' \
  | node dist/mcp/src/stdio.js          # isError, message names MCP_TOKEN
MCP_TOKEN=dev-token <same pipeline>     # succeeds; get_assessment returns the blob
unset AIACT_ASSESSMENT_STATE            # tools/list is back to the ten corpus tools
```

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
| `MCP_TOKEN` | unset | the credential. Over HTTP: require `Authorization: Bearer` on every request. Everywhere (incl. stdio): the gate on `put_assessment` — unset means writes are refused. On claude.ai it goes in the connector's *Request headers* field as `Bearer <token>` (beta). |
| `AIACT_ASSESSMENT_STATE` | unset (feature off) | path to the assessment state JSON. Unset ⇒ `get_assessment`/`put_assessment` are not registered. See "Assessment state (authed)". |
| `MCP_MAX_RESULT_CHARS` | `85000` | `get_context_pack` size ceiling (see "Result-size guardrails"). The default is the strict Claude Code budget; a deployment serving only claude.ai can raise it toward `140000`. |
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
