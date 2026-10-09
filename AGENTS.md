<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Act Explorer NL — operating manual

Static Next.js explorer for the Dutch text of the EU AI Act (Regulation
2024/1689). No database, no server: `output: 'export'` produces a fully static
site (~320 pages; exact expectation pinned in the `verify-app` skill). Search
is client-side (MiniSearch over a build-time corpus).

Deep dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Repeatable
procedures: `.claude/skills/` (`plan-an-epic` — the working method,
`update-source`, `extend-parser`, `curate-recital-map`, `verify-app`).

## Golden rules

1. **Never hand-edit `data/generated/*`, `public/search-docs.json` or
   `public/amendment-search-docs.json`.** They are parser output. Change
   `scripts/parse-aiact.ts` / `scripts/parse-amendments.ts` and run
   `npm run parse`.
2. **Never edit the legal text itself.** All legal text comes
   deterministically from the EUR-Lex HTML files listed in
   `data/source/corpus.json` — no manual or LLM transcription, ever. Wording
   bugs are parser bugs. This includes the change layer of the digitale
   omnibus (Verordening (EU) 2026/1744): it is derived from the two
   consolidated versions plus the act's OJ text (epic 8 retired the PE-CONS
   30/26 hand transcription; see git history before `epic-8` if a future
   *pending* amending act ever needs tracking again).
   **2b. Editorial-metadata layer:** `data/source/recital-article-map.json`
   is hand/LLM-curated *interpretive* metadata (which articles each recital
   motivates), clearly not legal text. It must never alter the rendering of
   legal text — it only feeds the "Relevante overwegingen" / "Relevante
   artikelen" panels and MCP output. Changes follow
   `.claude/skills/curate-recital-map/`; gated by
   `scripts/verify-recital-map.ts`.
3. `npm run build` = `parse → verify → next build`. If
   `scripts/verify-data.ts`, `scripts/verify-amendments.ts` or
   `scripts/verify-recital-map.ts` fails, fix the parser or curated source
   (or, after a deliberate source update, the assertions) — don't loosen
   assertions to pass. Re-pin exact counts only after auditing
   `git diff data/generated/` change by change; each pin carries a history
   comment — read it first (protocol: ARCHITECTURE.md, "Verify script").
4. Commit `data/source/`, `data/generated/`, and generated `public/*.json`
   together with the parser change that produced them.

## Data flow

`data/source/*.html` → `scripts/parse-aiact.ts` (cheerio) →
`data/generated/*.json` → statically imported by `src/lib/data.ts`;
`search-docs.json` is also copied to `public/` and lazily fetched in the
browser (`src/lib/search.ts`).

Change layer (digitale omnibus, Verordening (EU) 2026/1744, in force
27.7.2026): `scripts/parse-amendments.ts` diffs the `previous` consolidated
version against the base corpus and attributes every change to an
instruction of the amending act (OJ text) → `data/generated/amendments.json`
+ `amendment-diffs.json` + `public/amendment-search-docs.json`. Libraries:
`scripts/lib/{consolidated,change-layer,oj-instructions}.ts`.

Sources (`data/source/corpus.json`): the **consolidated** text (base, CELEX
02024R1689-20260727 — the law in force) provides articles/annexes/TOC; the
**previous** consolidation (02024R1689-20240712) is only diffed against; the
**original OJ** text provides the 180 recitals (consolidated versions have no
preamble); the **amending act's** OJ text (32026R1744) provides instructions
and act metadata. Consolidated and OJ files use different HTML markup — see
ARCHITECTURE.md before touching the parser. All are WAF-blocked on EUR-Lex;
fetch them with headless Chromium (snippet in `.claude/skills/update-source/`).

## Key files

| File | Role |
|---|---|
| `scripts/parse-aiact.ts` | corpus → JSON (refs, TOC, search docs); dialect parsing in `scripts/lib/consolidated.ts` |
| `scripts/parse-amendments.ts` | change layer of the in-force amending act (`scripts/lib/change-layer.ts`) |
| `scripts/verify-data.ts` | pre-build completeness assertions (counts, structure, spot-checks) |
| `src/lib/types.ts` | shared data model (ContentNode, Article, SearchDoc, …) |
| `src/lib/data.ts` | typed accessors + prev/next navigation over generated JSON |
| `src/lib/search.ts` | MiniSearch index (lazy singleton), Dutch normalization, snippets |
| `src/components/content/ContentNodes.tsx` | recursive renderer for ContentNode trees |
| `src/components/search/SearchPalette.tsx` | Ctrl/Cmd+K palette (cmdk) |
| `src/components/layout/SidebarToc.tsx` | collapsible TOC, active-route aware |

## Conventions

- Routes: `/artikel/[nummer]`, `/overweging/[nummer]`, `/bijlage/[nummer]`
  (lowercase roman, e.g. `/bijlage/iii`); index pages `/overwegingen`,
  `/bijlagen`; search `/zoeken?q=`.
- Anchors: `#lid-3`, `#lid-3-a`, `#punt-12`, `#inhoud` — stable deep links,
  used by search results. Don't rename without updating the parser's anchor
  generation and search-doc URLs together.
- All dynamic routes: `generateStaticParams` + `export const dynamicParams =
  false`. Next 16: `params` is a Promise — `await` it.
- RSC boundary: client-component props must be plain serializable data (no
  Set/Map); derive UI state during render, not in effects. Details:
  ARCHITECTURE.md, "Frontend notes".
- UI language is Dutch; code, comments, and docs are English.
- No test framework; verification = `verify-data.ts` + `verify-search.ts` (golden search queries; update entries consciously, never delete to pass) + the `verify-app` skill.

## Environment (this VPS)

- Dev server in tmux: `tmux new-session -d -s aiact-dev 'npm run dev'`
  (check `tmux list-sessions` first — it is often already running, port 3105).
- No pip. Playwright works via `~/mc/mcp-rcon/node_modules` (browsers in
  `~/.cache/ms-playwright`; see `.claude/skills/verify-app/SKILL.md` and the
  EUR-Lex fetch snippet in `.claude/skills/update-source/SKILL.md`).
- The live site and MCP (aia.mrfrank.dev) run on host vmi2502453 (tailnet
  100.74.62.83), not necessarily where you are working: deploy = `git pull` +
  `scripts/deploy-site.sh` + MCP rebuild/restart there (`mcp/README.md`).
- GitHub: `frankdevlabs/ai-act-explorer-nl`; commit as
  `frankdevlabs <29236012+frankdevlabs@users.noreply.github.com>` (repo-local
  git config; set it in fresh clones).
