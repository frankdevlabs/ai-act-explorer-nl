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

data/source/amendments/pe-cons-30-26.json (curated, see Amendment layer)
    → scripts/parse-amendments.ts (after parse-aiact; diffs against the base corpus)
    → data/generated/{amendments,amendment-diffs}.json + public/amendment-search-docs.json
    → scripts/verify-amendments.ts
```

`npm run build` = `parse → verify → next build`, where `parse` runs
`parse-aiact.ts` then `parse-amendments.ts` and `verify` runs `verify-data.ts`
then `verify-amendments.ts`. Verify is a hard gate: any failed assertion stops
the build.

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
RefSpan     = { start, end, href }                          // char offsets into the sibling text
ContentNode = text{ text, refs? } | heading | list{ items: ListItem[] } | table{ rows }
ListItem    = { marker, content: ContentNode[], anchor? }   // anchor only on top-level items
ArticleParagraph = { number: number|null, anchor, content } // null = flat article
Article     = { number, title, chapter, chapterTitle, section, sectionTitle, paragraphs, footnotes }
Recital     = { number, paragraphs: { text, refs? }[] }
Annex       = { roman, ordinal, title, content, footnotes }
SearchDoc   = { id, type: artikel|overweging|bijlage, ref, heading, url, text }
```

The `table` node exists only for amendment content (Bijlage XIV); the base
parser never emits it. Amendment-layer types (`Amendment`, `NewArticleSpec`,
`ParagraphDiff`, `DiffSegment`, …) live in the same file — see the Amendment
layer section.

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

**When the grammar/producer changes** (crossref grammar, parser logic): pins
also move when a producer *improves* — grammar fixes shrink ref counts.
Protocol: change the producer → `npm run parse` → `git diff data/generated/`
→ read every changed span → classify each as fixed-false-positive or
regression → re-pin **with a history comment next to the assertion** (see
`verify-data.ts` around the ref-count pin, `verify-amendments.ts` around
`allRefs.length`). The count pins are not tripwires against change; they are
forcing functions for this diff audit — three re-pins so far (566→563→561
base, 462→460 amendment) each caught real mislinks.

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

## Cross-references (RefSpans)

