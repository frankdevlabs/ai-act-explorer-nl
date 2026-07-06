# Epic 7 — AI Act-assessment + AI-register

Interactive self-assessment (18-module intake questionnaire) that classifies an
AI application under Regulation 2024/1689 and produces a ready-made row for an
internal AI register. Fully client-side: answers live in localStorage
(`aiact-assessments`), nothing leaves the browser.

## Pieces

| Piece | Where |
|---|---|
| Questionnaire content (curated, editorial) | `data/questionnaire/assessment-v1.json` |
| Data model | `src/lib/assessment/types.ts` |
| Pure engine (flags → risk class, obligations, timeline, register row) | `src/lib/assessment/engine.ts` |
| localStorage store (versioned, `useSyncExternalStore`, same pattern as tabs) | `src/lib/assessment/store.ts` |
| Verify gate (refs, routing order, worked-example fixtures) | `scripts/verify-assessment.ts` (in `npm run verify`) |
| Pages | `/assessment`, `/assessment/vragenlijst?sys=`, `/assessment/resultaat?sys=`, `/register` |
| Components | `src/components/assessment/*` |

## Design decisions

- **Content is data, logic is code.** The questionnaire JSON carries question
  text, help, deep-link refs, answer types, `showIf` conditions and
  flag-setting `effects`; the engine implements evaluation as one forward pass
  (conditions may only reference flags/answers set earlier — asserted by
  verify). Derived flag `hoogrisico` is recomputed between modules
  (art. 6: bijlage I route, bijlage III route minus the art. 6(3) escape,
  profilering backstop).
- **Hidden answers don't leak.** Effects of questions that are currently
  invisible are ignored, so abandoned branches can't distort the outcome.
- **Omnibus-aware, single flow.** The questionnaire follows the current act
  and annotates questions/modules with dated PE-CONS 30/26 badges (new art. 5
  prohibitions per 2026-12-02; bijlage III obligations per 2027-12-02;
  bijlage I per 2028-08-02; art. 111(4) marking deadline). The outcome page
  renders a per-system compliance timeline with `omnibus` markers.
- **Register export.** `registerColumns` in the JSON defines the template
  (one column ↔ one question answer `q:` or derived value `d:`). Outcome and
  register pages copy a row as TSV (pastes straight into a spreadsheet);
  `/register` documents every column and offers empty CSV templates (with and
  without the finance-only columns). Finance-only modules/columns (DORA, Wft)
  activate via intake question 1.12.
- **Ref previews without corpus in the client bundle.** Server pages call
  `buildRefPreviews()` (wraps `getPreview`) and pass a plain map to the client
  wizard/outcome, so hover cards work while `articles.json` stays server-side.

## Verification

- `npm run verify` includes `verify-assessment.ts`: ref-anchor integrity
  against the generated corpus, condition/flag forward-ordering, register
  wiring, and behaviour fixtures (VB-001 kredietscoring → hoog risico +
  FRIA + escape blocked by profilering; VB-002 GPAI-assistent →
  transparantierisico; geen-AI routing; art. 5 STOP).
- Browser: `.claude/skills/verify-app` step 3 covers the base app; the
  assessment flow has its own Playwright script pattern (create → answer →
  STOP banner → seeded VB-001 outcome → clipboard TSV → CSV/JSON round trip →
  geen-AI routing → 360px overflow), see git history of this epic.

## Legal-content note

Question texts paraphrase obligations (like any compliance questionnaire) and
are **editorial**, not corpus text — golden rule 2 does not apply, but every
question deep-links its legal basis so users can check the real text. When the
omnibus is published in the OJ and the amendment layer is re-parsed from
CELEX, re-check the dated badges and the timeline entries in
`engine.ts`/`assessment-v1.json` (grep for `2027-12-02`, `2028-08-02`,
`2026-12-02`).
