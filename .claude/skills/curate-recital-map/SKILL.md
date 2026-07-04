---
name: curate-recital-map
description: Curate the recital↔article map (data/source/recital-article-map.json) in batches of ~20 recitals, mapping each recital of Regulation 2024/1689 to the operative articles it motivates. Use when drafting new mapping entries, reviewing drafted entries, or finishing the map (flipping meta.complete).
---

# Curate recital↔article map

Fills `data/source/recital-article-map.json`: for each of the 180 recitals,
the base articles (or omnibus new-article slugs like `"4bis"`) that the
recital motivates. This is the **editorial-metadata layer** of AGENTS.md rule
2b — interpretive, hand/LLM-curated, explicitly NOT legal text. It never
alters the rendering of legal text; it only powers "Relevante overwegingen"
on article pages, "Relevante artikelen" chips on recital pages, and the MCP
output.

Only 3 recitals cite articles explicitly (40, 41, 140 — their refs are
already annotated in `data/generated/recitals.json`). Everything else is
thematic mapping: identify which operative articles the recital motivates.

## Entry schema

```json
"26": { "articles": ["5", "6"], "reviewed": false },
"12": { "articles": [], "reviewed": true, "note": "algemene context, geen operatief artikel" }
```

- Keys exactly `"1"`..`"180"` (all pre-created; never add or remove keys).
- `articles`: strings — base article numbers (`"5"`) or omnibus slugs
  (`"4bis"`); validated by the build against `articles.json` ∪
  `amendments.json` new-article slugs. No duplicates.
- `articles: [] + reviewed: true` = "reviewed, none relevant" — distinct from
  `reviewed: false` (drafted, not yet human-reviewed).
- `note`: optional Dutch editorial aid (not rendered in v1). Use it whenever
  the mapping is non-obvious or empty-on-purpose.

## Procedure (one batch = ~20 recitals)

1. **Pick the batch**: next contiguous range with `reviewed: false` and empty
   articles (check `node -e` over the source file, or read it).
2. **Read the recital text** from `data/generated/recitals.json` (never from
   memory). Read the whole batch in one go.
3. **Map thematically**: for each recital, identify the operative articles it
   motivates. Aids:
   - explicit refs already in the recital's `refs` (recitals 40, 41, 140);
   - chapter/keyword proximity: recitals broadly follow the regulation's
     structure (early recitals → subject/scope/definitions Art. 1–4;
     prohibited practices ~Art. 5; high-risk ~Art. 6–27; transparency
     ~Art. 50; GPAI ~Art. 51–56; governance/enforcement later);
   - `data/generated/toc.json` for the chapter→article inventory.
   - Prefer precision over recall: 1–4 articles per recital is typical.
     Purely contextual recitals get `articles: []` + a `note`.
4. **Write entries** with `reviewed: false` (drafted). Never flip `reviewed`
   yourself — that is the human review step.
5. **Pipeline check**: `npm run parse:recital-map && npm run verify:recital-map`.
   Fix unknown slugs/duplicates until green.
6. **Commit** source + generated together:
   `data/source/recital-article-map.json` + `data/generated/recital-map.json`,
   message like `curate recital map: recitals 21-40 drafted`.

## Adversarial review pass (before human review)

After a batch is drafted, fan out to *different* agents than the drafters,
stance = refute: independently re-derive each mapping from the recital text
plus `toc.json`, compare against the draft, and report only disagreements,
with reasoning. Clean batches go to the human labelled review-clean;
disagreements go with both mappings side by side.

Seed caution: don't trust annotated `refs` blindly — a recital ref that
resolves to another instrument's article numbers is a crossref parser bug;
report it, don't map it (this caught the recital 140 mislink).

## Human review

The user reviews drafted entries (adversarially cleared first, see above)
and flips `reviewed: true` (possibly editing articles). Batches may mix
drafting and review.

## Finishing

When all 180 entries are `reviewed: true`:

1. Set `meta.complete: true` in the source file.
2. Pin `EXPECTED` in `scripts/verify-recital-map.ts`: exact `pairCount` plus
   2–3 spot-check mappings (e.g. recital 40 → its explicitly cited articles).
3. `npm run verify:recital-map` must pass in the strict regime; commit.
