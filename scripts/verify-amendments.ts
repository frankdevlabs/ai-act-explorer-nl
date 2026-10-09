/**
 * Assertions over the change layer of the in-force amending act
 * (Verordening (EU) 2026/1744). Runs after verify-data.ts in `npm run verify`.
 *
 * The layer is re-derived from the EUR-Lex sources (data/source/corpus.json)
 * and checked against what parse-amendments.ts wrote, then against three
 * independent signals that must agree:
 *   (a) the diff reconstructs both versions byte-exact;
 *   (b) EUR-Lex's own ▼M1 block markers in the current consolidation cover
 *       exactly the changed set (allowlist below, each entry explained);
 *   (c) every quoted new-text block of the act's instructions is contained in
 *       the current text of its target and (if substantial) absent from the
 *       previous one; struck targets are repealed;
 *   (d) every instruction changed something and every change has an instruction.
 * Pins (instruction counts, target sets, tables, refs, search docs) follow the
 * audit-then-pin protocol in docs/ARCHITECTURE.md ("Verify script").
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AmendmentDiffs,
  AmendmentsGenerated,
  Annex,
  Article,
  ContentNode,
  Recital,
  SearchDoc,
  Toc,
} from "../src/lib/types";
import { addDays, parseAmendingAct } from "./lib/oj-instructions";
import { diffCorpora, diffText, resolveInstruction } from "./lib/change-layer";
import { parseConsolidated } from "./lib/consolidated";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));
const source = (rel: string) => readFileSync(join(root, "data/source", rel), "utf-8");

const corpus = load<{
  base: { celex: string; file: string };
  previous: { celex: string; file: string };
  amending: { celex: string; file: string };
}>("data/source/corpus.json");
const generated = load<AmendmentsGenerated>("data/generated/amendments.json");
const diffs = load<AmendmentDiffs>("data/generated/amendment-diffs.json");
const searchDocs = load<SearchDoc[]>("public/amendment-search-docs.json");
const articles = load<Article[]>("data/generated/articles.json");
const annexes = load<Annex[]>("data/generated/annexes.json");
const recitals = load<Recital[]>("data/generated/recitals.json");
const toc = load<Toc>("data/generated/toc.json");

const previous = parseConsolidated(source(corpus.previous.file));
const current = parseConsolidated(source(corpus.base.file));
const act = parseAmendingAct(source(corpus.amending.file), corpus.amending.celex);
const base = { articles, annexes };
const reDiff = diffCorpora(previous, base);
const instructions = act.instructions.map((i) => resolveInstruction(i, previous, base));

// ------------------------------------------------- pins (audited 2026-10-09)

const EXPECTED = {
  // Article 1 of Vo 2026/1744: 43 numbered instructions, 72 leaf instructions
  // (the PE-CONS 30/26 transcription split 32 into 32a–d and 37a into a1/a2: 76)
  instructions: 43,
  leaves: 72,
  amendedArticles: [
    "1", "2", "3", "4", "5", "6", "10", "11", "17", "25", "27", "28", "29", "30",
    "40", "42", "43", "50", "56", "57", "58", "60", "63", "64", "69", "70", "72",
    "75", "76", "77", "95", "96", "97", "99", "111", "113",
  ],
  newArticles: ["4bis", "60bis", "75bis", "75ter", "75quater", "75quinquies"],
  amendedAnnexes: ["i", "viii"],
  newAnnexes: ["XIV"],
  titleChanges: ["75", "77"],
  // bijlage XIV: rows × columns of its six code tables
  xivTables: ["12x2", "4x2", "2x2", "6x2", "2x2", "2x2"],
  // 46 = overview + 36 amended + 6 inserted articles + 2 amended + 1 added annex
  searchDocs: 46,
  // refs in diff segments (eq/ins clips re-merged)
  refs: 207,
};

/** ▼M1 marker positions that are not changes, with the reason. */
const PROVENANCE_ALLOWLIST: Record<string, string> = {
  "article 4 titel": "instructie 5) vervangt artikel 4 in zijn geheel en herhaalt daarbij de ongewijzigde titel",
};
/** Previous-version paragraph anchors that legitimately no longer exist. */
const ANCHOR_ALLOWLIST: Record<string, string> = {
  "4 inhoud": "artikel 4 was één ongenummerde alinea; instructie 5) vervangt het door leden 1–3",
};

// ------------------------------------------------- generated mirrors sources

