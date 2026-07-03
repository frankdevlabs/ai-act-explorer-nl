# Epic 4 — UI polish: global toggle, diff-view links, nav fit

**Status**: implemented (2026-07-03), incl. follow-up 4.4 below. Deviations from plan: base ref pin landed on 563, not 565 — the bis/ter grammar also killed two false positives in recital 41 ("artikelen 2 en 2 bis van Protocol nr. 22"), same class as the predicted recital-40 fix; amendment-layer ref pin = 462 (after re-merging segment clips; parser emits 504 raw). verify-amendments re-merges segment ref clips before the span-sanity regex (a lone clip can be pure punctuation).
**Goal**: three fixes — (1) omnibus-changes toggle in the header next to the dark-mode button, (2) cross-reference links keep working inside the track-changes view, (3) prev/next navigation text fits its buttons.

## 4.1 Global omnibus toggle in Header

**Mechanism: tiny external store + `useSyncExternalStore`, no context provider.** Matches both existing patterns: custom events (`aiact:open-search`) and the ThemeToggle `useSyncExternalStore` idiom.

New `src/lib/omnibus-pref.ts`:
- Keep key `"omnibus-diff"` and `"1"`/`"0"` string format (backward compatible with stored prefs; currently read directly in `AmendedArticleView.tsx`).
- `EVENT = "aiact:omnibus-diff"`; `subscribe(cb)` listens to EVENT **and** `"storage"` (filtered `e.key === KEY`) → same-tab + cross-tab reactivity.
- `getSnapshot(): boolean` (primitive — safe for useSyncExternalStore), server snapshot `false`.
- `setOmnibusDiff(v)`: localStorage write + `dispatchEvent(new Event(EVENT))`.
- `useOmnibusDiff()` hook.

