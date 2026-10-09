# Architecture

Deep reference for anyone modifying the parser, data model, or search. For the
quick operating manual, see [`AGENTS.md`](../AGENTS.md) in the repo root.

## Big picture

Fully static site. All content lives in committed JSON generated from
EUR-Lex HTML files listed in `data/source/corpus.json`; there is no database
and no server runtime.

```
data/source/corpus.json → base     consolidated/02024R1689-20260727.html ─┐
                        → recitals aiact_nl.html (original OJ) ───────────┤→ scripts/parse-aiact.ts
                                                                          │   (scripts/lib/consolidated.ts)
                                                                          │       ↓
                                                                          │  data/generated/{toc,articles,recitals,annexes,search-docs}.json
                                                                          │       ↓                          ↓
                                                                          │  scripts/verify-data.ts     public/search-docs.json (copy)
                                                                          │       ↓                          ↓
                                                                          └─ next build (static import   fetched lazily in the browser,
                                                                             via src/lib/data.ts)        indexed by MiniSearch (src/lib/search.ts)

                        → previous consolidated/02024R1689-20240712.html ─┐
                        → amending amending/32026R1744.html (OJ) ─────────┤→ scripts/parse-amendments.ts
   base corpus (data/generated, above) ───────────────────────────────────┘   (scripts/lib/{change-layer,oj-instructions}.ts)
    → data/generated/{amendments,amendment-diffs}.json + public/amendment-search-docs.json
    → scripts/verify-amendments.ts
```

`npm run build` = `parse → verify → next build`, where `parse` runs
`parse-aiact.ts`, `parse-amendments.ts` and `build-recital-map.ts`, and
`verify` runs `verify-data.ts`, `verify-amendments.ts`,
`verify-recital-map.ts`, `verify-assessment.ts` and `verify-search.ts`.
Verify is a hard gate: any failed assertion stops the build.

## Sources (`data/source/corpus.json`)

- **base** — `consolidated/02024R1689-20260727.html`, the consolidated text
  in force since 27.7.2026: Regulation 2024/1689 as amended by Verordening (EU)
  2026/1744 (digitale omnibus inzake AI, ▼M1) with corrigenda C1/C2. Source
  for **chapters, articles, annexes, TOC, footnotes** — everything the site
  and MCP serve.
- **previous** — `consolidated/02024R1689-20240712.html`, the consolidation
  before the omnibus. Only diffed against (change layer); never served.
- **recitals** — `aiact_nl.html`, the original Official Journal publication.
  Consolidated versions on EUR-Lex **omit the preamble**, so the 180
  **recitals** can only come from this file (the omnibus did not amend them).
- **amending** — `amending/32026R1744.html`, the OJ text of Verordening (EU)
  2026/1744: its Article 1 instructions and its own metadata (adoption,
  publication, entry into force) drive the change layer.

All URLs sit behind an AWS WAF (plain `curl` gets HTTP 202 + a JS challenge).
Fetch them with headless Chromium — snippet in the `update-source` skill.

## The two EUR-Lex HTML dialects (the #1 trap)

Consolidated and OJ files use **completely different markup**.
`scripts/lib/consolidated.ts` parses each with its own cheerio instance
(`parseConsolidated` / `parseRecitals`), and `scripts/lib/oj-instructions.ts`
reads the amending act's OJ dialect. Do not assume a selector that works in
one file works in the other.

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

## Parser walkthrough (`scripts/lib/consolidated.ts` → `scripts/parse-aiact.ts`)

`parseConsolidated(html)` is pure (one cheerio document per call), so the
change layer can parse a second consolidated version; `parse-aiact.ts` adds
the cross-reference post-pass, TOC and search docs for the base corpus.

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
- **Consolidation markers** (`p.modref` / `p.arrow`, "▼M1", "▼B", "▼C2") carry
  no legal text and are skipped — except EUR-Lex's placeholder for struck text
  ("▼M1 —————", a[title] "…: DELETED"), kept verbatim as a `repealed` text node
  (or, between leden, a `repealed` paragraph that takes the next lid number).
  Before epic 8 the art. 73 markers leaked into the text as "▼C2"/"▼B".
- **Data tables** (`<table>`, bijlage XIV): a `table` node of direct
  `tbody > tr` rows (nested-table text belongs to its cell).
- **Provenance**: a document-order pre-pass records which ▼ marker governs
  every element; `parseConsolidated` returns, per paragraph/title/annex, the
  acts whose text it holds. Not persisted — verify-amendments cross-checks the
  change layer against it.
