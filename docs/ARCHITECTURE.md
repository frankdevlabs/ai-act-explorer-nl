# Architecture

Deep reference for anyone modifying the parser, data model, or search. For the
quick operating manual, see [`AGENTS.md`](../AGENTS.md) in the repo root.

## Big picture

Fully static site. All content lives in committed JSON generated once from two
EUR-Lex HTML files; there is no database and no server runtime.

```
data/source/aiact_nl_consolidated.html ─┐
data/source/aiact_nl.html ──────────────┤→ scripts/parse-aiact.ts
                                        │       ↓
                                        │  data/generated/{toc,articles,recitals,annexes,search-docs}.json
                                        │       ↓                          ↓
                                        │  scripts/verify-data.ts     public/search-docs.json (copy)
                                        │       ↓                          ↓
                                        └─ next build (static import   fetched lazily in the browser,
                                           via src/lib/data.ts)        indexed by MiniSearch (src/lib/search.ts)
```

`npm run build` = `parse → verify → next build`. The verify step is a hard
gate: if any assertion in `scripts/verify-data.ts` fails, the build stops.

## Why two source files

- **`aiact_nl_consolidated.html`** — consolidated text, CELEX
  `02024R1689-20240712`, which incorporates corrigenda R(02)/R(04) (e.g. the
  fixed lid numbering of article 73). Source for **chapters, articles,
  annexes, TOC, footnotes**.
- **`aiact_nl.html`** — the original Official Journal (OJ) publication.
  Consolidated versions on EUR-Lex **omit the preamble**, so the 180
  **recitals** can only come from this file.

Both URLs sit behind an AWS WAF (plain `curl` gets HTTP 202 + a JS challenge).
They were fetched once with `~/law-tracker/lib/fetch_blocked_doc.py` (see the
`update-source` skill in `.claude/skills/`).

## The two EUR-Lex HTML dialects (the #1 trap)

The two files use **completely different markup**. `parse-aiact.ts` loads them
into separate cheerio instances: `$` = consolidated, `$oj` = OJ. Do not assume
a selector that works in one file works in the other.

| Concept | Consolidated dialect (`$`) | OJ dialect (`$oj`) |
|---|---|---|
| Article container | `div.eli-subdivision#art_N` | `div.eli-subdivision#art_N` |
| Article title | `.eli-title .stitle-article-norm` | `p.oj-sti-art` |
| Lid (numbered paragraph) | `div.norm` with child `span.no-parag` containing `"N."` | `div` with id `NNN.MMM` (e.g. `005.001` = art 5 lid 1) |
| Points a)/1./i) | `div.grid-container.grid-list` (`.grid-list-column-1` = marker, `.grid-list-column-2` = content, nests recursively) | 2-column `<table>`, nests recursively |
| Chapter / section | `div#cpt_III`, `div#cpt_III.sct_1` + `p.title-division-1/2` | `div#cpt_III` + `p.oj-ti-section` etc. |
| Annex | `div#anx_III` + `p.title-annex-1/2`, sub-headings `p.title-gr-seq-level-1` | `div#anx_III` + 2× `p.oj-doc-ti` |
| Recital | *(absent — no preamble)* | `div.eli-subdivision#rct_N` → first `tr` → last `td` → `p`s |
| Footnotes | pooled `p.footnote` at document end; inline ref `<a href="#E0001" id="src.E0001">` with visible superscript | inline `a[href^=#ntc]` + `p.oj-note` |

Only the consolidated dialect (articles/annexes) and the OJ recital shape are
implemented; the OJ article code was removed when the consolidated version was
folded in (git history has it if ever needed).

## Parser walkthrough (`scripts/parse-aiact.ts`)

Read top-to-bottom; it's a straight-line script, ~450 lines.

### Generic block parser: `parseBlocks` / `parseNodes`

Converts a container's children into `ContentNode[]` (`text` | `heading` |
`list`). Key behaviors:

