---
name: update-source
description: Fetch a newer EUR-Lex consolidated version of Regulation 2024/1689 (NL) — and, when it incorporates a new amending act, that act's OJ text — re-pin data/source/corpus.json, re-parse, audit the corpus and change-layer diffs, update verify assertions, rebuild. Use when a new consolidated version, amending act or corrigendum is published, or when the source text must be refreshed.
---

# Update the source text

Sources are listed in `data/source/corpus.json`:

| key | current file | role |
|---|---|---|
| `base` | `consolidated/02024R1689-20260727.html` | the law in force (served everywhere) |
| `previous` | `consolidated/02024R1689-20240712.html` | consolidation the change layer diffs against |
| `recitals` | `aiact_nl.html` | original OJ text (recitals; never changes) |
| `amending` | `amending/32026R1744.html` | OJ text of the act between `previous` and `base` (Verordening (EU) 2026/1744) |

## 1. Check for a newer consolidated version

The consolidated CELEX pattern is `02024R1689-YYYYMMDD`. EUR-Lex is behind an
AWS WAF (plain `curl`/WebFetch get HTTP 202 + a JS challenge), so fetch with
headless Chromium. Playwright lives in `~/mc/mcp-rcon/node_modules` on this
VPS (browsers in `~/.cache/ms-playwright`, no LD_LIBRARY_PATH needed). Save as
`fetch-eurlex.mjs` in your session scratchpad:

```js
// node fetch-eurlex.mjs <url> <out> [--expect <substring>]...
// Solves the WAF challenge in Chromium, then re-requests the URL with the
// session cookies to save the server's raw bytes (not the re-serialized DOM).
import { createRequire } from "module";
import fs from "fs";
const require = createRequire("/home/supergoose/mc/mcp-rcon/package.json");
const { chromium } = require("playwright");
const [url, out, ...rest] = process.argv.slice(2);
const expects = rest.flatMap((a, i) => (rest[i - 1] === "--expect" ? [a] : []));
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ locale: "nl-NL" });
const p = await ctx.newPage();
await p.goto(url, { waitUntil: "networkidle", timeout: 120000 });
let body = null;
for (let i = 0; i < 3 && !body; i++) {
  const r = await ctx.request.get(url, { timeout: 120000 });
  const buf = await r.body();
  const s = buf.toString("utf-8");
  if (r.status() === 200 && !/gokuProps|awswaf/i.test(s) && expects.every((e) => s.includes(e))) body = buf;
  else await p.waitForTimeout(3000);
}
await b.close();
if (!body) { console.error("FAILED", url); process.exit(2); }
fs.writeFileSync(out, body);
console.log(JSON.stringify({ url, out, bytes: body.length }));
```

List the available versions (the register page shows "Access current version
(DD/MM/YYYY)" plus older dates):

```bash
node $SCRATCH/fetch-eurlex.mjs "https://eur-lex.europa.eu/legal-content/NL/ALL/?uri=CELEX:32024R1689" $SCRATCH/versions.html
grep -oE '02024R1689-[0-9]{8}' $SCRATCH/versions.html | sort -u
```

If the newest date equals the current `base`, stop — nothing to do. **Trap:**
a consolidation may not exist in every language; confirm the NL file is real
(a suspiciously small file is an error page).

## 2. Fetch the new consolidated NL HTML

```bash
node $SCRATCH/fetch-eurlex.mjs \
  "https://eur-lex.europa.eu/legal-content/NL/TXT/HTML/?uri=CELEX:02024R1689-YYYYMMDD" \
  data/source/consolidated/02024R1689-YYYYMMDD.html --expect 'id="art_113"'
```

Proof of the fetch method: re-fetching the current `base` must give a file
that differs from the committed one only in EUR-Lex's tracking `<script>` tag.

Read its header ("Gewijzigd bij:" / "Gerectificeerd bij:" table): which
▼M-markers (amending acts) and ▼C-markers (corrigenda) are new?

- **Only corrigenda / editorial changes** → point `base` at the new file,
  keep `previous`/`amending`, go to step 3. Expect verify-amendments to fail
  if the corrigendum touches changed text — audit, then re-pin.
- **A new amending act (▼M2 …)** → the act now in force is that one: move the
  old `base` to `previous`, the new file to `base`, fetch the act's OJ text
  (`…/TXT/HTML/?uri=CELEX:3YYYYRNNNN`, `--expect 'id="art_1"'`) into
  `data/source/amending/` and point `amending` at it. `parse-amendments.ts`
  checks that the act's entry into force equals the consolidation date.
  Expect to extend the instruction grammar in `scripts/lib/change-layer.ts`
  (it throws on unknown wording — extend, never weaken).

## 3. Re-parse and audit

```bash
npm run parse
```

Compare old vs new **before trusting anything**:

- Base corpus: diff `git show HEAD:data/generated/articles.json` against the
  working tree per article slug (flatten each paragraph; `scripts/lib/
  consolidated.ts` + `src/lib/flatten.ts`). Every changed article must be
  explained by the new act/corrigendum; unchanged articles must keep identical
  text and refs. Unexplained length drops = parser bug, not text change —
  suspect the article walker (continuation alineas are siblings of lid divs)
  and the `span.no-parag` quoted-marker logic. EUR-Lex re-typesets between
  consolidations (2026: every opening quote “ → „, footnotes renumbered) —
  that is expected noise in the base diff, and the change layer normalizes it.
- Change layer: `parse-amendments.ts` itself throws when an instruction
  changes nothing or a change has no instruction; `verify-amendments.ts`
  cross-checks against the ▼ markers and the instructions' quoted text.

## 4. Update verify assertions deliberately

A new version will break pins on purpose. Review and update, based on the
audit (never loosen blindly), each with a history comment:

- `scripts/verify-data.ts`: article/annex counts, `FLAT` list, footnote
  articles, search-doc counts, ref count, spot-check phrases (art. 113 dates).
- `scripts/verify-amendments.ts`: `EXPECTED` (instructions, leaves, target
  sets, XIV tables, refs, search docs) and the explained allowlists.
- `scripts/verify-search.ts` golden queries, `verify-assessment.ts` (ref
  anchors), the `verify-app` skill's expected counts and curl strings.

## 5. Rebuild, update provenance, commit

```bash
npm run build   # parse → verify → next build; must be fully green
```

The CELEX ids and dates shown on the site come from `corpus.json` and the
act's OJ text (`src/lib/amendment-meta.ts`) — no hand edits there. Update the
prose that names them: `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, the
assessment basis/disclaimer and explainer pages if dates change, and this
skill's table.

```bash
git add data/ public/*.json scripts/ README.md AGENTS.md docs/ .claude/
git commit -m "data: update to consolidated version 02024R1689-YYYYMMDD"
```

Then run the `verify-app` skill before pushing.

## 6. Redeploy site + restart MCP server

The MCP server (`mcp/`, systemd user unit `aiact-mcp`) loads the corpus once
at startup, and nginx serves a copy of `out/` — both go stale after a source
update. On the host serving aia.mrfrank.dev:

```bash
git pull --ff-only && npm ci && ./scripts/deploy-site.sh
(cd mcp && npm ci && npm run build) && systemctl --user restart aiact-mcp
```
