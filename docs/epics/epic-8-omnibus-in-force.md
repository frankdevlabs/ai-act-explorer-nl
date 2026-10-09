# Epic 8 — Digitale omnibus in werking (AI Act as in force)

**Status**: implemented (Oct 2026). Base corpus = consolidation 02024R1689-20260727; change layer derived from EUR-Lex; PE-CONS 30/26 transcription retired. MCP wording follows once the live host's unpushed MCP tools are on `main` (see Order).
**Goal**: the site and MCP serve the AI Act as it applies since the digital omnibus on AI entered into force — Verordening (EU) 2026/1744 van 8 juli 2026, PB L, 2026/1744, 24.7.2026, **in werking 27.7.2026** (its art. 4: third day after publication) — and keep showing what the omnibus changed, as history instead of a pending overlay. Closes auto-issue #1.

## Sources (`data/source/corpus.json`)

| key | file | notes |
|---|---|---|
| base | `consolidated/02024R1689-20260727.html` | NL consolidation 001.001: 119 articles (`art_4a`, `art_60a`, `art_75a`–`75d`), 14 annexes, ▼M1 69 blocks (REPLACED 40, INSERTED 25, DELETED 4), corrigenda C1/C2 |
| previous | `consolidated/02024R1689-20240712.html` | 000.004, already incl. C1+C2 → 2024→2026 differences are M1 only (plus re-typesetting, below) |
| recitals | `aiact_nl.html` | unchanged — the omnibus amends no recital |
| amending | `amending/32026R1744.html` | OJ L-serie HTML: header + Article 1 (43 instructions / 72 leaves) + art. 4 entry into force |

Fetched 2026-10-09 with headless Chromium (`~/law-tracker` no longer exists on the VPS; snippet in the `update-source` skill). Proof of method: re-fetching the 2024 file differed from the committed copy only in EUR-Lex's tracking `<script>`.

## Key decisions

- **Current law as base** (user decision): every page, search hit, MCP answer and assessment link shows the text in force; the omnibus is a historical change layer (diff vs the pre-27.7.2026 text). Considered and rejected: relabelling the old overlay and flipping its default view — search, MCP and crossrefs would still have served 2024 wording.
- **Deterministic change layer** instead of the transcription: WHAT changed = diff of two consolidations; WHICH instruction = the act's OJ Article 1, targets read by a grammar that throws on unknown wording. Instruction ids follow the OJ (`32` inserts 75 bis–quinquies; `37a` replaces leden 2 en 3 — the transcription had split these into 32a–d / 37a1–a2).
- **Additive identity**: `Article.slug`/`displayNumber` next to the integer `number` (4 for "4 bis"); bis-leden `{number: null, displayNumber: "1 bis", anchor: "lid-1bis"}` (the overlay's convention) — all URLs and anchors stay stable (`/artikel/4bis`, `#lid-1bis`, `?diff=1#w-…`).
- **Struck provisions**: EUR-Lex's "▼M1 —————" placeholder kept verbatim and flagged `repealed` (art. 10 lid 5 keeps its anchor; excluded from search; the clean view says "Geschrapt bij Vo. (EU) 2026/1744 · toon geschrapte tekst").
- **Typographic baseline**: 001.001 re-typeset the act (every opening quote “ → „; footnotes after art. 40's new one renumbered). The previous version is compared in the current typography, so the diff shows substance only.
- **Status wording is data**: act number, OJ reference, adoption/publication/in-force dates are parsed from the act; `src/lib/amendment-meta.ts` phrases them (site; MCP next). "In werking ≠ van toepassing — zie artikel 113."

## One-time migration audit (scratchpad, 2026-10-09)

The OJ-derived layer was shadow-run against the PE-CONS 30/26 transcription and the then-current overlay before the swap:

- **Changed-paragraph set identical** for all 36 amended articles and bijlagen I/VIII; same 6 new articles + bijlage XIV; same title changes (art. 75, 77); bijlage XIV's six tables identical cell for cell (12/4/2/6/2/2 rows × 2).
- **Instructions**: 72 OJ leaves ↔ 76 transcription entries; 63 targets identical, 13 differ only in modelling (transcription anchored inserts on the preceding lid; annex point deletions modelled as whole-content replaces; "alinea toegevoegd" modelled as replace).
- **Text**: 112/118 transcribed text chunks identical to EUR-Lex; the other 6 are the 3 placeholders the OJ filled (art. 43 lid 3 "28 januari 2028"; art. 97 lid 2 and art. 113 punt d) "27 juli 2026") and 3 consolidation punctuation fixes (art. 96 lid 1 f) "." → ";"; bijlage VIII B "…;" → "."; EUR-Lex artifact "aangemerkt;." in art. 113 c), kept verbatim).