- **Text buffering**: direct text nodes and inline elements (`a`, `span`,
  `em`) accumulate in `textBuf`; the buffer flushes into one `text` node when
  a block element appears. Needed because `div.norm.inline-element` often
  holds bare text nodes, not `<p>`s.
- **`span.no-parag` handling** (`skipLidMarker` param): when parsing a lid
  body, the *first* `no-parag` span is the lid number already captured by the
  caller → dropped. Every other `no-parag` span is **kept as text** — in
  amendment articles (102–110) the quoted text of amended acts contains its
  own lid numbers (`"5."`) that must stay in the body.
- **`SKIP_P_CLASSES`**: structural titles (`title-article-norm`,
  `title-division-*`, `title-annex-*`) and `p.footnote` are skipped;
  `p.title-gr-seq-*` becomes a `heading` node (annex sub-headings).
- **Grid lists**: each `div.grid-container.grid-list` is one list item;
  consecutive ones merge into the preceding `list` node. Column 2 recurses,
  giving nested point hierarchies.

### Article walker (the subtle part)

Iterates an article's **direct children in document order**:

- A `div.norm` whose first `span.no-parag` matches `/^\d+\.$/` (unquoted!)
  starts a new lid entry.
- **Everything else is buffered and flushed into the *current* lid.** In this
  dialect, continuation alineas of a lid are *siblings* of the lid div, not
  children. An earlier version treated only lid divs and lost text from 41
  articles (art 11 went 2000 → 939 chars). If you touch this loop, re-run the
  corpus diff described in the `update-source` skill.
- Quoted markers (`"5.`, in curly quotes) fail the regex on purpose — they are
  amended-act text, so articles 102–110 parse as one flat body.
- A flat article (no lids at all) gets a single paragraph
  `{number: null, anchor: "inhoud"}`. The known flat list is asserted in
  `verify-data.ts` (`FLAT`).
- **Anchor dedup**: if a lid number repeats (happened with OJ art 73), anchors
  become `lid-N`, `lid-N-bis`, `lid-N-bis-3`, … Never strip suffixes with a
  regex here — `lid-11` looks like `lid-1` + suffix.

### Footnotes

All `p.footnote` texts are pooled into `footnoteTextById`, keyed by the
`E0001`-style id. Per article/annex, `referencedFootnotes(container)` finds
`a[id^="src."]` descendants; the **label comes from the visible superscript
text** (`1`, `*4`) so it matches what the reader sees in the body — the E-ids
do *not* correspond to the printed numbering. Deduped by target id within one
container.

### Recitals, chapters, annexes

Mechanical: id-pattern matches (`rct_(\d+)`, `^cpt_[IVXLC]+$`,
`^cpt_[IVXLC]+\.sct_(\d+)$`, `^anx_([IVXLC]+)$`). Articles are assigned to
chapter/section by DOM containment (`$.contains`). Annex ordinals via a local
`romanToInt`.

### Search docs

One `SearchDoc` per article paragraph (so results deep-link to `#lid-N`), one
per recital, and annexes chunked per `heading` node (whole annex if none).
Written pretty-printed (`JSON.stringify(_, null, 1)`) for stable git diffs,
then `search-docs.json` is copied to `public/`.

## Data model (`src/lib/types.ts`)

```
ContentNode = text | heading | list{ items: ListItem[] }
ListItem    = { marker, content: ContentNode[], anchor? }   // anchor only on top-level items
ArticleParagraph = { number: number|null, anchor, content } // null = flat article
Article     = { number, title, chapter, chapterTitle, section, sectionTitle, paragraphs, footnotes }
Recital     = { number, paragraphs: string[] }              // plain strings, no nesting
Annex       = { roman, ordinal, title, content, footnotes }
SearchDoc   = { id, type: artikel|overweging|bijlage, ref, heading, url, text }
```

Anchor scheme: `#lid-3`, `#lid-3-a` (point a of lid 3), `#punt-12` (top-level
points of flat articles/annexes), `#inhoud` (flat article body).

## Verify script (`scripts/verify-data.ts`)

Runs before every build. Assertion classes and what they guard:

