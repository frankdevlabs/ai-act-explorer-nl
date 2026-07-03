# Epic 1 — Internal cross-references

**Status**: done (implemented July 2026; 566 refs annotated at parse time).
**Goal**: plain-text references in the corpus ("artikel 6, lid 1", "bijlage III") become internal links with hover previews, on article, recital and annex pages.

## Design decisions

**Parse-time detection, stored as char-offset annotations.** Keep `text` byte-identical; add optional `refs`:

```ts
interface RefSpan { start: number; end: number; href: string }
type ContentNode =
  | { type: "text"; text: string; refs?: RefSpan[] }
  | { type: "heading"; text: string }
  | { type: "list"; items: ListItem[] };
```

Rationale: zero ripple to search-docs/verify flattening (`n.text` untouched, `search-docs.json` byte-identical); the build gate can assert link counts and target validity — a render-time regex would ship regressions silently; annotations reusable by epic 2 (diff views) and epic 3 (MCP output).

**Recital schema change** (only breaking JSON change): `Recital.paragraphs: string[]` → `{ text: string; refs?: RefSpan[] }[]`. Touches parser recital extraction, search-doc builder (`r.paragraphs.join(" ")` → `.map(p => p.text).join(" ")`), verify, and `src/app/overweging/[nummer]/page.tsx`. Same commit as consumers (golden rule 4).

**Skip** article/annex titles (annex III title contains "artikel 6, lid 2" but titles are plain `<h1>` strings — future option, not now).

## Detection module — `src/lib/crossrefs.ts`

Pure `findRefs(text: string, ctx: { selfType: "artikel"|"overweging"|"bijlage"; selfRef: string; linkBareRefs?: boolean }): RefSpan[]`. Single scanning regex + lookahead validation, not one mega-regex.

Grammar:
- `artikel N` / `artikelen N(, N)* (en|of) N` / `artikelen N tot en met M` — enumerations and ranges emit **one span per number**.
- Sub-ref tail: `, lid N` / `, leden N en M` / `, leden N tot en met M`, then optional `, punt x)` / `, punten a) en b)`; `, eerste/tweede alinea` parsed but not anchored (alinea anchors don't exist).
- `bijlage ROMAN(, punt N)` / `bijlagen ...`; `hoofdstuk ROMAN(, afdeling N)?`; `overweging N` (rare).
- Anchor mapping reuses existing convention: `artikel 6, lid 2, punt c)` → `/artikel/6#lid-2-c`; `bijlage III, punt 2` → `/bijlage/iii#punt-2` **only if** anchor exists in parsed annex **and is unique on the page** (annexes VII/VIII/X repeat `punt-*` markers per afdeling; art 43 duplicates `lid-1-a`), else drop fragment; `hoofdstuk III` → `/#hoofdstuk-iii` (homepage ids confirmed on `src/app/page.tsx:22`).

Exclusions (checked first, order matters):
1. Trailing `VWEU` / `VEU` — covers `artikel 16 VWEU` and `artikel 4, lid 2, VEU` (~14 occurrences, all recitals).
2. `van/bij` + other instrument: `van (Verordening|Richtlijn|Besluit|Kaderbesluit|Aanbeveling|Uitvoeringsverordening|het Verdrag|de bijlage bij ...)` → skip, **except** `van deze verordening` and `van Verordening (EU) 2024/1689` (both linkable).
3. Articles 102–110 quote text of *other* acts: pass `linkBareRefs: false` — only the explicit `... van Verordening (EU) 2024/1689` form links there.
4. Self-refs `dit artikel`/`dit lid`/`deze bijlage`: no digit token, never matched. Deferred enhancement: bare `lid N` → same-page `#lid-N`.

Parser post-pass in `scripts/parse-aiact.ts`: walk all ContentNodes (incl. nested `ListItem.content`) of articles/annexes/recitals, attach `refs`, validate every href against the just-built sets of article numbers/annex romans/anchors — **throw on unresolvable target**.

## UI

- `src/components/content/LinkedText.tsx` (RSC): slices text at offsets, emits text + links. Used by `ContentNodes.tsx` text nodes + recital page.
- `src/components/content/RefLink.tsx` (`"use client"`): Next `<Link>` in Radix `HoverCard.Root`; preview = target title + first ~200 chars, resolved at build via `src/lib/data.ts` and inlined in static HTML (~10–20 KB extra on heavy pages — acceptable; fallback design if it balloons: lazy `public/link-previews.json` keyed by href).
- New dep `@radix-ui/react-hover-card` (approved; internals mostly shared with existing dialog dep).

## Verify additions (`scripts/verify-data.ts`)

- Exact total ref-count snapshot: **566** (update deliberately on source updates).
- Every href resolves — independent recheck from the JSON, not the parser's own sets.
- Negative spot checks: recital 38 (not 2 as first drafted) `artikel 16 VWEU` not annotated; art 3 `artikel 4, punt 1, van Verordening (EU) 2016/679` not annotated; arts 102–110 bodies have no bare-ref annotations.
- Positive spot checks: art 6 lid 1 → `/bijlage/i`; a `tot en met` range yields per-number spans; every span's offsets in bounds and `text.slice(start,end)` matches `/artikel|bijlage|hoofdstuk|lid|punt|\d/`.

## Files

New: `src/lib/crossrefs.ts`, `src/components/content/LinkedText.tsx`, `src/components/content/RefLink.tsx`.
Modified: `src/lib/types.ts`, `src/lib/data.ts` (preview helper), `scripts/parse-aiact.ts`, `scripts/verify-data.ts`, `src/components/content/ContentNodes.tsx`, `src/app/overweging/[nummer]/page.tsx`, `src/app/overwegingen/page.tsx` (recital shape consumer), `package.json`, regenerated `data/generated/*`.

## Order

1. types + `crossrefs.ts` grammar — develop against grep samples from corpus; hardest case: `artikelen 9, 10, 11, 12, 13, 14, 15, 72 en 73`.
2. Parser post-pass + recital shape change.
3. Verify assertions.
4. LinkedText/RefLink UI.
5. `verify-app` skill pass (click-through; hover = tap on mobile).

## Risks

Grammar false positives in unanticipated phrasings — mitigated by exclusion-first design + exact-count snapshot forcing review of every delta.
