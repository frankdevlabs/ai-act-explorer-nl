/** Completeness assertions over data/generated/*.json; runs before every build. */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Annex, Article, ContentNode, Recital, SearchDoc, Toc } from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(name: string): T =>
  JSON.parse(readFileSync(join(root, "data/generated", name), "utf-8"));

const articles = load<Article[]>("articles.json");
const recitals = load<Recital[]>("recitals.json");
const annexes = load<Annex[]>("annexes.json");
const toc = load<Toc>("toc.json");
const searchDocs = load<SearchDoc[]>("search-docs.json");

function flatten(nodes: ContentNode[]): string {
  return nodes
    .map((n) =>
      n.type === "list"
        ? n.items.map((i) => `${i.marker} ${flatten(i.content)}`).join(" ")
        : n.text,
    )
    .join(" ");
}

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
  assert.ok(r.paragraphs.join(" ").length > 40, `recital ${r.number} body`);
for (const a of annexes) {
  assert.ok(a.title.length > 5 && !/^BIJLAGE/.test(a.title), `annex ${a.roman} title`);
  assert.ok(flatten(a.content).length > 200, `annex ${a.roman} body`);
}

// corpus size + search docs
const corpus =
  articles.map((a) => a.paragraphs.map((p) => flatten(p.content)).join(" ")).join(" ") +
  recitals.map((r) => r.paragraphs.join(" ")).join(" ") +
  annexes.map((a) => flatten(a.content)).join(" ");
assert.ok(corpus.length > 500_000, `corpus ${corpus.length} chars`);
assert.ok(searchDocs.length > 700, `search docs ${searchDocs.length}`);
assert.equal(new Set(searchDocs.map((d) => d.id)).size, searchDocs.length, "search doc ids unique");
for (const d of searchDocs) assert.ok(d.text.trim().length > 0, `empty search doc ${d.id}`);

// spot checks against the OJ text
const art3 = flatten(articles[2].paragraphs[0].content);
assert.ok(art3.includes("op een machine gebaseerd systeem"), "art 3 punt 1 AI-systeem definition");
const art5 = flatten(articles[4].paragraphs[0].content);
assert.ok(art5.includes("subliminale technieken"), "art 5 lid 1 a");
assert.equal(articles[4].title, "Verboden AI-praktijken", "art 5 title");
assert.ok(flatten(articles[112].paragraphs[0].content).includes("2 augustus 2026"), "art 113");
assert.ok(recitals[0].paragraphs[0].includes("betrouwbare artificiële intelligentie"), "recital 1");
assert.ok(recitals[179].paragraphs[0].includes("Europese Toezichthouder"), "recital 180");
const anx3 = annexes[2];
assert.ok(anx3.title.includes("artikel 6, lid 2"), "annex III title");
assert.ok(
  anx3.content.some(
    (n) => n.type === "list" && n.items.some((i) => i.content.some((c) => c.type === "list")),
  ),
  "annex III nested points",
);
// the only article embedding an oj-note footnote in the OJ source is art. 108
assert.ok(articles[107].footnotes.length === 1, "art 108 footnote");

console.log("verify-data: all assertions passed");
