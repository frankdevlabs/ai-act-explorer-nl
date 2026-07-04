# Porting this explorer to a different law

Checklist for reusing this codebase for another EU regulation/directive (or
another language version). The architecture is deliberately data-driven —
the pipeline (source HTML → parser → verified JSON → static site → MCP) ports
as-is; what changes is grammar, selectors, counts and identifiers. Work
through the layers in order; each layer's verify assertions tell you when it's
done. Failure modes this repo actually hit are catalogued inline in the layer
they belong to; repo-internal oddities live in ARCHITECTURE.md "Known quirks".

## What ports unchanged

- Data model (`src/lib/types.ts`): ContentNode/Article/Recital/Annex/RefSpan
  are regulation-neutral.
- Rendering chain: `ContentNodes` → `LinkedText` → `RefLink`, article/recital/
  annex page templates, search palette, theme, layout.
- Verify *architecture*: the assertion classes (counts, FLAT list, spot
  checks, ref resolution, diff invariant) — only their values are specific.
- Build chain (`parse → verify → next build`), static export, deploy script
  pattern.
- MCP server skeleton (`mcp/`): tools, transports, search-core sharing.
- The WAF fetch helper (`~/law-tracker/lib/fetch_blocked_doc.py`) works for
  any EUR-Lex/consilium document.

## Layer 1 — Source acquisition

- Find the CELEX ids: consolidated version (articles/annexes/TOC) **and**
  original OJ publication (recitals — consolidated versions omit the
  preamble). Both needed; see "Why two source files" in ARCHITECTURE.md.
- Fetch via `fetch_blocked_doc.py` (EUR-Lex sits behind an AWS WAF).
- Replace `data/source/*.html`; record CELEX ids + fetch receipts in README.

### If there is no clean consolidated version

- New acts (or some directives) may lack a consolidated CELEX. Fallback:
  parse the original OJ publication for *everything* — the OJ dialect already
  covers recitals here; the removed OJ article parser is in git history and
  can be resurrected.
- Corrigenda then have no consolidated home: hand-apply them via the
  amendment-layer machinery (Layer 6: apply-then-diff, page-image
  cross-check) or ship the uncorrected text with a visible note.
- Engineer the eventual consolidated-version swap as a producer-only change:
  only the stage that writes `data/generated/*` changes; verify/UI/MCP stay
  (this is the planned PE-CONS → CELEX swap, AGENTS.md rule 2).
- If the only source is a PDF with a lossy text layer, budget hand
  transcription under a rule-2-style carve-out. What made it safe here:
  320 dpi page-image cross-check, byte-identical diff invariant, keeping
  official-text defects verbatim, whole-unit replace when anchors are
  ambiguous. Procedure: `.claude/skills/transcribe-amendments/`.

## Layer 2 — Parser (`scripts/parse-aiact.ts`)

- The two EUR-Lex HTML dialects (see the dialect table in ARCHITECTURE.md)
  are *mostly* stable across regulations, but spot-check every selector:
  `div.eli-subdivision#art_N`, `span.no-parag`, `div.grid-container.grid-list`,
  `p.title-*`, `#rct_N`, `#anx_ROMAN`. Older acts and directives differ.
- Directives say "Artikel"/"Lid" the same way in Dutch, but numbering depth
  and annex structure vary — expect to touch the article walker only if the
  lid-marker convention differs.
- Amendment-style articles (quoting other acts) need the same quoted-marker
  exception — identify which articles those are for the new law.

## Layer 3 — Verify values (`scripts/verify-data.ts`)

Every pinned value is law-specific and must be rebuilt:

- Article/recital/annex/chapter counts; section distribution.
- The FLAT list (articles without numbered lids).
- Footnote counts; corrigendum-specific checks.
- Spot-check phrases (pick 5–10 exact phrases spread across the corpus).
- The pinned ref count (Layer 4).

Method: parse first, eyeball the corpus (`data/generated/*.json`), then write
the assertions from what you verified by hand — not from the parser output
blindly.

**Expect the pins to drift.** Exact pins — ref counts especially — get
re-pinned repeatedly early in a port as the grammar matures; that is the
design, not a defect (this repo: 566→563→561 base, 462→460 amendment, every
re-pin catching real false positives). Each re-pin follows the diff-audit
loop in ARCHITECTURE.md "Verify script" and leaves a history comment next to
the assertion. The `verify-app` skill's expectations (page counts, check
list) are part of the same pinned surface — update them in the feature
commit.

## Layer 4 — Cross-reference grammar (`src/lib/crossrefs.ts`)

Same-language (Dutch) port: mostly reusable, but update:

- `SELF_INSTRUMENT`: the self-form `Verordening (EU) 2024/1689` → the new
  act's citation form (and `verordening` → `richtlijn` for a directive —
  also in the `deze verordening` self-form).
