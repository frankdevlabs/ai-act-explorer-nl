<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Act Explorer NL — operating manual

Static Next.js explorer for the Dutch text of the EU AI Act (Regulation
2024/1689). No database, no server: `output: 'export'` produces a fully static
site (313 pages). Search is client-side (MiniSearch over a build-time corpus).

Deep dive: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Repeatable
procedures: `.claude/skills/` (`update-source`, `verify-app`).

## Golden rules

1. **Never hand-edit `data/generated/*` or `public/search-docs.json`.** They
   are parser output. Change `scripts/parse-aiact.ts` and run `npm run parse`.
2. **Never edit the legal text itself.** All content comes deterministically
   from the two EUR-Lex HTML files in `data/source/` — no manual or
   LLM transcription, ever. Wording bugs are parser bugs.
3. `npm run build` = `parse → verify → next build`. If
   `scripts/verify-data.ts` fails, fix the parser (or, after a deliberate
   source update, the assertions) — don't loosen assertions to pass.
4. Commit `data/source/`, `data/generated/`, and `public/search-docs.json`
   together with the parser change that produced them.

## Data flow

`data/source/*.html` → `scripts/parse-aiact.ts` (cheerio) →
`data/generated/*.json` → statically imported by `src/lib/data.ts`;
`search-docs.json` is also copied to `public/` and lazily fetched in the
browser (`src/lib/search.ts`).

Two sources on purpose: the **consolidated** text (CELEX 02024R1689-20240712,
corrigenda incorporated) provides articles/annexes/TOC; the **original OJ**
text provides the 180 recitals (consolidated versions have no preamble). The
two files use different HTML markup — see ARCHITECTURE.md before touching the
parser. Both are WAF-blocked on EUR-Lex; fetch new versions via
`python3 ~/law-tracker/lib/fetch_blocked_doc.py "<url>" "<out>"`.

## Key files

| File | Role |
|---|---|
| `scripts/parse-aiact.ts` | HTML → JSON parser, both dialects; the heart of the repo |
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
- UI language is Dutch; code, comments, and docs are English.
- No test framework; verification = `verify-data.ts` + the `verify-app` skill.

## Environment (this VPS)

- Dev server in tmux: `tmux new-session -d -s aiact-dev 'npm run dev'`
  (check `tmux list-sessions` first — it is often already running, port 3105).
- No pip; no root. Playwright works via `~/law-tracker/lib` (see
  `.claude/skills/verify-app/SKILL.md`).
- GitHub: `frankdevlabs/ai-act-explorer-nl`; commit as
  `frankdevlabs <29236012+frankdevlabs@users.noreply.github.com>` (repo-local
  git config already set).