- **Grid lists**: each `div.grid-container.grid-list` is one list item;
  consecutive ones merge into the preceding `list` node. Column 2 recurses,
  giving nested point hierarchies.

### Article walker (the subtle part)

Iterates an article's **direct children in document order**:

- A `div.norm` whose first `span.no-parag` matches
  `/^\d+( bis| ter| quater| quinquies| sexies)?\.$/` (unquoted!) starts a new lid
  entry. Inserted leden ("1 bis.") get `number: null`, `displayNumber: "1 bis"`
  and the compact anchor `lid-1bis` (`lidAnchor` in `src/lib/flatten.ts`).
- Article ids `art_4a` … `art_75d` are EUR-Lex's encoding of "4 bis" …
  "75 quinquies" (a/b/c/d/e = bis/ter/quater/quinquies/sexies): `slug` "4bis",
  `displayNumber` "4 bis", checked against the visible "Artikel 4 bis" heading.
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
- **Duplicate anchors throw** (they used to be renamed `lid-N-bis`, which
  would now collide with legal bis-numbering `lid-Nbis`). Never strip suffixes with a
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
parser never emits it. Change-layer types (`Amendment`, `AmendingActMeta`,
`ParagraphDiff`, `DiffSegment`, …) live in the same file — see the Change
layer section. Articles carry `slug`/`displayNumber` next to the integer
`number` (4 for "4 bis"); key everything on `slug`.

Anchor scheme: `#lid-3`, `#lid-3-a` (point a of lid 3), `#punt-12` (top-level
points of flat articles/annexes), `#inhoud` (flat article body).

## Verify script (`scripts/verify-data.ts`)

Runs before every build. Assertion classes and what they guard:

- **Counts + consecutive numbering** (119 articles of which 113 integer,
  180/14/13): a selector regression silently dropping items. Look articles up
  by slug, never by array index (bis-articles shift indexes).
- **Section distribution** `{III:5, V:4, VII:2, IX:5}`: chapter/section
  containment logic.
- **Per-article title/body length + unique anchors**: empty-parse and dedup
  regressions.
- **`FLAT` list** (3, 16, 32, 39, 66, 75 ter, 85, 87, 94, 102–110, 113) and its
  inverse: the lid-marker regex. If an article suddenly moves in/out of this
  list, the walker changed behavior.
- **Corpus > 500k chars, exactly 885 search docs**: bulk text loss (the class
  of bug that once cost 41 articles).
- **Spot checks**: exact Dutch phrases from art 3/5/113, recitals 1/180,
  annex III nesting — proof the *right* text landed in the *right* place.
- **Consolidated-specific**: art 73 lids exactly `1..11` (the corrigendum);
  arts 40, 78 and 102–110 exactly 1 footnote each; art 10 lid 5 struck.

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
forcing functions for this diff audit — the history comments next to each pin
record every move (566→563→561→697 base, 462→460→464→207 change layer).

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

## Change layer (digitale omnibus, in force)

Verordening (EU) 2026/1744 (digitale omnibus inzake AI) is in force since
27.7.2026 and is part of the base text. The change layer shows *what it
changed*: a historical diff against the consolidation before it. Everything
is derived from EUR-Lex HTML; nothing is transcribed (epic 8 retired the
PE-CONS 30/26 hand transcription that drove this layer while the act was
pending — see `docs/epics/epic-2-omnibus-track-changes.md` and git history).

```
corpus.previous (02024R1689-20240712) ─┐
base corpus (data/generated)          ─┼→ scripts/parse-amendments.ts
corpus.amending (32026R1744, OJ)      ─┘     ↓
data/generated/amendments.json       ← meta (act number, OJ ref, adopted/published/in force — read
        │                               from the act), 72 instructions (verbatim wording, operation,
        │                               targets), byArticle/byAnnex, orderedTargets, newArticles/
        │                               newAnnexes (refs only — their text is base corpus), titleChanges
data/generated/amendment-diffs.json  ← per changed article/annex, per paragraph: ParagraphDiff
public/amendment-search-docs.json    ← "wijz-" SearchDocs: instruction wording only, never legal text
```

Mechanics (`scripts/lib/change-layer.ts`):

- **Corpus vs corpus**: `diffCorpora` aligns the two versions per article
  (slug) and paragraph (anchor): unchanged / modified / inserted / deleted, a
  struck lid (`repealed` in the base) counting as deleted. Annexes diff as one
  pseudo-paragraph `inhoud`.