- The `linkBareRefs: false` article set (which articles quote other acts).
- `hoofdstuk` → homepage anchor mapping if the new TOC page differs.

Cross-language port: the keyword sets, connectives (`tot en met`, `en`, `of`),
ordinals, sub-ref markers (`lid`, `punt`, `alinea`) and instrument nouns in
the exclusion regexes are all Dutch — budget a full grammar rewrite plus a
new exclusion corpus review. Keep the Cursor/number-list machinery.

Two traps that survive any language:

- **Conjunction distribution**: an instrument qualifier after the last
  conjunct ("artikel 5 en artikel 9 … van Verordening (EU) 2016/679")
  applies to *all* conjuncts — a grammar that excludes only the last one
  self-links the earlier ones. Cost this repo a re-pin; test enumerations
  followed by "van/bij <instrument>" explicitly (see `allowedHere()` in
  `crossrefs.ts`).
- Non-instrument citation forms need their own exclusions ("artikel 6 bis
  van Protocol nr. 21", treaty articles). Build the exclusion corpus from a
  real negative-sweep over the parsed refs, not from imagination.

## Layer 5 — Identifiers, routes, UI strings

- Regulation number and CELEX id appear in: README, AGENTS.md, page metadata,
  `crossrefs.ts` self-form, MCP descriptions. Grep for `2024/1689` and
  `02024R1689`.
- Routes (`/artikel/`, `/overweging/`, `/bijlage/`) and all UI labels are
  Dutch; a different language version needs both renamed routes (or not —
  keeping Dutch routes is a choice) and translated UI strings (no i18n
  framework; strings live in the components).
- Search: `DUTCH_STOPWORDS` + NFD normalization in `src/lib/search-core.ts`.

## Layer 6 — Amendment layer (optional)

Only if the new law has pending amendments to track. The schema
(`Amendment`/`ParagraphDiff`) and the apply-then-diff engine in
`parse-amendments.ts` are reusable; the transcription
(`data/source/amendments/*.json`) is per-amending-act, following
`.claude/skills/transcribe-amendments/`. If a consolidated future version is
available on EUR-Lex, prefer corpus-vs-corpus diffing over hand transcription
(see the OJ swap plan in `docs/epics/epic-2-omnibus-track-changes.md`).

## Layer 7 — Editorial-metadata layer (optional)

Curated *interpretive* metadata over the corpus — here the recital↔article
map; generalizes to article summaries, topic tags, an obligations index.
Hard constraint: it must never alter the rendering of legal text (AGENTS.md
rule 2b).

- Portable schema pattern: all keys pre-created; `reviewed: false → true`
  lifecycle; `articles: [] + reviewed: true` ("reviewed, none relevant") is
  distinct from `reviewed: false` (drafted); optional `note`. Values are
  validated against the generated corpus — unknown slugs fail the build.
- Two-regime verify keyed on `meta.complete` (third use of the pattern from
  `verify-amendments.ts`) keeps the site shippable mid-curation.
- Curation procedure that worked: seed from explicit refs → fan out to N
  parallel drafter agents (~20 items each, thematic anchors from `toc.json`)
  → merge centrally → **second adversarial fan-out with different agents in
  refute stance** → human flips `reviewed`. Full procedure:
  `.claude/skills/curate-recital-map/`.
- Side effect: editorial curation doubles as parser QA — a mislinked seed
  (recital refs resolving to GDPR article numbers) exposed a crossref
  grammar bug here.

## Layer 8 — MCP + deploy

- `mcp/`: update tool names/descriptions (`search_ai_act` → law-specific),
  `BASE_URL`, port (each site instance needs its own), systemd unit name,
  nginx server block.
- `scripts/deploy-site.sh`: new docroot/domain.

## Effort calibration (from this repo's history)

Worked numbers: the whole build — parser, verify, site, MCP, amendment
layer, recital map — took 6 epics / 26 commits / ~3 elapsed days for a
113-article, 180-recital, 13-annex regulation.

- Same-language, different law: parser selector tuning + verify rebuild +
  identifier sweep dominate. Days, not weeks, if the EUR-Lex markup matches.
- Cross-language: add the full crossrefs grammar rewrite, stopwords, UI
  translation. The grammar is the long pole — it needs a corpus-driven
  exclusion review like the one in `docs/epics/epic-1-internal-linking.md`.
- Amendment tracking: the transcription is the long pole (76 instructions
  hand-transcribed with page-image cross-check here — the single largest
  manual block; budget it explicitly); everything downstream is generic.
- Editorial layer: 180 recitals = 9 parallel drafter agents + an adversarial
  review fan-out; drafting is cheap, the review pass roughly doubles it.
