# Epic 5 — Recital↔article mapping (curated editorial layer)

**Status**: infrastructure implemented (steps 1–6 of Order, 2026-07-03): source stub + build/verify scripts + accessors + UI + MCP + skill/AGENTS rule 2b all live; recitals 40/41/140 seeded from their explicit refs (`reviewed: false`). Remaining: step 7 — curation in batches via `.claude/skills/curate-recital-map/`, then flip `complete: true` + pin counts in `verify-recital-map.ts`.
**Goal**: every article page shows its relevant recitals; every recital page shows the articles it motivates. Only 3/180 recitals cite articles explicitly, so this is a **curated editorial layer**, not crossref detection.

## Source data

`data/source/recital-article-map.json` — editorial metadata, explicitly NOT legal text:

```json
{
  "meta": { "version": 1, "complete": false },
  "recitals": {
    "1":  { "articles": ["1"], "reviewed": true },
    "12": { "articles": [], "reviewed": true, "note": "algemene context, geen operatief artikel" },
    "26": { "articles": ["5", "6"], "reviewed": false }
  }
}
```

- Keyed object (diffable, no array-index churn); keys must be exactly `"1"`..`"180"`.
- Article values are strings validated against `articles.json` numbers ∪ new-article slugs from `amendments.json` (`"4bis"` is legal).
- `articles: [] + reviewed: true` = "reviewed, none relevant" — distinct from `reviewed: false` (drafted, not yet human-reviewed).
- Optional `note` (Dutch, editorial aid; not rendered in v1).
- Reuse the `meta.complete` **two-regime pattern** from `verify-amendments.ts`: structural checks always; once `complete: true`, pin exact counts (total pairs, reviewedCount === 180).

## Build + verify

- New `scripts/build-recital-map.ts`, appended to `npm run parse` **after** `parse-amendments.ts` (needs new-article slugs for validation) → `data/generated/recital-map.json` `{ byRecital, byArticle, meta }`. Throw on: missing/extra recital keys, unknown article slug, duplicates within an entry.
- New `scripts/verify-recital-map.ts` in `npm run verify`: inverse-consistency (byArticle ↔ byRecital), independent target recheck from the JSON, pinned counts + 2–3 spot checks once complete (verify-data style).

## Curation procedure

- New `.claude/skills/curate-recital-map/SKILL.md` (sibling of `transcribe-amendments`): batches of ~20 recitals/session; read recital text from `data/generated/recitals.json`; seed candidates from the explicit refs already annotated (recitals 40, 41, 140); otherwise thematic mapping (identify the operative articles the recital motivates, via chapter/keyword); write entries `reviewed: false`; human review flips `reviewed: true`; commit source + generated together.
- **AGENTS.md rule 2b** (new): editorial-metadata layer — `data/source/recital-article-map.json` is hand/LLM-curated *interpretive* metadata, clearly not legal text; must never alter the rendering of legal text; changes follow the skill; gated by `verify-recital-map.ts`.

## UI

- **Article pages** (`src/app/artikel/[nummer]/page.tsx`): new `src/components/content/RelatedRecitals.tsx` inserted between the article body block and `<PrevNextNav/>`. `"use client"` collapsible via `@radix-ui/react-collapsible`, trigger styled like `SidebarToc` (chevron rotate transition), default **collapsed**, label `Relevante overwegingen (N)`. Children are server-rendered (client component receiving RSC children — same pattern as `AmendedArticleView`'s clean/diff props): per recital a `Link` "Overweging N" + ~100-char snippet (export the module-private `clip()` from `data.ts`). Render nothing when empty. Works for `4bis`-style pages (byArticle keyed by slug).
- **Recital pages** (`src/app/overweging/[nummer]/page.tsx`): after the paragraphs, before PrevNextNav, a chips row "Relevante artikelen": pill `Link`s (`rounded-full border border-line px-2.5 py-0.5 text-sm hover:border-accent`) labeled `Art. N`, `title` = article title.
- Annexes: **skip v1** (schema forward-compatible: later allow `"bijlage:iii"` values).

## Data accessors + MCP

- `src/lib/data.ts`: static import of `recital-map.json`; `getRecitalsForArticle(slug): {number, snippet}[]`, `getArticlesForRecital(n): {slug, label, title}[]`.
- MCP: load the map in `mcp/src/data.ts`; `get_article` output appends "**Relevante overwegingen:** 12, 47 …" and `get_recital` appends "**Relevante artikelen:** Artikel 5 — {BASE_URL}/artikel/5 …". Restart service after data lands.
- Search/SEO: no corpus change (mapping adds no indexable text) — out of scope.

## Files

New: `data/source/recital-article-map.json`, `scripts/build-recital-map.ts`, `scripts/verify-recital-map.ts`, `src/components/content/RelatedRecitals.tsx`, `.claude/skills/curate-recital-map/SKILL.md`, generated `data/generated/recital-map.json`.
Modified: `package.json` (parse/verify chains), `src/lib/data.ts`, `src/app/artikel/[nummer]/page.tsx`, `src/app/overweging/[nummer]/page.tsx`, `AGENTS.md` (rule 2b), `mcp/src/data.ts`, `mcp/src/server.ts`.

## Order

1. Source stub (all 180 keys, `reviewed: false`, `articles: []`).
2. build-recital-map + verify-recital-map wired into package.json.
3. `data.ts` accessors.
4. UI (article panel, recital chips).
5. MCP.
6. Skill + AGENTS.md rule 2b.
7. Curation in batches → flip `complete: true` + pin counts.

## Verification

- Build green with the stub (structural regime); after curation, pinned counts.
- `verify-app`: curl `/artikel/5` for "Relevante overwegingen"; Playwright expand/collapse + click-through to `/overweging/…` and back via chips.

## Risks

- Mapping quality/subjectivity — reviewed flag + skill procedure + spot pins.
- Curation scale (180 recitals) — two-regime verify keeps the site shippable mid-curation.
- Slug churn at the OJ swap (epic 2) — slugs are documented stable; low.
