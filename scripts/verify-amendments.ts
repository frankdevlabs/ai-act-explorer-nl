/**
 * Assertions over the amendment layer (digitale omnibus PE-CONS 30/26).
 * Runs after verify-data.ts in `npm run verify`.
 *
 * Two regimes, keyed on source meta.complete:
 * - while false (transcription in progress): structural checks only — anchor
 *   resolution, diff invariant, collisions, boundary guard, plus verbatim
 *   spot checks for instructions already transcribed;
 * - once true: additionally pin the exact instruction count and the exact
 *   affected-article set (filled in when transcription finishes).
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { flattenNodes } from "../src/lib/flatten";
import type {
  AmendmentDiffs,
  AmendmentsGenerated,
  AmendmentsSource,
  Annex,
  Article,
  ContentNode,
  Recital,
  SearchDoc,
  Toc,
} from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const source = load<AmendmentsSource>("data/source/amendments/pe-cons-30-26.json");
const generated = load<AmendmentsGenerated>("data/generated/amendments.json");
const diffs = load<AmendmentDiffs>("data/generated/amendment-diffs.json");
const searchDocs = load<SearchDoc[]>("public/amendment-search-docs.json");
const articles = load<Article[]>("data/generated/articles.json");
const annexes = load<Annex[]>("data/generated/annexes.json");
const recitals = load<Recital[]>("data/generated/recitals.json");
const toc = load<Toc>("data/generated/toc.json");

// Pinned at transcription completion: 43 numbered instructions in Article 1
// of PE-CONS 30/26 = 76 entries including sub-instructions.
const EXPECTED: { instructions: number | null; affectedArticles: string[] | null } = {
  instructions: 76,
  affectedArticles: [
    "1", "2", "3", "4", "5", "6", "10", "11", "17", "25", "27", "28", "29", "30",
    "40", "42", "43", "50", "56", "57", "58", "60", "63", "64", "69", "70", "72",
    "75", "76", "77", "95", "96", "97", "99", "111", "113",
  ],
};

const amendments = source.amendments;
const id = (a: (typeof amendments)[number]) => `${a.seq}${a.sub ?? ""}`;

// generated mirrors source
assert.deepEqual(generated.amendments, amendments, "generated amendments mirror source");
assert.equal(generated.meta.complete, source.meta.complete, "meta.complete mirrors source");

// ------------------------------------------------- anchor resolution

function articleAnchors(a: Article): Set<string> {
  const anchors = new Set<string>();
  for (const p of a.paragraphs) {
    anchors.add(p.anchor);
    for (const node of p.content)
      if (node.type === "list")
        for (const item of node.items) if (item.anchor) anchors.add(item.anchor);
  }
  return anchors;
}

function annexAnchors(a: Annex): Set<string> {
  const anchors = new Set<string>(["inhoud"]);
  const walk = (nodes: ContentNode[]) => {
    for (const node of nodes)
      if (node.type === "list")
        for (const item of node.items) {
          if (item.anchor) anchors.add(item.anchor);
          walk(item.content);
        }
  };
  walk(a.content);
  return anchors;
}

const baseNumbers = new Set(articles.map((a) => String(a.number)));
const baseRomans = new Set(annexes.map((a) => a.roman.toLowerCase()));

for (const am of amendments) {
  const ctx = `instruction ${id(am)}`;
  if (am.newArticle) {
    assert.match(am.newArticle.slug, /^\d+(bis|ter|quater|quinquies)$/, `${ctx} slug`);
    assert.ok(!baseNumbers.has(am.newArticle.slug), `${ctx} slug collides with base article`);
    assert.ok(baseNumbers.has(String(am.newArticle.insertAfter)), `${ctx} insertAfter exists`);
    continue;
  }
  if (am.newAnnex) {
    assert.ok(!baseRomans.has(am.newAnnex.roman.toLowerCase()), `${ctx} annex roman collides`);
    continue;
  }
  // boundary guard: every scoped instruction targets the base 2024/1689 corpus
  // (articles 1-113 or annexes I-XIII) or an already-declared new article.
  if (am.target.article) {
    const t = am.target.article;
    const isBase = baseNumbers.has(t);
    const isNew = amendments.some((x) => x.newArticle?.slug === t);
    assert.ok(isBase || isNew, `${ctx}: target article ${t} outside base corpus`);
    if (isBase && am.scope.anchor && !am.scope.wholeArticle) {
      const a = articles.find((x) => String(x.number) === t)!;
      const anchors = articleAnchors(a);
      const anchor = am.scope.anchor;
      const resolves =
        anchors.has(anchor) ||
        (anchor.endsWith("-aanhef") && anchors.has(anchor.slice(0, -"-aanhef".length)));
      assert.ok(resolves, `${ctx}: anchor ${anchor} does not resolve in artikel ${t}`);
      if (am.operation === "delete")
        assert.ok(anchors.has(anchor), `${ctx}: delete must target an existing anchor`);
    }
  }
  if (am.target.annex) {
    const roman = am.target.annex.toLowerCase();
    const isBase = baseRomans.has(roman);
    const isNew = amendments.some((x) => x.newAnnex?.roman.toLowerCase() === roman);
    assert.ok(isBase || isNew, `${ctx}: target annex ${am.target.annex} outside base corpus`);
    if (isBase && am.scope.anchor) {
      const a = annexes.find((x) => x.roman.toLowerCase() === roman)!;
      assert.ok(
        annexAnchors(a).has(am.scope.anchor),
        `${ctx}: anchor ${am.scope.anchor} does not resolve in bijlage ${am.target.annex}`,
      );
    }
  }
}

// ------------------------------------------------- diff invariant

function checkDiffList(key: string, kind: "article" | "annex") {
  const list = kind === "article" ? diffs.articles[key] : diffs.annexes[key];
  const base =
    kind === "article"
      ? articles.find((a) => String(a.number) === key)
      : undefined;
  const baseAnnex = kind === "annex" ? annexes.find((a) => a.roman.toLowerCase() === key) : undefined;
  const oldFlatByAnchor = new Map<string, string>();
  if (base) for (const p of base.paragraphs) oldFlatByAnchor.set(p.anchor, flattenNodes(p.content));
  if (baseAnnex) oldFlatByAnchor.set("inhoud", flattenNodes(baseAnnex.content));

  for (const p of list) {
    const ctx = `${kind} ${key} ${p.anchor}`;
    if (p.status === "unchanged") {
      assert.ok(!p.segments && !p.newContent, `${ctx}: unchanged carries no payload`);
      continue;
    }
    assert.ok(p.segments && p.segments.length > 0, `${ctx}: segments required`);
    assert.ok(
      p.segments!.some((s) => s.op !== "eq"),
      `${ctx}: ${p.status} but no ins/del segment`,
    );
    const reOld = p.segments!.filter((s) => s.op !== "ins").map((s) => s.text).join("");
    const reNew = p.segments!.filter((s) => s.op !== "del").map((s) => s.text).join("");
    if (p.status === "inserted") {
      assert.equal(reOld, "", `${ctx}: inserted reconstructs empty old`);
      assert.ok(p.newContent, `${ctx}: inserted needs newContent`);
      assert.equal(reNew, flattenNodes(p.newContent!), `${ctx}: ins text === flatten(newContent)`);
    } else if (p.status === "deleted") {
      assert.equal(reNew, "", `${ctx}: deleted reconstructs empty new`);
      assert.equal(reOld, oldFlatByAnchor.get(p.anchor), `${ctx}: del text === flatten(old)`);
    } else {
      assert.equal(reOld, oldFlatByAnchor.get(p.anchor), `${ctx}: eq+del reconstructs old`);
      assert.ok(p.newContent, `${ctx}: modified needs newContent`);
      assert.equal(reNew, flattenNodes(p.newContent!), `${ctx}: eq+ins reconstructs new`);
    }
  }
  // every base paragraph accounted for, in-order superset
  if (base) {
    const anchorsInDiff = list.map((p) => p.anchor);
    for (const p of base.paragraphs)
      assert.ok(anchorsInDiff.includes(p.anchor), `${kind} ${key}: base ${p.anchor} missing from diff`);
  }
}

for (const key of Object.keys(diffs.articles)) checkDiffList(key, "article");
for (const key of Object.keys(diffs.annexes)) checkDiffList(key, "annex");

// every replace instruction produced at least one ins/del somewhere
for (const am of amendments) {
  if (am.operation !== "replace" || am.newArticle || am.newAnnex || am.scope.title) continue;
  const key = am.target.article ?? am.target.annex!.toLowerCase();
  const list = am.target.article ? diffs.articles[key] : diffs.annexes[key];
  assert.ok(
    list?.some((p) => p.seq.includes(am.seq) && p.segments?.some((s) => s.op !== "eq")),
    `instruction ${id(am)}: replace produced no visible change`,
  );
}

// ------------------------------------------------- verbatim spot checks
// (active as soon as the relevant instruction is transcribed)

const flatNew = (key: string) =>
  (diffs.articles[key] ?? [])
    .map((p) => (p.newContent ? flattenNodes(p.newContent) : ""))
    .join(" ");

if (diffs.articles["1"])
  assert.ok(
    flatNew("1").includes("kleine midcapondernemingen"),
    "spot check: artikel 1 amended text mentions kleine midcapondernemingen",
  );
if (diffs.articles["2"]?.some((p) => p.status === "inserted"))
  assert.ok(
    flatNew("2").includes("Uiterlijk op 2 augustus 2027"),
    "spot check: artikel 2 inserted lid mentions 2 augustus 2027",
  );
const art4bis = generated.newArticles.find((n) => n.slug === "4bis");
if (art4bis) assert.equal(art4bis.displayNumber, "4 bis", "spot check: Artikel 4 bis display number");

// search docs shape
for (const d of searchDocs) {
  assert.ok(d.id.startsWith("omnibus-"), `search doc ${d.id} id prefix`);
  assert.ok(d.text.length > 0, `search doc ${d.id} has text`);
}

// ------------------------------------------------- cross-references
// The parser is the single authority: the transcription must not carry
// hand-curated refs, and every generated ref (newContent + new articles/
// annexes + diff segments) must resolve, stay in bounds, and read as a
// reference. Mirrors verify-data's block, extended with the pages/anchors
// the omnibus itself adds.

function assertNoSourceRefs(nodes: ContentNode[], where: string): void {
  for (const n of nodes) {
    if (n.type === "text")
      assert.ok(!("refs" in n), `${where}: hand-curated refs in transcription (parser generates them)`);
    else if (n.type === "list") for (const i of n.items) assertNoSourceRefs(i.content, where);
  }
}
for (const am of amendments) {
  const where = `instruction ${id(am)}`;
  if (am.newContent) assertNoSourceRefs(am.newContent, where);
  for (const p of am.newParagraphs ?? []) assertNoSourceRefs(p.content, where);
  for (const it of am.newItems ?? []) assertNoSourceRefs(it.content, where);
  for (const p of am.newArticle?.paragraphs ?? []) assertNoSourceRefs(p.content, where);
  if (am.newAnnex) assertNoSourceRefs(am.newAnnex.content, where);
}

// page → anchor sets: base corpus ∪ omnibus additions
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
for (const a of articles) pageAnchors.set(`/artikel/${a.number}`, articleAnchors(a));
for (const a of annexes) pageAnchors.set(`/bijlage/${a.roman.toLowerCase()}`, annexAnchors(a));
for (const na of generated.newArticles) {
  const set = new Set<string>();
  for (const p of na.paragraphs) {
    set.add(p.anchor);
    collectAnchors(p.content, set);
  }
  pageAnchors.set(`/artikel/${na.slug}`, set);
}
for (const na of generated.newAnnexes) {
  const set = new Set<string>(["inhoud"]);
  collectAnchors(na.content, set);
  pageAnchors.set(`/bijlage/${na.roman.toLowerCase()}`, set);
}
for (const [key, list] of Object.entries(diffs.articles)) {
  const set = pageAnchors.get(`/artikel/${key}`)!;
  for (const p of list) {
    set.add(p.anchor);
    if (p.newContent) collectAnchors(p.newContent, set);
  }
}
for (const [roman, list] of Object.entries(diffs.annexes)) {
  const set = pageAnchors.get(`/bijlage/${roman}`)!;
  for (const p of list) if (p.newContent) collectAnchors(p.newContent, set);
}
const chapterRomans = new Set(toc.chapters.map((c) => c.roman.toLowerCase()));
const recitalNumbers = new Set(recitals.map((r) => String(r.number)));

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
for (const na of generated.newArticles)
  for (const p of na.paragraphs) collectRefs(p.content, `artikel ${na.slug}`);
for (const na of generated.newAnnexes) collectRefs(na.content, `bijlage ${na.roman}`);
for (const [kind, lists] of [
  ["artikel", diffs.articles],
  ["bijlage", diffs.annexes],
] as const) {
  for (const [key, list] of Object.entries(lists)) {
    for (const p of list) {
      const where = `${kind} ${key} ${p.anchor}`;
      if (p.newContent) collectRefs(p.newContent, where);
      if (!p.segments) continue;
      // segment refs are clips of spans over the whole new text: rebuild the
      // global text and offsets, re-merge touching same-href clips, and check
      // the merged span (a lone clip fragment can be pure punctuation)
      const newFlat = p.segments.filter((s) => s.op !== "del").map((s) => s.text).join("");
      const merged: FlatRef[] = [];
      let off = 0;
      for (const s of p.segments) {
        if (s.op === "del") {
          assert.ok(!s.refs, `${where}: del segment carries refs`);
          continue;
        }
        for (const r of s.refs ?? []) {
          assert.ok(
            r.start >= 0 && r.start < r.end && r.end <= s.text.length,
            `${where}: segment ref offsets out of bounds (${r.href})`,
          );
          const g = { where, text: newFlat, start: off + r.start, end: off + r.end, href: r.href };
          const prev = merged[merged.length - 1];
          if (prev && prev.href === g.href && prev.end === g.start) prev.end = g.end;
          else merged.push(g);
        }
        off += s.text.length;
      }
      allRefs.push(...merged);
    }
  }
}

for (const ref of allRefs) {
  const [page, fragment] = ref.href.split("#");
  const label = `${ref.where}: ref ${ref.href}`;
  if (page === "/") {
    assert.ok(fragment && chapterRomans.has(fragment.replace(/^hoofdstuk-/, "")), label);
  } else {
    const rct = page.match(/^\/overweging\/(\d+)$/);
    if (rct) assert.ok(recitalNumbers.has(rct[1]), label);
    else {
      const anchors = pageAnchors.get(page);
      assert.ok(anchors, label);
      if (fragment) assert.ok(anchors!.has(fragment), `${label} (anchor)`);
    }
  }
  assert.ok(
    ref.start >= 0 && ref.start < ref.end && ref.end <= ref.text.length,
    `${label} (offsets)`,
  );
  // every (re-merged) span reads as a reference; flattened segment text also
  // contains list markers ("a) …"), so this guards against marker misparses
  assert.ok(
    /artikel|bijlage|hoofdstuk|lid|punt|\d|^[a-z]{1,2}\)$|^[IVX]+$/.test(
      ref.text.slice(ref.start, ref.end),
    ),
    `${label} (span text "${ref.text.slice(ref.start, ref.end)}")`,
  );
}

// spot check: the omnibus text references its own inserted articles
assert.ok(
  allRefs.some((r) => r.href === "/artikel/75ter"),
  "amendment layer links artikel 75 ter",
);

// ------------------------------------------------- completeness pin

if (source.meta.complete) {
  assert.ok(
    EXPECTED.instructions !== null && EXPECTED.affectedArticles !== null,
    "meta.complete is true — pin EXPECTED counts in verify-amendments.ts",
  );
  assert.equal(amendments.length, EXPECTED.instructions, "exact instruction count");
  assert.deepEqual(
    Object.keys(diffs.articles).sort((a, b) => Number(a) - Number(b)),
    EXPECTED.affectedArticles,
    "exact affected-article set",
  );
  assert.deepEqual(
    generated.newArticles.map((n) => n.slug).sort(),
    ["4bis", "60bis", "75bis", "75quater", "75quinquies", "75ter"],
    "exact new-article set",
  );
  assert.deepEqual(Object.keys(diffs.annexes).sort(), ["i", "viii"], "exact amended-annex set");
  assert.deepEqual(
    generated.newAnnexes.map((n) => n.roman),
    ["XIV"],
    "exact new-annex set",
  );
  assert.equal(Math.max(...amendments.map((a) => a.seq)), 43, "43 numbered instructions");
  // exact snapshot (clips re-merged): grammar changes must consciously update
  // this (462 → 460 when instrument qualifiers learned to distribute over
  // conjunctions: two "artikel 14, lid 4, en/of artikel 16, lid 3, van
  // Verordening (EU) 2019/1020" false positives dropped)
  assert.equal(allRefs.length, 460, `amendment cross-reference count (got ${allRefs.length})`);
}

console.log(
  `verify-amendments: all assertions passed ` +
    `(${amendments.length} instructions, complete=${source.meta.complete})`,
);
