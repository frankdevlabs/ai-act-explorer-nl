---
name: update-source
description: Fetch a newer EUR-Lex consolidated version of Regulation 2024/1689 (NL), re-parse, diff the corpus against git HEAD, update verify assertions, rebuild. Use when a new consolidated version or corrigendum is published, or when the source text must be refreshed.
---

# Update the source text

Current source: consolidated CELEX `02024R1689-20240712`. Recitals come from
the separate OJ file (`data/source/aiact_nl.html`) and normally never change.

## 1. Check for a newer consolidated version

The consolidated CELEX pattern is `02024R1689-YYYYMMDD`. List available
versions from the document page — that page is WAF-blocked too, so fetch it
with the helper:

```bash
# write to your session scratchpad dir
python3 ~/law-tracker/lib/fetch_blocked_doc.py \
  "https://eur-lex.europa.eu/legal-content/NL/ALL/?uri=CELEX:32024R1689" \
  "$SCRATCH/aiact-versions.html"
grep -oE '02024R1689-[0-9]{8}' "$SCRATCH/aiact-versions.html" | sort -u
```

If the newest date equals `20240712`, stop — nothing to do.

## 2. Fetch the new consolidated NL HTML

```bash
python3 ~/law-tracker/lib/fetch_blocked_doc.py \
  "https://eur-lex.europa.eu/legal-content/NL/TXT/HTML/?uri=CELEX:02024R1689-YYYYMMDD" \
  data/source/aiact_nl_consolidated.html
```

Exit codes: 0 = validated file on disk (JSON receipt printed), 2 =
blocked/network, 3 = bad usage, 4 = browser tier needs setup (see
`~/law-tracker/lib/SETUP.md`). Plain `curl`/WebFetch will NOT work (HTTP 202 +
JS challenge).

Sanity: file should be roughly 700–900 KB and contain `id="art_113"`.

## 3. Re-parse and diff the corpus against git HEAD

```bash
npm run parse
```

Then compare old vs new flattened text **before trusting anything**. This diff
technique once caught a walker bug that silently dropped text from 41
articles. Script (run from repo root with `npx tsx`):

```ts
// corpus-diff.ts — flatten articles+annexes from git HEAD vs working tree
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
type Node = { type: string; text?: string; items?: { marker: string; content: Node[] }[] };
const flat = (ns: Node[]): string =>
  ns.map(n => n.type === "list"
    ? n.items!.map(i => `${i.marker} ${flat(i.content)}`).join(" ")
    : n.text ?? "").join(" ");
for (const f of ["articles", "annexes"]) {
  const old = JSON.parse(execSync(`git show HEAD:data/generated/${f}.json`, { maxBuffer: 1e8 }).toString());
  const cur = JSON.parse(readFileSync(`data/generated/${f}.json`, "utf-8"));
  for (let i = 0; i < Math.max(old.length, cur.length); i++) {
    const o = old[i], c = cur[i];
    const ot = o ? (o.paragraphs ? o.paragraphs.map((p: { content: Node[] }) => flat(p.content)).join(" ") : flat(o.content)) : "";
    const ct = c ? (c.paragraphs ? c.paragraphs.map((p: { content: Node[] }) => flat(p.content)).join(" ") : flat(c.content)) : "";
    if (ot !== ct) console.log(`${f}[${i}] (${o?.number ?? o?.roman} → ${c?.number ?? c?.roman}): ${ot.length} → ${ct.length} chars`);
  }
}
```

Every listed item must be explainable by the new corrigendum/amendment.
Unexplained length drops = parser bug, not text change. Suspect first: the
article walker in `scripts/parse-aiact.ts` (continuation alineas are siblings
of lid divs) and the `span.no-parag` quoted-marker logic — see
`docs/ARCHITECTURE.md`.

## 4. Update verify assertions deliberately

A new version will likely break `scripts/verify-data.ts` on purpose. Review
and update, based on the diff (never loosen blindly):

- `FLAT` list (articles without numbered lids) — amendments may add/remove.
- Footnote counts (currently arts 78, 102–110 = 1 each) and the total in the
  parse log.
- Spot-check phrases if the corrigendum rewrote them.
- Counts only if articles/annexes were genuinely added or repealed.
- Art 73 numbering assertion (`1..11`) should keep holding.

## 5. Rebuild, update provenance, commit

```bash
npm run build   # parse → verify → next build; must be fully green
```

Update the CELEX id + date in: `README.md`, `src/app/page.tsx` (footer),
`docs/ARCHITECTURE.md`, the header comment of `scripts/parse-aiact.ts`, and
this skill (step "Current source").

Commit source + generated + assertion changes together:

```bash
git add data/ public/search-docs.json scripts/verify-data.ts README.md src/app/page.tsx docs/ .claude/
git commit -m "data: update to consolidated version 02024R1689-YYYYMMDD"
```

Then run the `verify-app` skill before pushing.

## 6. Redeploy site + restart MCP server

The MCP server (`mcp/`, systemd user unit `aiact-mcp`) loads the corpus once
at startup, and nginx serves a copy of `out/` — both go stale after a source
update:

```bash
./scripts/deploy-site.sh                 # rebuild + rsync to /var/www/aia.mrfrank.dev
systemctl --user restart aiact-mcp       # reload corpus in the MCP server
```