assert.equal(generated.meta.celex, act.celex, "meta.celex");
assert.equal(generated.meta.document, act.document, "meta.document");
assert.equal(generated.meta.ojRef, act.ojRef, "meta.ojRef");
assert.equal(generated.meta.adopted, act.adopted, "meta.adopted");
assert.equal(generated.meta.published, act.published, "meta.published");
assert.equal(generated.meta.inForce, act.inForce, "meta.inForce");
assert.equal(generated.meta.previous, corpus.previous.celex, "meta.previous");
assert.equal(generated.meta.current, corpus.base.celex, "meta.current");
assert.deepEqual(
  generated.amendments.map((a) => [a.id, a.intro, a.parentIntro ?? null, a.operation, a.targets]),
  instructions.map((i) => [i.id, i.intro, i.parentIntro ?? null, i.operation, i.targets]),
  "generated instructions mirror the OJ text",
);
const statusSet = (list: { anchor: string; status: string }[]) =>
  list.filter((p) => p.status !== "unchanged").map((p) => `${p.anchor}:${p.status}`);
for (const kind of ["articles", "annexes"] as const) {
  assert.deepEqual(Object.keys(diffs[kind]).sort(), Object.keys(reDiff[kind]).sort(), `${kind} with diffs`);
  for (const [key, list] of Object.entries(reDiff[kind]))
    assert.deepEqual(statusSet(diffs[kind][key]), statusSet(list), `${kind} ${key}: paragraph statuses`);
}

// ------------------------------------------------- (g) act metadata

assert.equal(act.topLevelCount, EXPECTED.instructions, "numbered instructions in Article 1");
assert.equal(act.instructions.length, EXPECTED.leaves, "leaf instructions");
assert.equal(act.inForce, addDays(act.published, act.inForceDays), "in force = publication + n days");
const m = corpus.base.celex.match(/-(\d{4})(\d{2})(\d{2})$/)!;
assert.equal(act.inForce, `${m[1]}-${m[2]}-${m[3]}`, "base consolidation date = entry into force");
// the only amending act marked in the base consolidation is this one
const markedActs = new Set(
  current.provenance.map((p) => p.celex).filter((c) => /^3\d{4}R\d{4}$/.test(c) && c !== "32024R1689"),
);
assert.deepEqual([...markedActs], [act.celex], "amending acts marked in the base consolidation");
assert.ok(
  previous.provenance.every((p) => p.celex !== act.celex),
  "previous consolidation predates the act",
);

// ------------------------------------------------- pinned target sets

assert.deepEqual(Object.keys(diffs.articles).sort(), [...EXPECTED.amendedArticles].sort(), "amended articles");
assert.deepEqual(generated.newArticles.map((a) => a.slug), EXPECTED.newArticles, "inserted articles");
assert.deepEqual(Object.keys(diffs.annexes).sort(), EXPECTED.amendedAnnexes, "amended annexes");
assert.deepEqual(generated.newAnnexes.map((a) => a.roman), EXPECTED.newAnnexes, "added annexes");
assert.deepEqual(Object.keys(generated.titleChanges).sort(), EXPECTED.titleChanges, "replaced titles");
for (const n of generated.newArticles) {
  const a = articles.find((x) => x.slug === n.slug);
  assert.ok(a && a.displayNumber === n.displayNumber && a.title === n.title, `new article ${n.slug} in base`);
  assert.ok(articles.some((x) => x.slug === String(n.insertAfter)), `new article ${n.slug} insertAfter`);
}
const tables: string[] = [];
for (const a of annexes) {
  const walk = (nodes: ContentNode[]) => {
    for (const n of nodes) {
      if (n.type === "table") {
        assert.equal(a.roman, "XIV", `data table outside bijlage XIV (bijlage ${a.roman})`);
        tables.push(`${n.rows.length}x${n.rows[0].length}`);
      } else if (n.type === "list") n.items.forEach((i) => walk(i.content));
    }
  };
  walk(a.content);
}
for (const a of articles)
  for (const p of a.paragraphs)
    assert.ok(!JSON.stringify(p.content).includes('"type":"table"'), `data table in artikel ${a.slug}`);
assert.deepEqual(tables, EXPECTED.xivTables, "bijlage XIV tables");

// ------------------------------------------------- (a) diff invariant

const joinOps = (segments: { op: string; text: string }[], skip: string) =>
  segments.filter((s) => s.op !== skip).map((s) => s.text).join("");
for (const [kind, lists] of [
  ["articles", reDiff.articles],
  ["annexes", reDiff.annexes],
] as const) {
  for (const [key, list] of Object.entries(lists)) {
    const gen = diffs[kind][key];
    for (const change of list) {
      const where = `${kind} ${key} ${change.anchor}`;
      const d = gen.find((p) => p.anchor === change.anchor)!;
      if (change.status === "unchanged") {
        assert.ok(!d.segments, `${where}: unchanged paragraph carries segments`);
        continue;
      }
      assert.ok(d.segments?.length, `${where}: changed paragraph without segments`);
      if (change.old) assert.equal(joinOps(d.segments!, "ins"), diffText(change.old), `${where}: old text`);
      else assert.ok(d.segments!.every((s) => s.op === "ins"), `${where}: inserted paragraph`);
      if (change.next && change.status !== "deleted")
        assert.equal(joinOps(d.segments!, "del"), diffText(change.next), `${where}: new text`);
      else assert.ok(d.segments!.every((s) => s.op === "del"), `${where}: deleted paragraph`);
      if (change.status === "modified")
        assert.ok(d.segments!.some((s) => s.op !== "eq"), `${where}: modified without a visible change`);
    }
  }
}