- **Counts + consecutive numbering** (113/180/13/13): a selector regression
  silently dropping items.
- **Section distribution** `{III:5, V:4, VII:2, IX:5}`: chapter/section
  containment logic.
- **Per-article title/body length + unique anchors**: empty-parse and dedup
  regressions.
- **`FLAT` list** (3, 4, 16, 32, 39, 66, 85, 87, 94, 102–110, 113) and its
  inverse: the lid-marker regex. If an article suddenly moves in/out of this
  list, the walker changed behavior.
- **Corpus > 500k chars, > 700 search docs**: bulk text loss (the class of bug
  that once cost 41 articles).
- **Spot checks**: exact Dutch phrases from art 3/5/113, recitals 1/180,
  annex III nesting — proof the *right* text landed in the *right* place.
- **Consolidated-specific**: art 73 lids exactly `1..11` (the corrigendum);
  arts 78 and 102–110 exactly 1 footnote each.

**When the source legitimately changes** (new consolidated version): expect
the FLAT list, footnote counts, spot-check phrases, and possibly counts to
need deliberate updates. Change assertions only after eyeballing the corpus
diff — never loosen them to "make the build pass".

## Search (`src/lib/search.ts`)

- MiniSearch index built **in the browser** on first use: `getSearchIndex()`
  is a lazy singleton that fetches `/search-docs.json` (~735 KB) and
  `addAll`s. Failure resets the singleton so a retry can succeed.
- `normalizeTerm`: lowercase → NFD → strip combining marks (so `artificiele`
  matches `artificiële`) → drop Dutch stopwords and 1-char terms. Applied at
  both index and query time; at query time un-normalizable terms fall back to
  plain lowercase instead of vanishing.
- `searchOptions`: `prefix: true`, `fuzzy: 0.2`, `boost: {heading: 3}`.
- `makeSnippet` returns ±120 chars around the first term match;
  `Highlight.tsx` wraps matches in `<mark>` by splitting on a single
  capture-group regex — **matches land at odd indices**. Don't refactor to
  `re.test()` per part: a stateful `/g` regex alternates true/false.

## Frontend notes

- Next 16 App Router, `output: 'export'`, all dynamic routes use
  `generateStaticParams` + `dynamicParams = false`. Route `params` is a
  **Promise** in Next 16 — always `await params`.
- Rendering chain: page → `ArticleBody` (lid number column, copy-link button,
  footnote endnotes) → `ContentNodes` (recursive; lists render as a
  2-column grid `li` with `id={item.anchor}`).
- Deep-link highlight: `.target-highlight:target` in `globals.css` +
  `scroll-mt-24` to clear the sticky header.
- `Header.tsx` exports `OPEN_SEARCH_EVENT` (`aiact:open-search`) and
  `OPEN_MENU_EVENT` (`aiact:open-menu`); `SearchPalette` / `MobileNav` listen
  on `window`. The palette also binds Ctrl/Cmd+K itself.
- Theme: `next-themes` with class attribute. `ThemeToggle` uses the
  `useSyncExternalStore(() => () => {}, () => true, () => false)` idiom for
  the mounted check — a `useEffect`+`setState` version trips the
  `react-hooks/set-state-in-effect` lint rule.
- `/zoeken` reads `?q=` via `useSearchParams`, so the client component is
  wrapped in `<Suspense>` (required for static export).

## Known quirks — "if you see X, it's because Y"

- **Article 73 anchors `lid-N-bis`** in old data: the OJ text had duplicate/
  skipped lid numbers; the consolidated text fixed it (now plain 1–11). The
  dedup code stays as a guard.
- **Annex I items looked empty**: its content cells contain bare `<span>`s,
  not `<p>`s — that's why `parseNodes` buffers inline elements as text.
- **`( 1 )` with spaces in extracted text**: superscript footnote refs; a
  `cleanText` regex normalizes to `(1)`.
- **Articles 102–110 have no lids** despite visible numbering: those numbers
  belong to the *amended* regulations (quoted text), not to this act.
