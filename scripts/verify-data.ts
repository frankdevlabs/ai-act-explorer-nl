/** Completeness assertions over data/generated/*.json; runs before every build. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Annex, Article, ContentNode, Recital, SearchDoc, Toc } from "../src/lib/types";
import { flattenNodes as flatten } from "../src/lib/flatten";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(join(root, "data/generated", name), "utf-8"));

const articles = load<Article[]>("articles.json");
const recitals = load<Recital[]>("recitals.json");
const annexes = load<Annex[]>("annexes.json");
const toc = load<Toc>("toc.json");
const searchDocs = load<SearchDoc[]>("search-docs.json");

// counts and numbering
assert.equal(articles.length, 113, "113 articles");
articles.forEach((a, i) => assert.equal(a.number, i + 1, `article numbering at ${i}`));
assert.equal(recitals.length, 180, "180 recitals");
recitals.forEach((r, i) => assert.equal(r.number, i + 1, `recital numbering at ${i}`));
assert.equal(annexes.length, 13, "13 annexes");
annexes.forEach((a, i) => assert.equal(a.ordinal, i + 1, `annex ordering at ${i}`));
assert.equal(toc.chapters.length, 13, "13 chapters");

// section distribution: III:5, V:4, VII:2, IX:5
const sectionCounts = Object.fromEntries(
  toc.chapters.filter((c) => c.sections.length > 0).map((c) => [c.roman, c.sections.length]),
);
assert.deepEqual(sectionCounts, { III: 5, V: 4, VII: 2, IX: 5 }, "section distribution");

// every article: title, membership, non-trivial body
for (const a of articles) {
  assert.ok(a.title.length > 3, `article ${a.number} title`);
  assert.ok(a.paragraphs.length >= 1, `article ${a.number} paragraphs`);
  const body = a.paragraphs.map((p) => flatten(p.content)).join(" ");
  assert.ok(body.trim().length > 50, `article ${a.number} body too short: ${body.slice(0, 80)}`);
  const anchors = a.paragraphs.map((p) => p.anchor);
  assert.equal(new Set(anchors).size, anchors.length, `article ${a.number} duplicate anchors`);
}

// known articles without numbered leden (incl. amendment articles 102-110,
// whose quoted lid numbers belong to the amended acts), parsed as one flat body
const FLAT = [3, 4, 16, 32, 39, 66, 85, 87, 94, 102, 103, 104, 105, 106, 107, 108, 109, 110, 113];
for (const n of FLAT) {
  const a = articles[n - 1];
  assert.ok(
    a.paragraphs.length === 1 && a.paragraphs[0].number === null,
    `article ${n} expected flat body`,
  );
}
// and the inverse: numbered articles have numbered paragraphs
for (const a of articles) {
  if (!FLAT.includes(a.number)) {
    assert.ok(
      a.paragraphs.some((p) => p.number !== null),
      `article ${a.number} expected numbered leden`,
    );
  }
}

// every recital/annex non-empty
for (const r of recitals)
  assert.ok(r.paragraphs.map((p) => p.text).join(" ").length > 40, `recital ${r.number} body`);
for (const a of annexes) {
  assert.ok(a.title.length > 5 && !/^BIJLAGE/.test(a.title), `annex ${a.roman} title`);
  assert.ok(flatten(a.content).length > 200, `annex ${a.roman} body`);
}

// corpus size + search docs
const corpus =
  articles.map((a) => a.paragraphs.map((p) => flatten(p.content)).join(" ")).join(" ") +
  recitals.map((r) => r.paragraphs.map((p) => p.text).join(" ")).join(" ") +
  annexes.map((a) => flatten(a.content)).join(" ");
assert.ok(corpus.length > 500_000, `corpus ${corpus.length} chars`);
// 726 → 826 when annex chunking went per-point (2026-07, search overhaul)
assert.equal(searchDocs.length, 826, `search docs ${searchDocs.length}`);
assert.equal(
  searchDocs.filter((d) => d.type === "bijlage").length,
  127,
  "bijlage search docs (per-point chunking)",
);
assert.equal(new Set(searchDocs.map((d) => d.id)).size, searchDocs.length, "search doc ids unique");
for (const d of searchDocs) assert.ok(d.text.trim().length > 0, `empty search doc ${d.id}`);

// per-point chunking spot checks (the motivating case: Annex III point 5)
const anx3p5 = searchDocs.find((d) => d.id === "anx-iii-punt-5");
assert.ok(anx3p5, "anx-iii-punt-5 search doc exists");
assert.equal(anx3p5.url, "/bijlage/iii#punt-5", "anx-iii-punt-5 deep link");
assert.ok(anx3p5.text.startsWith("5."), "anx-iii-punt-5 starts with its marker");
assert.ok(anx3p5.text.includes("kredietwaardigheid"), "anx-iii-punt-5 contains credit scoring");
// annex search-doc fragments must be unique anchors on their page (VII/VIII/X
// repeat punt-* anchors across lists — those docs carry no fragment)
for (const d of searchDocs.filter((x) => x.type === "bijlage")) {
  const [page, fragment] = d.url.split("#");
  assert.equal(page, `/bijlage/${d.ref}`, `annex doc ${d.id} url page`);
  if (fragment) {
    const annex = annexes.find((x) => x.roman.toLowerCase() === d.ref);
    assert.ok(annex, `annex doc ${d.id} ref resolves`);
    const count = annex.content
      .filter((n) => n.type === "list")
      .flatMap((n) => (n.type === "list" ? n.items : []))
      .filter((i) => i.anchor === fragment).length;
    assert.equal(count, 1, `annex doc ${d.id} fragment #${fragment} unique on page`);
  }
}

// spot checks against the OJ text
const art3 = flatten(articles[2].paragraphs[0].content);
assert.ok(art3.includes("op een machine gebaseerd systeem"), "art 3 punt 1 AI-systeem definition");
const art5 = flatten(articles[4].paragraphs[0].content);
assert.ok(art5.includes("subliminale technieken"), "art 5 lid 1 a");
assert.equal(articles[4].title, "Verboden AI-praktijken", "art 5 title");
assert.ok(flatten(articles[112].paragraphs[0].content).includes("2 augustus 2026"), "art 113");
assert.ok(
  recitals[0].paragraphs[0].text.includes("betrouwbare artificiële intelligentie"),
  "recital 1",
);
assert.ok(recitals[179].paragraphs[0].text.includes("Europese Toezichthouder"), "recital 180");
const anx3 = annexes[2];
assert.ok(anx3.title.includes("artikel 6, lid 2"), "annex III title");
assert.ok(
  anx3.content.some(
    (n) => n.type === "list" && n.items.some((i) => i.content.some((c) => c.type === "list")),
  ),
  "annex III nested points",
);
// consolidated text: art. 73 numbering fixed by corrigendum (1..11, no gaps)
assert.deepEqual(
  articles[72].paragraphs.map((p) => p.number),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "art 73 lid numbering (corrigendum)",
);
// footnote-referencing articles: 78 (bedrijfsgeheimen) + amendment articles 102-110
for (const n of [78, 102, 103, 104, 105, 106, 107, 108, 109, 110]) {
  assert.ok(articles[n - 1].footnotes.length === 1, `art ${n} footnote`);
}

// ------------------------------------------------- internal cross-references

interface FlatRef {
  where: string;
  text: string;
  start: number;
  end: number;
  href: string;
}
const allRefs: FlatRef[] = [];
function collectRefs(nodes: ContentNode[], where: string): void {
  for (const n of nodes) {
    if (n.type === "text" && n.refs) {
      for (const r of n.refs) allRefs.push({ where, text: n.text, ...r });
    } else if (n.type === "list") {
      for (const i of n.items) collectRefs(i.content, where);
    }
  }
}
for (const a of articles)
  for (const p of a.paragraphs) collectRefs(p.content, `artikel ${a.number}`);
for (const r of recitals)
  for (const p of r.paragraphs)
    for (const s of p.refs ?? []) allRefs.push({ where: `overweging ${r.number}`, text: p.text, ...s });
for (const a of annexes) collectRefs(a.content, `bijlage ${a.roman}`);

// exact snapshot: any grammar/source change must consciously update this number
// (566 → 563 when the artikel grammar learned bis/ter suffixes: three false
// positives into treaty Protocols dropped — recital 40 "artikel 6 bis van
// Protocol nr. 21", recital 41 "artikelen 2 en 2 bis van Protocol nr. 22";
// 563 → 561 when instrument qualifiers learned to distribute over
// conjunctions — recital 140 "artikel 6, lid 4, en artikel 9 … van
// Verordening (EU) 2016/679" and "artikel 4, lid 2, en artikel 10 van
// Richtlijn (EU) 2016/680" dropped)
assert.equal(allRefs.length, 561, `cross-reference count (got ${allRefs.length})`);

// every href resolves — recheck from the JSON, independent of the parser's own sets
const articleNums = new Set(articles.map((a) => String(a.number)));
const annexRomans = new Set(annexes.map((a) => a.roman.toLowerCase()));
const chapterRomans = new Set(toc.chapters.map((c) => c.roman.toLowerCase()));
const pageAnchors = new Map<string, Set<string>>();
function collectAnchors(nodes: ContentNode[], into: Set<string>): void {
  for (const n of nodes) {
    if (n.type !== "list") continue;
    for (const i of n.items) {
      if (i.anchor) into.add(i.anchor);
      collectAnchors(i.content, into);
    }
  }
}
for (const a of articles) {
  const set = new Set<string>();
  for (const p of a.paragraphs) {
    set.add(p.anchor);
    collectAnchors(p.content, set);
  }
  pageAnchors.set(`/artikel/${a.number}`, set);
}
for (const a of annexes) {
  const set = new Set<string>();
  collectAnchors(a.content, set);
  pageAnchors.set(`/bijlage/${a.roman.toLowerCase()}`, set);
}
for (const ref of allRefs) {
  const [page, fragment] = ref.href.split("#");
  const label = `${ref.where}: ref ${ref.href}`;
  if (page === "/") {
    assert.ok(fragment && chapterRomans.has(fragment.replace(/^hoofdstuk-/, "")), label);
  } else {
    const art = page.match(/^\/artikel\/(\d+)$/);
    const anx = page.match(/^\/bijlage\/([a-z]+)$/);
    const rct = page.match(/^\/overweging\/(\d+)$/);
    if (art) assert.ok(articleNums.has(art[1]), label);
    else if (anx) assert.ok(annexRomans.has(anx[1]), label);
    else if (rct) assert.ok(Number(rct[1]) >= 1 && Number(rct[1]) <= recitals.length, label);
    else assert.fail(label);
    if (fragment) assert.ok(pageAnchors.get(page)?.has(fragment), `${label} (anchor)`);
  }
  // offsets in bounds, slice looks like a reference
  assert.ok(
    ref.start >= 0 && ref.start < ref.end && ref.end <= ref.text.length,
    `${label} (offsets)`,
  );
  // every span reads as a reference: keyword/number, or a bare enumeration
  // continuation token ("c)" in "punten b) en c)", "V" in "hoofdstukken I en V")
  assert.ok(
    /artikel|bijlage|hoofdstuk|lid|punt|\d|^[a-z]{1,2}\)$|^[IVX]+$/.test(
      ref.text.slice(ref.start, ref.end),
    ),
    `${label} (span text "${ref.text.slice(ref.start, ref.end)}")`,
  );
}

// negative spot checks: references to other instruments stay unannotated
const rct38 = recitals[37].paragraphs.find((p) => p.text.includes("artikel 16 VWEU"));
assert.ok(rct38, "recital 38 mentions artikel 16 VWEU");
assert.ok(
  !(rct38.refs ?? []).some((r) => rct38.text.slice(r.start, r.end).includes("artikel 16")),
  "recital 38: artikel 16 VWEU not annotated",
);
assert.equal(
  allRefs.filter((r) => /Protocol nr\./.test(r.text.slice(r.end, r.end + 30))).length,
  0,
  "refs into treaty Protocols not annotated",
);
const gdprRefs = allRefs.filter(
  (r) =>
    r.where === "artikel 3" &&
    r.text.slice(r.end).trimStart().startsWith(", van Verordening (EU) 2016/679"),
);
assert.equal(gdprRefs.length, 0, "art 3: refs into GDPR not annotated");
// conjunction distribution: recital 140 cites only GDPR/2016/680 articles
assert.ok(
  recitals[139].paragraphs.every((p) => (p.refs ?? []).length === 0),
  "recital 140: conjunct refs into GDPR/Richtlijn 2016/680 not annotated",
);
assert.ok(
  articles[2].paragraphs.some((p) =>
    flatten(p.content).includes("artikel 4, punt 1, van Verordening (EU) 2016/679"),
  ),
  "art 3 mentions the GDPR definition ref",
);
assert.equal(
  allRefs.filter((r) => /^artikel (10[2-9]|110)$/.test(r.where)).length,
  0,
  "amendment articles 102-110 carry no bare-ref annotations",
);

// positive spot checks
assert.ok(
  allRefs.some((r) => r.where === "artikel 6" && r.href === "/bijlage/i"),
  "art 6 links bijlage I",
);
const rangeRefs = allRefs.filter(
  (r) => r.where === "artikel 2" && r.text.includes("artikelen 102 tot en met 109"),
);
assert.ok(
  rangeRefs.some((r) => r.href === "/artikel/102") && rangeRefs.some((r) => r.href === "/artikel/109"),
  "tot-en-met range links both endpoints",
);
assert.ok(
  allRefs.some((r) => r.href.startsWith("/#hoofdstuk-")),
  "chapter refs link homepage anchors",
);
assert.ok(
  allRefs.some((r) => /#lid-\d+-[a-z]/.test(r.href)),
  "lid+punt refs carry combined anchors",
);

console.log("verify-data: all assertions passed");