// ------------------------------------------------- (d) attribution

const changedKeys = new Set<string>();
for (const [slug, list] of Object.entries(diffs.articles))
  for (const p of list) {
    if (p.status === "unchanged") {
      assert.deepEqual(p.ids, [], `artikel ${slug} ${p.anchor}: unchanged paragraph attributed`);
      continue;
    }
    changedKeys.add(`article ${slug} ${p.anchor}`);
    assert.ok(p.ids.length > 0, `artikel ${slug} ${p.anchor}: change without an instruction`);
  }
for (const [roman, list] of Object.entries(diffs.annexes))
  for (const p of list) {
    changedKeys.add(`annex ${roman} ${p.anchor}`);
    assert.ok(p.ids.length > 0, `bijlage ${roman}: change without an instruction`);
  }
for (const [slug, t] of Object.entries(generated.titleChanges)) {
  changedKeys.add(`article ${slug} titel`);
  assert.ok(t.ids.length > 0, `artikel ${slug}: title change without an instruction`);
}
const ids = new Set(generated.amendments.map((a) => a.id));
for (const list of [...Object.values(diffs.articles), ...Object.values(diffs.annexes)])
  for (const p of list) for (const id of p.ids) assert.ok(ids.has(id), `unknown instruction id ${id}`);
for (const a of generated.amendments) {
  const touched = a.targets.some((t) =>
    t.inserted ? true : t.anchors.some((anchor) => changedKeys.has(`${t.kind} ${t.slug} ${anchor}`)),
  );
  assert.ok(touched, `instructie ${a.id} ("${a.intro}") changed nothing`);
}

// ------------------------------------------------- (b) ▼M1 provenance ⇔ changes

const newTargets = new Set([
  ...generated.newArticles.map((a) => `article ${a.slug}`),
  ...generated.newAnnexes.map((a) => `annex ${a.roman.toLowerCase()}`),
]);
const provenance = new Set(
  current.provenance.filter((p) => p.celex === act.celex).map((p) => `${p.kind} ${p.slug} ${p.anchor}`),
);
for (const key of provenance) {
  const target = key.split(" ").slice(0, 2).join(" ");
  if (newTargets.has(target) || changedKeys.has(key)) continue;
  assert.ok(key in PROVENANCE_ALLOWLIST, `▼M1 text without a change: ${key}`);
}
for (const key of changedKeys) {
  if (provenance.has(key)) continue;
  // a paragraph the act removed without a placeholder: the article it sat in
  // must have been replaced as a whole (all of its current text under ▼M1)
  const [kind, slug, anchor] = key.split(" ");
  const p = diffs.articles[slug]?.find((x) => x.anchor === anchor);
  const whole =
    kind === "article" &&
    p?.status === "deleted" &&
    articles
      .find((a) => a.slug === slug)!
      .paragraphs.every((x) => provenance.has(`article ${slug} ${x.anchor}`));
  assert.ok(whole, `change without ▼M1 marker: ${key}`);
}
for (const key of newTargets)
  assert.ok([...provenance].some((p) => p.startsWith(`${key} `)), `inserted ${key} not under ▼M1`);

// ------------------------------------------------- (c) quoted text ⊂ new text

