---
name: verify-app
description: Verify the app end-to-end on this VPS - build, curl smoke checks, and optional Playwright browser checks (search palette, deep links, mobile nav, dark mode, omnibus diff toggle + diff-view links, document tab strip). Use after parser/data/UI changes or before pushing.
---

# Verify the app

## 1. Build (includes data verification)

```bash
cd ~/ai-act-explorer-nl && npm run build
```

Must end green: `parse` logs counts (expect `113 articles, 180 recitals,
13 annexes, 13 chapters, ... search docs` plus `parse-amendments: 76
instructions, 36 amended articles, 6 new articles, 1 new annexes ...
(complete=true)`), `verify` prints `verify-data: all assertions passed` and
`verify-amendments: all assertions passed`, `next build` exports ~321 static
pages.

## 2. Dev server + curl smoke checks

Reuse the existing tmux session if present:

```bash
tmux list-sessions | grep aiact-dev \
  || tmux new-session -d -s aiact-dev 'cd ~/ai-act-explorer-nl && npm run dev'
tmux capture-pane -t aiact-dev -p | grep -oE 'localhost:[0-9]+' | head -1  # usually 3105
```

```bash
PORT=3105
curl -s "http://localhost:$PORT/artikel/5"    | grep -c "subliminale technieken"   # >= 1
curl -s "http://localhost:$PORT/artikel/5"    | grep -c 'id="lid-1-a"'             # >= 1
curl -s "http://localhost:$PORT/overweging/42" | grep -c "Overweging 42"           # >= 1
curl -s "http://localhost:$PORT/bijlage/iii"  | grep -c "artikel 6, lid 2"         # >= 1
curl -s "http://localhost:$PORT/search-docs.json" | head -c 100                    # JSON array
```

## 3. Browser checks (Playwright, optional but thorough)

Search is client-only, so curl can't test it. Playwright runs directly on this
VPS via law-tracker's install — no npm install needed:

```bash
cd "$SCRATCH"   # your session scratchpad
ln -sfn ~/law-tracker/lib/node_modules node_modules
```

Write `e2e.mjs`:

```js
import { chromium } from "playwright";
const BASE = "http://localhost:3105";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// 1. palette search navigates to a deep link
await page.goto(BASE);
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/zoek/i).fill("verboden praktijken");
await page.waitForTimeout(600);
await page.keyboard.press("Enter");
await page.waitForURL(/artikel\/5/);

// 2. deep link target visible + highlighted
await page.goto(`${BASE}/artikel/5#lid-1-a`);
const el = page.locator("#lid-1-a");
if (!(await el.isVisible())) throw new Error("deep link #lid-1-a not visible");

// 3. search page
await page.goto(`${BASE}/zoeken?q=biometrische identificatie`);
await page.waitForSelector("mark");

// 4. mobile drawer
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(BASE + "/artikel/9");
await page.getByRole("button", { name: "Menu openen" }).click();
await page.locator('[role="dialog"]').getByRole("link", { name: /Art\. 10/ }).waitFor();
await page.keyboard.press("Escape"); // close drawer before clicking behind it

// 5. dark mode
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: /thema/i }).click();
if (!(await page.locator("html.dark").count())) throw new Error("dark mode");

// 6. global omnibus toggle (header) flips the diff view and persists across pages
const headerToggle = () => page.getByRole("button", { name: /Omnibus-wijzigingen tonen/ });
const diffVisible = () => page.locator("[data-diff-status]").first().isVisible().catch(() => false);
// positive assertions waitFor the selector (hydration timing varies in dev);
// only the negative assertions below use a fixed settle wait
const diffAppears = (msg) =>
  page.locator("[data-diff-status]").first().waitFor({ timeout: 5000 }).catch(() => {
    throw new Error(msg);
  });
await page.goto(`${BASE}/artikel/6`);
await page.evaluate(() => localStorage.removeItem("omnibus-diff"));
await page.reload();
await headerToggle().waitFor();
await headerToggle().click();
await diffAppears("header toggle did not show diff");
await page.goto(`${BASE}/artikel/10`);
await diffAppears("omnibus pref did not persist across pages");

// 7. ?diff=1 deep link wins at load; a later header toggle wins over the URL
await page.evaluate(() => localStorage.setItem("omnibus-diff", "0"));
await page.goto(`${BASE}/artikel/6?diff=1`);
await diffAppears("?diff=1 deep link did not show diff");
await headerToggle().click(); // pref 0 -> 1
await headerToggle().click(); // pref 1 -> 0: must override ?diff=1
await page.waitForTimeout(300);
if (await diffVisible()) throw new Error("header toggle did not override ?diff=1");

// 8. diff view carries working cross-reference links inside <ins> segments
await page.evaluate(() => localStorage.setItem("omnibus-diff", "1"));
await page.goto(`${BASE}/artikel/2`);
const insLink = page.locator('ins a[href^="/artikel/"], ins a[href^="/bijlage/"]').first();
await insLink.waitFor();
const href = await insLink.getAttribute("href");
await insLink.click();
await page.waitForURL((u) => u.pathname === href.split("#")[0]);

// 9. omnibus new-article page has cross-links ("artikel 10, lid 2, punten f) en g)")
await page.goto(`${BASE}/artikel/4bis`);
if ((await page.locator('article a[href^="/artikel/10#"]').count()) < 2)
  throw new Error("no cross-links on /artikel/4bis");

// 10. narrow viewport: prev/next nav must not overflow
await page.setViewportSize({ width: 360, height: 800 });
await page.goto(`${BASE}/artikel/13`);
await page.waitForTimeout(300);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow > 0) throw new Error(`horizontal overflow ${overflow}px @360px`);

