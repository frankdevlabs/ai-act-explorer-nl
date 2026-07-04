# Epic 6 — Article tabs (auto-tab on visit)

**Status**: implemented (2026-07-03); verify-app checks 12–16 cover it.
**Goal**: visiting an article/recital/annex adds it to a persistent tab strip under the header; tabs navigate, close, and survive reloads. Static-export compatible (tabs are pure client state; navigation stays full page loads).

## State — `src/lib/tabs.ts`

- Key `"aiact-tabs"`, event `"aiact:tabs"`, schema `{ v: 1, tabs: [{ href, label, title?, at }] }`.
- Version-gated read: parse error or `v !== 1` → `[]` (never migrate).
- `visitTab(tab)`: dedupe by `href` — update `at` and refresh label/title, **keep position** (browser-tab metaphor: no reorder on revisit); else append; evict lowest-`at` when length > 8 (LRU by last visit).
- `closeTab(href)`; `subscribe` = event + `"storage"` listeners (cross-tab).
- `useTabs()` via `useSyncExternalStore`. **Top footgun: cache the parsed array keyed on the raw localStorage string** so `getSnapshot` is referentially stable — a fresh array per call = infinite re-render loop. Frozen `[]` as server snapshot.

## Registration — per-page `<RegisterTab/>`

`src/components/layout/RegisterTab.tsx` (`"use client"`): dual registration — an inline `<script>` (from `visitTabScript`, SSR'd into the static HTML) records the visit at document parse, before hydration, so fast leave/navigation can't lose it; a `useEffect(() => visitTab(...), [href, label, title])` covers client-side Link navigations (React diffs the script element without re-executing it). Both idempotent upserts. Pages already compute `display`/`title` at build time, so this avoids shipping a client-side title lookup (toc is already serialized into every page's RSC payload twice — don't add a third copy). `usePathname` excludes the query string and `router.replace("?diff=1")` re-renders without remount → the omnibus toggle doesn't spam registrations.

Tabbable routes only: add `<RegisterTab/>` in the three document page files — `/artikel/[nummer]` (label `Art. 6` / `Art. 4 bis`, + title), `/overweging/[nummer]` (`Ov. 14`), `/bijlage/[nummer]` (`Bijl. III`, + title). NOT `/wijzigingen`, index pages, `/zoeken`, `/` — nav pages aren't documents.

## Strip — `src/components/layout/TabStrip.tsx`

- Placement: in `layout.tsx` directly after `<Header/>`, **non-sticky**. Rationale: the sidebar (`sticky top-14 h-[calc(100vh-3.5rem)]`) and all anchor targets (`scroll-mt-24`, homepage `scroll-mt-20`) hardcode the 3.5rem header; and under static export every navigation lands at scroll-top, so the strip is visible exactly when tab-switching happens. (Documented alternative if stickiness is wanted later: move the strip inside the `<header>` element and change offsets coordinated — `top-[5.75rem]`, `h-[calc(100vh-5.75rem)]`, `scroll-mt-28`.)
- Markup: `<nav aria-label="Geopende documenten" className="border-b border-line">` → inner `mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5`. Tab = Next `Link`: `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:text-foreground`; active (`usePathname() === href`): `border-accent bg-surface text-accent`. Title span `max-w-[9rem] truncate hidden sm:inline` (labels only on mobile).
- Close: nested `<button aria-label={"Sluit " + label}>` with `X` icon, `onClick`: preventDefault + stopPropagation + `closeTab(href)`. Closing the **current** tab: remove only, stay on the page (no surprise navigation; the tab reappears on the next full navigation since RegisterTab's mount effect ran — document this). Middle-click: leave browser default (opens in new browser tab); do NOT implement middle-click-close — the conventions conflict on a link element.
- Hydration: render `null` until mounted and when `tabs.length === 0` (ThemeToggle mounted-flag pattern); accepted small layout shift, matches codebase tolerance. No `suppressHydrationWarning` needed.
- All breakpoints, horizontal scroll (most useful <lg where the sidebar is hidden); optional `[scrollbar-width:none]`.

## Files

New: `src/lib/tabs.ts`, `src/components/layout/TabStrip.tsx`, `src/components/layout/RegisterTab.tsx`.
Modified: `src/app/layout.tsx`, `src/app/artikel/[nummer]/page.tsx`, `src/app/overweging/[nummer]/page.tsx`, `src/app/bijlage/[nummer]/page.tsx`, `.claude/skills/verify-app/SKILL.md`.

## Order

1. `tabs.ts` (store + hook, with the snapshot cache).
2. `TabStrip` + layout wiring.
3. `RegisterTab` + the three page files.
4. verify-app additions.

## Verification (verify-app Playwright additions)

- Visit `/artikel/6` then `/overweging/14` → strip shows 2 tabs, second active.
- Click tab 1 → lands on `/artikel/6`; close via X → 1 tab, no navigation.
- Reload → tabs persisted; `localStorage["aiact-tabs"]` parses with `v: 1`.
- Visit 9 documents → exactly 8 tabs, oldest-visited evicted.
- No hydration errors in console; 360px viewport → strip scrolls horizontally, body scrollWidth unaffected.

## Risks

- `getSnapshot` referential stability (top risk — the string-keyed cache).
- CLS on hydration — accepted, documented.
- localStorage corruption/quota — try/catch + version gate → reset to `[]`.
- Stale titles after a source update — upsert-on-revisit refreshes them; LRU limits lifetime.
- Header-height coupling if stickiness is added later — documented alternative above.