## Verify (gates)

`verify-amendments.ts` re-derives the layer and requires: (a) byte-exact diff invariant; (b) ▼M1 markers ⇔ changed set (allowlist: art. 4 title, restated by the whole-article replacement; deleted-without-placeholder only inside whole-replaced articles); (c) all 84 quoted instruction blocks contained in the new target text and absent from the old; (d) attribution both ways; (e) every 2024 paragraph anchor still exists (allowlist: art. 4 `inhoud`, now leden 1–3); act metadata (in force = publication + 3 days = consolidation date; 43/72 instructions); pinned target sets, XIV tables, 207 segment refs, 46 `wijz-` search docs (instruction wording only). `verify-data`: 119/14, FLAT (−4, +75 ter), footnotes (+40), 885 search docs, 697 refs (audited: unchanged articles keep identical refs). `verify-assessment` gate (j): `?diff=1` links only on changed articles, `#w-` anchors only on changed paragraphs. `verify-search`: `digitale omnibus` / `2026/1744` → `wijz-`, `artikel 4 bis` → `art-4bis-`, `artikel 5 lid 1 bis` → `art-5-lid-1bis`.

Side fix: `p.modref` markers used to be parsed as text — art. 73 lid 9 and 11 showed stray "▼C2"/"▼B".

## Order (as executed)

1. Pure refactor: `parseConsolidated` in `scripts/lib/consolidated.ts`, versioned sources + manifest (output byte-identical).
2. Parser/model: bis-articles/leden, tables, placeholders, ▼ markers + provenance (no-op on 2024 except the art. 73 fix); consumers keyed on slug (all 327 pages text-identical).
3. Crossref grammar: "lid 1 bis", "punt b bis)", "leden 1 bis en lid 1 ter" (fixed mislinks to `#lid-1`).
4. Sources + libraries (`oj-instructions.ts`, `change-layer.ts`), shadow audit above.
5. Swap: base → 20260727; producer + verify rewritten; overlay code removed; transcription and PDF deleted.
6. UI wording (explainer pages, banners, footer, /wijzigingen).
7. MCP wording + `get_amendments({annex})` — after the live host pushes its unpushed tools (`get_context_pack`, `get_obligations`, `get_questionnaire`, `get_recital_map`).
8. Assessment editorial pass (refs to current-text anchors; art. 10 lid 5 → art. 4 bis; timeline labels); adversarial review against the in-force text.
9. Docs/skills (this file, AGENTS, README, ARCHITECTURE, PORTING, update-source, verify-app; `transcribe-amendments` retired).
10. verify-app, PR, deploy on the live host, live checks, close #1.

## Follow-ups outside this repo

- **legal-workbench**: `skills/legal-memo/SKILL.md` §4 and `profile/PRACTICE.md` keyed on the MCP strings "Nog niet in werking" / "PE-CONS 30/26" — mirror the new wording (corpus = law in force; caveat "in werking ≠ van toepassing").
- **explorer-cms**: the recital editor keys articles on `number` (`String(a.number)`), so 4 bis would collide with 4 — key on `slug`/`displayNumber`.

## Risks / notes

- Application dates are staggered (art. 113: art. 5 new prohibitions 2.12.2026; high-risk 2.12.2027 / 2.8.2028; arts. 102–110 27.7.2026; art. 111 lid 2 overheid 2.8.2030, lid 4 art. 50(2) legacy 2.12.2026) — the site shows the text in force, not a per-provision applicability flag.
- A future amending act (▼M2) follows the `update-source` skill: previous ← base, new base, new `amending`; the instruction grammar may need extending (it throws, never guesses).