const norm = (s: string) => s.replace(/\(\*?\d+\)/g, "").replace(/[\s“”„"‘’']/g, "");
const targetText = (t: { kind: string; slug: string }, c: { articles: Article[]; annexes: Annex[] }) => {
  if (t.kind === "annex") {
    const a = c.annexes.find((x) => x.roman.toLowerCase() === t.slug);
    return a ? norm(`Bijlage ${a.roman} ${a.title} ${diffText(a.content)}`) : "";
  }
  const a = c.articles.find((x) => x.slug === t.slug);
  if (!a) return "";
  const lid = (p: Article["paragraphs"][number]) =>
    p.displayNumber ? `${p.displayNumber}. ` : p.number !== null ? `${p.number}. ` : "";
  return norm(`Artikel ${a.displayNumber} ${a.title} ${a.paragraphs.map((p) => lid(p) + diffText(p.content)).join(" ")}`);
};
let quotedBlocks = 0;
for (const ins of instructions) {
  const now = ins.targets.map((t) => targetText(t, base)).join(" ");
  const before = ins.targets.map((t) => targetText(t, previous)).join(" ");
  if (ins.operation === "delete") {
    assert.equal(ins.quoted.length, 0, `instructie ${ins.id}: deletion quotes text`);
    for (const t of ins.targets) {
      if (t.kind !== "article") continue;
      const a = articles.find((x) => x.slug === t.slug)!;
      for (const anchor of t.anchors)
        assert.equal(a.paragraphs.find((p) => p.anchor === anchor)?.repealed, true, `instructie ${ins.id}: ${t.slug} ${anchor} struck`);
    }
    continue;
  }
  assert.ok(ins.quoted.length > 0, `instructie ${ins.id}: no quoted text`);
  for (const q of ins.quoted) {
    const n = norm(q).replace(/[.;,]+$/, "");
    if (n.length < 3) continue; // a lone ";" closing the quotation
    quotedBlocks++;
    assert.ok(now.includes(n), `instructie ${ins.id}: quoted text not in the current text: ${q.slice(0, 80)}`);
    if (n.length > 40)
      assert.ok(!before.includes(n), `instructie ${ins.id}: quoted text already in the previous text: ${q.slice(0, 80)}`);
  }
}
assert.ok(quotedBlocks >= 80, `quoted blocks checked (${quotedBlocks})`);

// ------------------------------------------------- (e) anchor stability

for (const p of previous.articles) {
  const c = articles.find((a) => a.slug === p.slug)!;
  for (const para of p.paragraphs) {
    if (c.paragraphs.some((x) => x.anchor === para.anchor)) continue;
    assert.ok(`${p.slug} ${para.anchor}` in ANCHOR_ALLOWLIST, `artikel ${p.slug}#${para.anchor} disappeared`);
  }
}

// ------------------------------------------------- refs in diff segments

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
  pageAnchors.set(`/artikel/${a.slug}`, set);
}
for (const a of annexes) {
  const set = new Set<string>(["inhoud"]);
  collectAnchors(a.content, set);
  pageAnchors.set(`/bijlage/${a.roman.toLowerCase()}`, set);
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
for (const [kind, lists] of [
  ["artikel", diffs.articles],
  ["bijlage", diffs.annexes],
] as const) {
  for (const [key, list] of Object.entries(lists)) {
    for (const p of list) {
      if (!p.segments) continue;
      const where = `${kind} ${key} ${p.anchor}`;
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
          assert.ok(r.start >= 0 && r.start < r.end && r.end <= s.text.length, `${where}: segment ref offsets (${r.href})`);
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
    /artikel|bijlage|hoofdstuk|lid|punt|\d|^[a-z]{1,2}(?: (?:bis|ter|quater|quinquies))?\)$|^[IVX]+$/.test(
      ref.text.slice(ref.start, ref.end),
    ),
    `${label} (span text "${ref.text.slice(ref.start, ref.end)}")`,
  );
}
assert.ok(allRefs.some((r) => r.href === "/artikel/5#lid-1bis"), "diff links inserted lid 5(1 bis)");
// exact snapshot (clips re-merged): grammar or source changes must consciously
// update this (history: 462 → 460 → 464 over the PE-CONS 30/26 transcription;
// 464 → 207 when the layer was re-derived from the OJ text: inserted articles
// and bijlage XIV are base corpus now, their refs counted by verify-data)
assert.equal(allRefs.length, EXPECTED.refs, `change-layer cross-reference count (got ${allRefs.length})`);

// ------------------------------------------------- search docs (instruction wording only)

assert.equal(searchDocs.length, EXPECTED.searchDocs, `change-layer search docs (${searchDocs.length})`);
assert.equal(new Set(searchDocs.map((d) => d.id)).size, searchDocs.length, "search doc ids unique");
const composed = new Map(
  generated.amendments.map((a) => [a.id, a.parentIntro ? `${a.parentIntro} ${a.intro}` : a.intro]),
);
for (const d of searchDocs) {
  assert.ok(d.id.startsWith("wijz-"), `search doc id ${d.id}`);
  if (d.id === "wijz-overzicht") continue;
  const [, kind, slug] = d.id.match(/^wijz-(art|anx)-(.+)$/)!;
  const idList = (kind === "art" ? generated.byArticle : generated.byAnnex)[slug] ?? [];
  assert.equal(d.text, idList.map((id) => composed.get(id)).join(" "), `${d.id}: instruction wording only`);
  assert.ok(pageAnchors.has(d.url.split("?")[0]), `${d.id}: url ${d.url}`);
}

console.log(
  `verify-amendments: all assertions passed (${act.document}, ${EXPECTED.instructions} instructions / ` +
    `${EXPECTED.leaves} leaves, ${quotedBlocks} quoted blocks, ${allRefs.length} refs)`,
);
