---
name: verify-app
description: Verify the app end-to-end on this VPS - build, curl smoke checks, and optional Playwright browser checks (search palette, deep links, mobile nav, dark mode). Use after parser/data/UI changes or before pushing.
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
await page.locator('[role="dialog"]').getByRole("link", { name: /Artikel 10/ }).waitFor();
await page.keyboard.press("Escape"); // close drawer before clicking behind it

// 5. dark mode
await page.setViewportSize({ width: 1280, height: 900 });
await page.getByRole("button", { name: /thema/i }).click();
if (!(await page.locator("html.dark").count())) throw new Error("dark mode");

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
ls ~/ai-act-explorer-nl/out/artikel | wc -l    # 240 (113 base + 6 omnibus articles, .html + .txt each, + 2 dirs)
ls ~/ai-act-explorer-nl/out/overweging | wc -l # 180 pages
ls ~/ai-act-explorer-nl/out/bijlage | wc -l    # 14 incl. bijlage XIV (digitale omnibus)
```

Amendment-layer checks (digitale omnibus, PE-CONS 30/26):

```bash
curl -s "http://localhost:$PORT/artikel/4bis"   | grep -c "Ingevoegd door de digitale omnibus"  # >= 1
curl -s "http://localhost:$PORT/bijlage/xiv"    | grep -c "Toegevoegd door de digitale omnibus" # >= 1
curl -s "http://localhost:$PORT/wijzigingen"    | grep -c "PE-CONS 30/26"                       # >= 1
curl -s "http://localhost:$PORT/artikel/2"      | grep -c 'id="w-lid-13"'                       # >= 1 (diff view prerendered)
curl -s "http://localhost:$PORT/amendment-search-docs.json" | head -c 100                       # JSON array
```