- **Typographic baseline**: the 2026 consolidation re-typeset the whole act
  (every opening quote “ → „; footnotes renumbered after the one instruction
  17 inserted in art. 40). The previous version is compared — and its deleted
  text shown — in the current typography, so only substantive changes remain.
- **Word segments**: `diffWordsWithSpace` over flattened text (struck-text
  placeholders excluded), split at block boundaries (`flattenWithBreaks`, `br`
  flags) for line structure. **Diff invariant** (asserted in the producer and
  re-checked in verify): `concat(eq+del) === old` and `concat(eq+ins) === new`,
  byte-exact.
- **Instructions** (`scripts/lib/oj-instructions.ts`): Article 1 of the OJ
  text — 43 numbered instructions, 72 leaves — with verbatim parent/child
  wording and quoted new text. A small grammar reads each instruction's target
  (artikel/lid[ bis]/punt/alinea/aanhef/titel/bijlage, or inserted
  articles/annex) and throws on anything unknown; every instruction must
  change something and every change must have an instruction.
- **Cross-references** in eq/ins segments: `findRefs` over the whole new text,
  clipped per segment (`DiffSegment.refs`), validated against the base corpus.

Verify (`scripts/verify-amendments.ts`) re-derives the layer from the sources
and checks four independent signals: (a) the diff invariant; (b) EUR-Lex's
own ▼M1 markers in the base consolidation cover exactly the changed set
(explained allowlist); (c) every quoted block of the act's instructions is in
the new text of its target and not in the old; (d) attribution both ways.
Plus act metadata (in force = publication + 3 days = consolidation date),
pinned target sets, bijlage XIV table shapes, ref and search-doc pins.

UI surfaces: `AmendedArticleView` (per-article toggle "Toon wijzigingen",
both views pre-rendered as hidden siblings, change-nav; the clean view is the
law in force) plus a global header toggle — both share the `omnibus-diff`
localStorage pref via `src/lib/omnibus-pref.ts` (`useSyncExternalStore`;
custom event same-tab, `storage` event cross-tab). Precedence: `?diff=1` wins
at page load, any later preference change wins over the URL.
`DiffArticleBody`/`DiffSegments` (ins/del rendering, `br` line grouping,
`LinkedText` cross-links inside eq/ins), `/wijzigingen` index (verbatim
instructions, deep links), sidebar dots, inserted-article/annex banners. All
status wording comes from `src/lib/amendment-meta.ts` (shared with the MCP).

## MCP server (`mcp/`)

Self-contained npm package (own `package.json`, tsc → `dist/`) exposing the
corpus to Claude clients; the site build never sees it. Full reference:
[`mcp/README.md`](../mcp/README.md).

- `mcp/src/data.ts` reads `data/generated/*.json` +
  `public/{search-docs,amendment-search-docs}.json` +
  `data/questionnaire/assessment-v1.json` **once at startup** — after
  `update-source`, amendment changes **or a questionnaire edit**, restart the
  service. (`AIACT_QUESTIONNAIRE` overrides the questionnaire path, since it
  sits outside `AIACT_DATA_DIR`.)
- The assessment layer is MCP-exposed through `get_obligations`, which calls
  the pure `obligationCatalog()` in `src/lib/assessment/engine.ts` (cross-
  compiled like `search-core.ts`). The catalog is answer-independent and
  carries no compliance status — `evaluate()` stays the only thing that
  computes status, and it needs answers the server does not have.
- All corpus tools carry `annotations: {readOnlyHint, openWorldHint: false}`:
  they read a static corpus, and claude.ai's per-tool controls key off those
  hints.
- The one write surface is the assessment pair `get_assessment` /
  `put_assessment` (`mcp/src/assessment-state.ts`, roadmap 4.1). It is **opt-in
  per deployment**: without `AIACT_ASSESSMENT_STATE` neither tool is
  registered, which is why the public server stays a read server. State is a
  single gitignored JSON file outside the corpus — the committed `data/` tree
  is never written, and `verify-mcp.ts` fingerprints `data/` + `public/` around
  the write tests to prove it. Writes need `MCP_TOKEN` and are validated
  question-by-question against `data/questionnaire/assessment-v1.json`; merge
  is by system id and omission never deletes. Auth, blob shape (the
  legal-workbench drop-zone format) and conflict semantics: `mcp/README.md`,
  "Assessment state (authed)".