Header (`src/components/layout/Header.tsx`): `GlobalDiffToggle` next to `ThemeToggle` — `size-9 rounded-md border border-line` button, `FileDiff` icon (same as per-article toggle), `aria-pressed={on}` + `aria-pressed:border-accent aria-pressed:text-accent` (exact classes of the per-article button). No SSR placeholder needed (icon doesn't change, only pressed styling; server renders `false`). Tooltip/aria-label: "Omnibus-wijzigingen tonen (op gewijzigde artikelen)" — also the answer for non-article pages: pressed state is global feedback, page effect only on amended articles.

**Precedence** (keep the per-article button — it anchors change-nav + legend): *URL wins at load; any preference change after load wins over URL.*
- `AmendedArticleView`: drop the direct `localStorage.getItem` read; `showDiff = override ?? (urlDiff !== null ? urlDiff === "1" : useOmnibusDiff())`.
- `useEffect(() => subscribe(() => setOverride(getSnapshot())), [])` — a header (or other-tab) toggle flips the view even with `?diff=1` in the URL, instead of appearing dead.
- Per-article `toggle()`: `setOmnibusDiff(next)` + existing `router.replace` URL sync. Header toggle never touches the URL.

Files: new `src/lib/omnibus-pref.ts`; modify `Header.tsx`, `AmendedArticleView.tsx`.

## 4.2 Cross-links keep working in diff view

Current state: unchanged paragraphs in diff view render `ContentNodes` (links work); modified/inserted/deleted render `DiffSegments` (plain text — links lost). `parse-amendments.ts` never calls `findRefs`; `ParagraphDiff.newContent` carries only ~10 hand-curated refs from the transcription.

**Prerequisite — bis/ter support in `crossrefs.ts`.** `parseArtikel`'s number token is `/\d+…/`, so "artikel 75 ter" emits a WRONG link (`/artikel/75`); the amendment layer contains ~28 bis/ter-style references. Extend the artikel token to optionally consume ` (bis|ter|quater|quinquies)` → slug `75ter` (matches `NewArticleSpec.slug` convention). Side effect on the base corpus: recital 40's current false positive ("artikel 6 bis van Protocol nr. 21" → `/artikel/6`) gets fixed — the pinned count in `verify-data.ts` (566) drops by one; update deliberately and audit `git diff data/generated/` to confirm recital 40 is the only base change.

**Post-pass in `parse-amendments.ts`** (after states/newArticles/newAnnexes are built):
- Annotate `newArticles[].paragraphs`, `newAnnexes[].content`, and `ParagraphDiff.newContent` via `findRefs` (ctx `{selfType, selfRef: slug/roman}`). Validator rebuilt locally from articles/annexes anchor sets ∪ new-article slugs ∪ new-annex romans ∪ anchors derived from newContent: unknown page target → throw; unknown fragment → strip (same semantics as parse-aiact's post-pass). New-article pages render via `ArticleBody` → `ContentNodes` → `LinkedText`, so `/artikel/4bis` etc. get working links with zero UI change.
- **Parser strips incoming hand-curated `refs` and regenerates** (single deterministic authority). Delete the hand refs from `pe-cons-30-26.json`; add "never hand-curate refs — the parser generates them" to `transcribe-amendments/SKILL.md`.
- Segments: `DiffSegment` gains `refs?: RefSpan[]` (types.ts). Run `findRefs` once over `concat(eq+ins)` — the new-text string parse-amendments already computes for the diff invariant — then walk segments tracking the new-text offset and clip each RefSpan to each eq/ins segment's range. (~35 segment boundaries currently split a reference phrase; a span crossing a boundary becomes two adjacent same-href link fragments — visually contiguous, acceptable.) `del` segments get no refs.
- `DiffSegments.tsx`: render `<LinkedText text={s.text} refs={s.refs}/>` inside ins/eq spans. Component has no `"use client"` → stays RSC → build-time hover previews work as-is.
- `data.ts getPreview`: the `/artikel/(\d+)` match won't preview bis slugs — extend to resolve them (RefLink degrades gracefully without, but do it).

Verify: `verify-amendments.ts` gains a ref block mirroring verify-data's (every ref — segments + newContent + new articles/annexes — resolves page+anchor; offsets in bounds; span-text sanity regex, which also guards against list-marker misparses since flattened segment text includes `a)` markers that base annotation never sees). Pin the amendment-layer ref count; spot check one `/artikel/75ter` href. `verify-data.ts`: update the base pin (566 → expected 565).

## 4.3 PrevNextNav text fit

`src/components/layout/PrevNextNav.tsx` problems: flex children lack `min-w-0` (refuse to shrink), the label row's text node isn't truncatable, `truncate` on the title can't act when the item won't shrink.

- Both `Link`s: add `min-w-0` (keep `max-w-[50%]`; consider `flex-1 basis-1/2` for symmetry).
- Label row: `min-w-0 max-w-full whitespace-nowrap`; icon `shrink-0`; label text wrapped in a `truncate` span.
- Title: `line-clamp-2 max-w-full` instead of `truncate` (two clamped lines beat one truncated line for long titles like art 13/26).
- Same defensive fix (min-w-0/truncate on text spans, `shrink-0` on arrows) on the change-nav footer in `AmendedArticleView.tsx` (currently no max-width at all).

## 4.4 Diff-view line structure (follow-up)

The diff invariant works over `flattenNodes`, so `DiffSegments` rendered whole
articles as one flat `<p>` — unreadable on `/artikel/3` (68 definitions,
~20k chars). Fix: break-offset pass, invariant untouched.

- `flatten.ts`: `flattenWithBreaks` — flat text + offsets where each content
  node / list item (any depth) starts; must project byte-identically to
  `flattenNodes` (parser asserts).
- `parse-amendments.ts` `statesToDiffs`: `splitAtBreaks` splits eq/ins
  segments at new-text breaks, del segments at old-text breaks; a chunk
  starting on a break gets `br: true` (`DiffSegment.br` in types.ts).
  Same-op adjacency keeps concat(eq+ins)/concat(eq+del) byte-identical.
  Runs before the ref post-pass, so ref clips land on the split segments
  (merged pin 462 unchanged — refs never cross block boundaries).
- `DiffSegments.tsx`: groups segments into lines at `br`, one `<p>` per line.

## Files

New: `src/lib/omnibus-pref.ts`.
Modified: `src/components/layout/Header.tsx`, `src/components/content/AmendedArticleView.tsx`, `src/components/layout/PrevNextNav.tsx`, `src/lib/crossrefs.ts`, `src/lib/types.ts`, `scripts/parse-amendments.ts`, `scripts/verify-amendments.ts`, `scripts/verify-data.ts` (pin update), `src/components/content/DiffSegments.tsx`, `src/lib/data.ts`, `data/source/amendments/pe-cons-30-26.json` (drop hand refs), `.claude/skills/transcribe-amendments/SKILL.md`, regenerated `data/generated/*` + `public/amendment-search-docs.json`.

## Order

1. 4.3 (isolated CSS).
2. 4.1 (store + header + view refactor).
3. 4.2 (crossrefs bis/ter → parse-amendments post-pass → DiffSegments → verify) — the big one.

## Verification

- `npm run build` green (both verify scripts; audit generated diff for the 566→565 base change = recital 40 only).
- `verify-app` additions: header toggle flips diff on `/artikel/6` and persists to `/artikel/10`; `?diff=1` deep link with pref off shows diff, header toggle then hides it; in diff view an `ins` segment contains `<a href="/artikel/…">`; `/artikel/4bis` body has links; 360px viewport → no horizontal scroll on `/artikel/13`.

## Risks

- Toggle precedence subtleties — mitigated by the subscribe-sets-override rule.
- 4.2 ripple into base corpus — audit the generated diff (expected: recital 40 only).
- Offset mapping off-by-ones — covered by the ref verify block + the diff invariant re-check.