// 11. diff view restores line structure (one block per definition on artikel 3)
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/artikel/3`);
await page.locator("[data-diff-status]").first().waitFor();
if ((await page.locator("[data-diff-status] p").count()) < 60)
  throw new Error("artikel 3 diff view collapsed to a flattened blob");

// 12. tab strip: visiting documents adds tabs; current tab is active
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/artikel/6`);
await page.evaluate(() => localStorage.removeItem("aiact-tabs"));
await page.goto(`${BASE}/artikel/6`);
await page.goto(`${BASE}/overweging/14`);
const strip = page.locator('nav[aria-label="Geopende documenten"]');
const tabLinks = strip.locator("a");
await strip.locator('a[href="/overweging/14"]').waitFor(); // strip mounts after hydration
if ((await tabLinks.count()) !== 2) throw new Error("expected 2 tabs");
if (!(await tabLinks.nth(1).getAttribute("class")).includes("border-accent"))
  throw new Error("second (current) tab not marked active");

// 13. tab click navigates; close (X) removes without navigating
await tabLinks.first().click();
await page.waitForURL(/artikel\/6/);
await strip.getByRole("button", { name: "Sluit Art. 6" }).click();
await page.waitForTimeout(200);
if ((await tabLinks.count()) !== 1) throw new Error("close did not remove tab");
if (!page.url().includes("/artikel/6")) throw new Error("closing current tab navigated away");

// 14. tabs persist across reload, versioned storage (reload re-registers Art. 6 -> 2 tabs)
await page.reload();
await strip.locator('a[href="/overweging/14"]').waitFor();
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("aiact-tabs")));
if (stored.v !== 1 || stored.tabs.length !== 2) throw new Error("aiact-tabs bad shape after reload");

// 15. LRU cap: 9 documents -> exactly 8 tabs, first-visited evicted
await page.evaluate(() => localStorage.removeItem("aiact-tabs"));
// registration is an inline script (runs at HTML parse), so plain gotos suffice
for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 10]) await page.goto(`${BASE}/artikel/${n}`);
await strip.locator('a[href="/artikel/10"]').waitFor(); // strip UI mounts post-hydration
if ((await tabLinks.count()) !== 8) throw new Error("LRU cap != 8 tabs");
if ((await strip.locator('a[href="/artikel/1"]').count()) !== 0)
  throw new Error("oldest tab not evicted");

// 16. 360px: strip scrolls inside itself, body does not overflow (artikel/10
// is the long-compound-word worst case for the marker-grid columns)
await page.setViewportSize({ width: 360, height: 800 });
await page.goto(`${BASE}/artikel/10`);
await strip.locator("a").first().waitFor();
const stripScrolls = await strip
  .locator("div")
  .first()
  .evaluate((el) => el.scrollWidth > el.clientWidth);
if (!stripScrolls) throw new Error("8 tabs @360px should overflow the strip container");
const tabOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (tabOverflow > 0) throw new Error(`tab strip caused ${tabOverflow}px body overflow @360px`);

// 17. tab registration happens pre-hydration (inline script): with all JS
// chunks blocked, visiting a document must still record the tab. Fresh page
// (no console-error listener) — aborted chunk loads log resource errors.
const blocked = await browser.newPage();
await blocked.route("**/_next/static/**", (r) => r.abort());
await blocked.goto(`${BASE}/artikel/6`);
const preHydration = await blocked.evaluate(() => JSON.parse(localStorage.getItem("aiact-tabs")));
if (preHydration?.v !== 1 || preHydration.tabs[0]?.href !== "/artikel/6")
  throw new Error("pre-hydration registration failed");
await blocked.close();

if (errors.length) throw new Error("console errors:\n" + errors.join("\n"));
console.log("e2e: all checks passed");
await browser.close();
```

Run (the `LD_LIBRARY_PATH` is required — Chromium needs locally-extracted
`libgbm` etc., no root on this VPS):

```bash
LD_LIBRARY_PATH=~/law-tracker/lib/chromium-sys-libs node e2e.mjs
```

Gotchas: the symlinked `node_modules` must sit **next to the script** (ESM
resolves from the script path, not cwd); scope drawer selectors to
`[role="dialog"]` (links duplicate the sidebar); press Escape before clicking
elements the overlay covers.

## 4. Static export sanity

```bash
# 3 entries per route: page dir + .html + .txt
ls ~/ai-act-explorer-nl/out/artikel | wc -l    # 357 = (113 base + 6 omnibus) × 3
ls ~/ai-act-explorer-nl/out/overweging | wc -l # 540 = 180 × 3
ls ~/ai-act-explorer-nl/out/bijlage | wc -l    # 42 = 14 × 3, incl. bijlage XIV (digitale omnibus)
```

Amendment-layer checks (digitale omnibus, PE-CONS 30/26):

```bash
curl -s "http://localhost:$PORT/artikel/4bis"   | grep -c "Ingevoegd door de digitale omnibus"  # >= 1
curl -s "http://localhost:$PORT/bijlage/xiv"    | grep -c "Toegevoegd door de digitale omnibus" # >= 1
curl -s "http://localhost:$PORT/wijzigingen"    | grep -c "PE-CONS 30/26"                       # >= 1
curl -s "http://localhost:$PORT/artikel/2"      | grep -c 'id="w-lid-13"'                       # >= 1 (diff view prerendered)
curl -s "http://localhost:$PORT/amendment-search-docs.json" | head -c 100                       # JSON array
```