- The server's one **resource** is the MCP Apps panel (`mcp/src/panel.ts`,
  roadmap 4.2): `ui://ai-act-explorer-nl/assessment/vragenlijst`, a single
  self-contained HTML document rendering the questionnaire as a fillable,
  self-scoring form, associated to `get_questionnaire` via
  `_meta.ui.resourceUri`. Unlike the tool pair above it is registered
  **unconditionally** — it only renders data this server already publishes —
  and just its load/save controls are capability-gated (`data-state` /
  `data-write` on `<body>`, from the same two env vars, read per read), so an
  unauthed session gets the panel without write-back and without an error.
  Because it scores in a sandboxed iframe that cannot import the CommonJS
  build, `panel.ts` carries a **hand-written mirror** of the forward pass in
  `src/lib/assessment/engine.ts`, bracketed by `__PANEL_ENGINE__` sentinels.
  `scripts/verify-mcp.ts` owns the parity gate: it slices the mirror out of the
  *served* HTML, evals it, and asserts it agrees with the real engine on every
  fixture in `scripts/lib/assessment-fixtures.ts` (extracted from
  `verify-assessment.ts` so both gates share them). **An engine change without
  a matching mirror change is meant to fail `npm run verify:mcp`** — fix the
  mirror rather than loosening the gate. Round-trip and degradation matrix:
  `mcp/README.md`, "Resource — the assessment panel".
- `get_context_pack` is the one tool whose result size is caller-controlled, so
  it is the one with guardrails: `DEFAULT_PACK_LIMITS` (`maxArticles` /
  `maxChars` / `warnChars`) in `mcp/src/core/size.ts`, with
  `packLimitsFromEnv()` applied once at module scope in `mcp/src/server.ts`.
  Over either limit it
  **refuses** (naming the request size, the ceiling and the per-article cost)
  instead of truncating — a truncated pack still looks complete. Measured
  sizes, the two client ceilings behind the numbers and the
  `MCP_MAX_RESULT_CHARS` override live in `mcp/README.md`, "Result-size
  guardrails"; keep the figures there, not here.
- Search relevance is shared with the site via `src/lib/search-core.ts`
  (stopwords, normalization, MiniSearch options); `src/lib/search.ts` is the
  thin browser wrapper around it.
- One `createServer()` factory, two transports: `stdio.ts` (Claude
  Desktop/Code) and `http.ts` (stateless streamable HTTP on `127.0.0.1:3106`,
  behind nginx at `https://aia.mrfrank.dev`). Both are six-line entrypoints over
  `core/transport.ts`; the compiled paths `mcp/dist/mcp/src/{stdio,http}.js` are
  hardcoded in `verify-mcp.ts` and in the systemd unit, so they must not move.
- `mcp/src/core/` is the corpus-agnostic half (roadmap 4.3), mirroring
  `dora-explorer-nl/mcp/src/core/` file for file: tool registration and
  annotations, the pack-size policy and its Dutch refusal templates, the
  markdown renderers, the Dutch formatting helpers, the JSON loader and both
  transports. `registerTool()` applies the annotations, so no call site spells
  them out (only `put_assessment` overrides them). Nothing in `core/` may import
  `src/lib`, `./data.js` or anything else outside itself —
  `mcp/scripts/check-core-isolation.mjs` runs as the first half of
  `npm --prefix mcp run build` and therefore of `npm run verify:mcp`. The split
  and the six places this corpus did not fit the shared core: `mcp/README.md`,
  "Code layout (core/ vs corpus)".

## Runbook — which script, when

| Command / script | When | Gates / output |
|---|---|---|
| `npm run parse` | after changing parser code or source HTML | regenerates `data/generated/*` + `public/*-search-docs.json` (commit together with the change — golden rule 4) |
| `npm run verify` | automatically before every build; run standalone while iterating | hard assertions; update pins only deliberately (golden rule 3) |
| `npm run build` | before deploying | parse → verify → static export in `out/` |
| `npm run verify:mcp` | after changing `mcp/src/*` or regenerating data | rebuilds `mcp/dist`, then drives the stdio server: tool inventory pin, one call per tool, deep-link + size assertions (`scripts/verify-mcp.ts`). Standalone — needs `mcp/node_modules`, so it is not in the build chain |
| `scripts/deploy-site.sh` | publish the site | build + rsync `out/` → `/var/www/aia.mrfrank.dev` + nginx reload (needs sudo) |
| MCP restart (systemd unit / tmux, see `mcp/README.md`) | after any data regeneration reaches `main` | picks up new JSON (loaded at startup only) |
| `.claude/skills/update-source` | new consolidated version / amending act on EUR-Lex | fetch → corpus.json → re-parse → change-layer audit → assertion updates |
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