Plain-text references ("artikel 6, lid 2, punt c)", "bijlage III", "hoofdstuk
V") are detected **at parse time** and stored as char-offset annotations on
text nodes (`refs?: RefSpan[]`), never by splitting the text. Design intent:

- `text` stays byte-identical, so search-doc flattening and verify's corpus
  checks are unaffected by linking.
- The verify gate can pin the exact ref count and re-check every href — a
  render-time regex would ship grammar regressions silently.

The grammar lives in `src/lib/crossrefs.ts` (`findRefs(text, ctx)`, pure): a
keyword scanner (`artikel(en)/bijlage(n)/hoofdstuk(ken)/overweging(en)`) with a
sticky-regex `Cursor`, number-list parsing (enumerations `53 en 55` and ranges
`tot en met` emit one span per number token), and a `lid/leden/punt/punten/
alinea` sub-ref tail mapped onto the existing anchor scheme (`lid-2-c`).
Article numbers may carry a Latin suffix (`artikel 75 ter` → `/artikel/75ter`,
the omnibus new-article slug convention); as a side effect, `artikel 6 bis van
Protocol nr. 21`-style phrases hit the instrument exclusion instead of
mislinking `/artikel/6`.
Exclusion lookahead runs before emitting: trailing `VWEU`/`VEU`, and
`van/bij <other instrument>` (Verordening/Richtlijn/Besluit/…) — the
self-forms `van deze verordening` and `van Verordening (EU) 2024/1689` stay
linkable. Articles 102–110 (which quote other acts) parse with
`linkBareRefs: false`: only explicit self-form references link there.

`parse-aiact.ts` runs a post-pass over all articles/annexes/recitals: attach
`findRefs` output, then **validate** each href against the corpus it just
built — unknown page target throws; a fragment whose anchor doesn't exist (or
isn't unique) on the target page is stripped to a page-level link.

`parse-amendments.ts` runs the same post-pass over the amendment layer (new
articles/annexes, `ParagraphDiff.newContent`, and diff segments — see the
Amendment layer section), with the validator extended by the pages and
anchors the omnibus itself adds. The parser is the **single authority**:
hand-curated `refs` in the transcription are stripped by the parser and
rejected by `verify-amendments.ts`.

Rendering: `ContentNodes` (and the recital page) pass text+refs to
`LinkedText` (RSC — slices the string at offsets) → `RefLink` (client, Radix
hover-card; preview title + snippet resolved at build via `getPreview` in
`data.ts` and inlined in the static HTML).

Verify: pinned total ref counts in `verify-data.ts` (base corpus) and
`verify-amendments.ts` (amendment layer, segment clips re-merged before
counting), independent href-resolution rechecks, positive and negative spot
checks (VWEU refs, other-instrument refs and treaty-Protocol refs must NOT be
annotated).

## Amendment layer (digitale omnibus)

Tracks the changes PE-CONS 30/26 (2025/0359 COD) makes to this regulation.
Everything is build-time; the site stays fully static.

```
data/source/amendments/pe-cons-30-26.json   ← curated transcription (AGENTS.md golden rule 2 carve-out;
        ↓                                      procedure: .claude/skills/transcribe-amendments/)
scripts/parse-amendments.ts                 ← runs after parse-aiact.ts
        ↓
data/generated/amendments.json              ← normalized instructions + indexes {byArticle, byAnnex,
        │                                      orderedTargets}, newArticles/newAnnexes, title changes
data/generated/amendment-diffs.json         ← per target, per paragraph: ParagraphDiff
public/amendment-search-docs.json           ← "omnibus-" prefixed SearchDocs, merged into the
                                               MiniSearch index (site + MCP)
```

Key mechanics in `parse-amendments.ts`:

- **Apply-then-diff**: base paragraphs become `ParaState`s; each instruction
  (`replace`/`insert`/`add`/`delete`, scoped by anchor or whole article)
  mutates the state; `statesToDiffs` then word-diffs old vs new flattened text
  (`diffWordsWithSpace` from the `diff` package) into
  `DiffSegment { op: eq|ins|del, text }` lists.
- **Diff invariant** (asserted here AND re-checked in `verify-amendments.ts`):
  `concat(eq+del) === flatten(old)` and `concat(eq+ins) === flatten(new)`,
  byte-exact. This is the strongest guard on transcription/diff integrity.
- **Anchors**: `withAnchors`/`paragraphAnchor` fill in anchors the
  transcription may omit, including bis-paragraph forms (`lid-5bis` via
  `displayNumber`). Shared flatten/anchor helpers live in `src/lib/flatten.ts`
  (used by parse-aiact, parse-amendments, and verify).
- **New provisions**: `NewArticleSpec` (slug `4bis`, display `4 bis`,
  `insertAfter`) and `NewAnnexSpec` drive extra static routes
  (`/artikel/4bis`, `/bijlage/xiv`), sidebar insertion, and prev/next chains.
- **Line structure**: flattening collapses list/paragraph structure, so
  `statesToDiffs` splits segments at block boundaries (`flattenWithBreaks` in
  `flatten.ts`, asserted byte-identical to `flattenNodes`) and flags each
  boundary chunk `br: true` — eq/ins split at new-text offsets, del at
  old-text offsets. Same-op adjacency keeps the diff invariant byte-exact;
  `DiffSegments` renders one `<p>` per `br` line (one definition per line on
  `/artikel/3` instead of a 20k-char blob).
- **Cross-references**: a post-pass annotates all amendment text (see the
  Cross-references section). For segments, `findRefs` runs once over the
  whole new text and spans are clipped per eq/ins segment
  (`DiffSegment.refs`, segment-local offsets; `del` never carries refs) —
  verify re-merges the clips before its span checks.

Verify (`scripts/verify-amendments.ts`) runs in **two regimes** keyed on
`source.meta.complete`: structural checks always (targets/anchors resolve,
slugs don't collide, diff reconstruction, search-doc shape, spot checks);
once `complete: true`, exact instruction/target counts are pinned.

UI surfaces: `AmendedArticleView` (per-article toggle "Toon wijzigingen",
both views pre-rendered as hidden siblings, change-nav) plus a global header
toggle — both share the `omnibus-diff` localStorage pref via
`src/lib/omnibus-pref.ts` (`useSyncExternalStore`; custom event same-tab,
`storage` event cross-tab). Precedence: `?diff=1` wins at page load, any
later preference change wins over the URL. `DiffArticleBody`/`DiffSegments`
(ins/del rendering, `br` line grouping, `LinkedText` cross-links inside
eq/ins), `/wijzigingen` index, sidebar dots.

**Planned source swap**: once the act is published in the OJ, a deterministic
parse of the CELEX HTML replaces the curated transcription — only the producer
of `amendments.json` changes; diffs, UI and verify stay as-is (see
`docs/epics/epic-2-omnibus-track-changes.md`).

## MCP server (`mcp/`)

Self-contained npm package (own `package.json`, tsc → `dist/`) exposing the
corpus to Claude clients; the site build never sees it. Full reference:
[`mcp/README.md`](../mcp/README.md).

- `mcp/src/data.ts` reads `data/generated/*.json` +
  `public/{search-docs,amendment-search-docs}.json` **once at startup** —
  after `update-source` or amendment changes, restart the service.
- Search relevance is shared with the site via `src/lib/search-core.ts`
  (stopwords, normalization, MiniSearch options); `src/lib/search.ts` is the
  thin browser wrapper around it.
- One `createServer()` factory, two transports: `stdio.ts` (Claude
  Desktop/Code) and `http.ts` (stateless streamable HTTP on `127.0.0.1:3106`,
  behind nginx at `https://aia.mrfrank.dev`).

## Runbook — which script, when

| Command / script | When | Gates / output |
|---|---|---|
| `npm run parse` | after changing parser code, source HTML, or the amendment transcription | regenerates `data/generated/*` + `public/*-search-docs.json` (commit together with the change — golden rule 4) |
| `npm run verify` | automatically before every build; run standalone while iterating | hard assertions; update pins only deliberately (golden rule 3) |
| `npm run build` | before deploying | parse → verify → static export in `out/` |
| `scripts/deploy-site.sh` | publish the site | build + rsync `out/` → `/var/www/aia.mrfrank.dev` + nginx reload (needs sudo) |
| MCP restart (systemd unit / tmux, see `mcp/README.md`) | after any data regeneration reaches `main` | picks up new JSON (loaded at startup only) |
| `.claude/skills/update-source` | new consolidated version on EUR-Lex | fetch → re-parse → corpus diff → assertion updates |
| `.claude/skills/transcribe-amendments` | wording fixes / new instructions in the amendment layer | curated-source edit procedure with page-image cross-check |
| `.claude/skills/verify-app` | after parser/data/UI changes, before pushing | build + curl smoke + Playwright checks |

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
- **RSC boundary**: props crossing into a `"use client"` component must be
  plain serializable data — arrays/objects, never `Set`/`Map` (bit us in the
  sidebar's amended-articles props).
- **Derive state during render, not in effects**: `useState` + syncing
  effect causes flashes and trips `react-hooks/set-state-in-effect` (the
  ThemeToggle idiom above is one instance; `AmendedArticleView` was reworked
  for the same reason).
- **Reload-surviving, pre-hydration state** (tab strip, omnibus pref): an
  inline `<script>` in the HTML registers first, the client component
  re-registers on mount — both paths write the same versioned localStorage
  shape. Effect-only registration loses fast page exits.
- **Long Dutch compounds overflow `1fr` at 360px**: list-grid columns use
  `minmax(0,1fr)` + `break-words`.

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
- **Diff-view ids carry a `w-` prefix** (`#w-lid-13`): the clean and diff
  views are pre-rendered as siblings on the same page, so unprefixed anchors
  would duplicate DOM ids and break `:target` deep links.
