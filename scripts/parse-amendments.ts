/**
 * Change layer of the in-force amending act -> data/generated/amendments.json
 * (instructions + indexes), amendment-diffs.json (word-level track changes per
 * changed article/annex) and public/amendment-search-docs.json.
 *
 * Derived from EUR-Lex sources only (data/source/corpus.json): WHAT changed is
 * the diff between the `previous` consolidated version and the base corpus
 * (data/generated, written by parse-aiact.ts — run that first); WHICH
 * instruction changed it, and the act's metadata, come from the OJ text of
 * the `amending` act. Library: scripts/lib/{change-layer,oj-instructions}.ts.
 * The diff invariant is asserted here and re-checked by verify-amendments.ts:
 * concat(eq+del) === old text and concat(eq+ins) === new text, byte-exact.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRefs, type RefContext } from "../src/lib/crossrefs";
import type {
  Amendment,
  AmendmentDiffs,
  AmendmentsGenerated,
  Annex,
  Article,
  ContentNode,
  ParagraphDiff,
  Recital,
  SearchDoc,
  Toc,
} from "../src/lib/types";
import { diffCorpora, paragraphSegments, resolveInstruction } from "./lib/change-layer";
import { parseConsolidated } from "./lib/consolidated";
import { parseAmendingAct } from "./lib/oj-instructions";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));
const source = (rel: string) => readFileSync(join(root, "data/source", rel), "utf-8");

const fail = (msg: string): never => {
  throw new Error(`parse-amendments: ${msg}`);
};

const corpus = load<{
  base: { celex: string };
  previous: { celex: string; file: string };
  amending: { celex: string; file: string };
}>("data/source/corpus.json");

const articles = load<Article[]>("data/generated/articles.json");
const annexes = load<Annex[]>("data/generated/annexes.json");
const recitals = load<Recital[]>("data/generated/recitals.json");
const toc = load<Toc>("data/generated/toc.json");
const base = { articles, annexes };
const previous = parseConsolidated(source(corpus.previous.file));
const act = parseAmendingAct(source(corpus.amending.file), corpus.amending.celex);

// the base must be the consolidation that the act's entry into force produced
const consolidated = corpus.base.celex.match(/-(\d{4})(\d{2})(\d{2})$/) ?? fail(`bad base CELEX ${corpus.base.celex}`);
if (act.inForce !== `${consolidated[1]}-${consolidated[2]}-${consolidated[3]}`)
  fail(`${act.document} enters into force ${act.inForce}, base is consolidated ${corpus.base.celex}`);

// ------------------------------------------------- diff + attribution

const diff = diffCorpora(previous, base);
const instructions = act.instructions.map((i) => resolveInstruction(i, previous, base));

const changedKeys = new Set<string>();
for (const [slug, list] of Object.entries(diff.articles))
  for (const c of list) if (c.status !== "unchanged") changedKeys.add(`article ${slug} ${c.anchor}`);
for (const slug of Object.keys(diff.titleChanges)) changedKeys.add(`article ${slug} titel`);
for (const roman of Object.keys(diff.annexes)) changedKeys.add(`annex ${roman} inhoud`);
const newKeys = new Set([
  ...diff.newArticles.map((a) => `article ${a.slug}`),
  ...diff.newAnnexes.map((a) => `annex ${a.roman.toLowerCase()}`),
]);

const idsByKey = new Map<string, string[]>();
const attribute = (key: string, id: string) => {
  const ids = idsByKey.get(key) ?? [];
  if (!ids.includes(id)) ids.push(id);
  idsByKey.set(key, ids);
};
for (const ins of instructions) {
  let changed = false;
  for (const t of ins.targets) {
    if (t.inserted) {
      if (!newKeys.has(`${t.kind} ${t.slug}`)) fail(`instruction ${ins.id}: ${t.slug} is not new`);
      attribute(`${t.kind} ${t.slug}`, ins.id);
      changed = true;
      continue;
    }
    for (const anchor of t.anchors) {
      const key = `${t.kind} ${t.slug} ${anchor}`;
      if (!changedKeys.has(key)) continue;
      attribute(key, ins.id);
      changed = true;
    }
  }
  if (!changed) fail(`instruction ${ins.id} ("${ins.intro}") changed nothing`);
}
for (const key of [...changedKeys, ...newKeys])
  if (!idsByKey.has(key)) fail(`change without an instruction: ${key}`);

// ------------------------------------------------- generated structures

const amendments: Amendment[] = instructions.map((i) => ({
  id: i.id,
  seq: i.seq,
  ...(i.sub ? { sub: i.sub } : {}),
  intro: i.intro,
  ...(i.parentIntro ? { parentIntro: i.parentIntro } : {}),
  operation: i.operation,
  targets: i.targets,
}));

const byArticle: Record<string, string[]> = {};
const byAnnex: Record<string, string[]> = {};
for (const i of instructions)
  for (const t of i.targets) {
    const list = ((t.kind === "article" ? byArticle : byAnnex)[t.slug] ??= []);
    if (!list.includes(i.id)) list.push(i.id);
  }

const diffs: AmendmentDiffs = { articles: {}, annexes: {} };
for (const [slug, list] of Object.entries(diff.articles)) {
  diffs.articles[slug] = list.map((c): ParagraphDiff => {
    const segments = paragraphSegments(c, `artikel ${slug} ${c.anchor}`);
    return {
      anchor: c.anchor,
      status: c.status,
      ...(c.displayNumber ? { displayNumber: c.displayNumber } : {}),
      ...(segments ? { segments } : {}),
      ids: idsByKey.get(`article ${slug} ${c.anchor}`) ?? [],
    };
  });
}
for (const [roman, list] of Object.entries(diff.annexes)) {
  diffs.annexes[roman] = list.map((c) => ({
    anchor: c.anchor,
    status: c.status,
    segments: paragraphSegments(c, `bijlage ${roman}`),
    ids: idsByKey.get(`annex ${roman} inhoud`) ?? [],
  }));
}

const isNewArticle = new Set(diff.newArticles.map((a) => a.slug));
const newArticles = diff.newArticles.map((a) => {
  // inserted after the nearest preceding article that already existed
  const idx = articles.findIndex((x) => x.slug === a.slug);
  const before = articles.slice(0, idx).reverse().find((x) => !isNewArticle.has(x.slug));
  return { slug: a.slug, displayNumber: a.displayNumber, title: a.title, insertAfter: before?.number ?? 0 };
});
const newAnnexes = diff.newAnnexes.map((a) => {
  const idx = annexes.findIndex((x) => x.roman === a.roman);
  return { roman: a.roman, title: a.title, insertAfter: annexes[idx - 1]?.roman ?? "" };
});

const titleChanges: AmendmentsGenerated["titleChanges"] = {};
for (const [slug, t] of Object.entries(diff.titleChanges))
  titleChanges[slug] = { ...t, ids: idsByKey.get(`article ${slug} titel`)! };

const orderedTargets: AmendmentsGenerated["orderedTargets"] = [
  ...articles
    .filter((a) => diffs.articles[a.slug] || titleChanges[a.slug] || isNewArticle.has(a.slug))
    .map((a) => ({ kind: "article" as const, slug: a.slug })),
  ...annexes
    .filter((a) => diffs.annexes[a.roman.toLowerCase()] || newAnnexes.some((n) => n.roman === a.roman))
    .map((a) => ({ kind: "annex" as const, slug: a.roman.toLowerCase() })),
];

const shortTitle = act.title.match(/\(([^()]+)\)$/)?.[1] ?? fail("act title has no short title");
const meta: AmendmentsGenerated["meta"] = {
  celex: act.celex,
  document: act.document,
  shortTitle: shortTitle.charAt(0).toLowerCase() + shortTitle.slice(1),
  title: act.title,
  eli: act.eli,
  ojRef: act.ojRef,
  adopted: act.adopted,
  published: act.published,
  inForce: act.inForce,
  previous: corpus.previous.celex,
  current: corpus.base.celex,
};

// ------------------------------------------------- cross-references in diff segments
// Same resolver semantics as parse-aiact's post-pass, validated against the
// base corpus (which now contains every inserted article, lid and point):
// unknown page target → throw, unknown or ambiguous fragment → strip.

const recitalNumbers = new Set(recitals.map((r) => String(r.number)));
const chapterRomans = new Set(toc.chapters.map((c) => c.roman.toLowerCase()));

function collectItemAnchors(nodes: ContentNode[], into: Set<string>): void {
  for (const n of nodes) {
    if (n.type !== "list") continue;
    for (const item of n.items) {
      if (item.anchor) into.add(item.anchor);
      collectItemAnchors(item.content, into);
    }
  }
}
const articleAnchors = new Map<string, Set<string>>();
for (const a of articles) {
  const set = new Set<string>();
  for (const p of a.paragraphs) {
    set.add(p.anchor);
    collectItemAnchors(p.content, set);
  }
  articleAnchors.set(a.slug, set);
}
const annexAnchors = new Map<string, Set<string>>();
for (const a of annexes) {
  const set = new Set<string>(["inhoud"]);
  collectItemAnchors(a.content, set);
  annexAnchors.set(a.roman.toLowerCase(), set);
}

function resolveRef(href: string, where: string): string {
  const [page, fragment] = href.split("#");
  if (page === "/") {
    const roman = fragment?.replace(/^hoofdstuk-/, "") ?? "";
    if (!chapterRomans.has(roman)) fail(`${where}: unresolvable chapter ref ${href}`);
    return href;
  }
  let anchors: Set<string> | undefined;
  const art = page.match(/^\/artikel\/([a-z0-9]+)$/);
  const anx = page.match(/^\/bijlage\/([a-z]+)$/);
  const rct = page.match(/^\/overweging\/(\d+)$/);
  if (art) anchors = articleAnchors.get(art[1]);
  else if (anx) anchors = annexAnchors.get(anx[1]);
  else if (!rct || !recitalNumbers.has(rct[1])) fail(`${where}: unresolvable cross-reference target ${href}`);
  if ((art || anx) && !anchors) fail(`${where}: unresolvable cross-reference target ${href}`);
  if (!fragment) return href;
  return anchors?.has(fragment) ? href : page;
}

let refCount = 0;
/** One findRefs run over a paragraph's new text, clipped onto the eq/ins
 *  segments each span crosses (offsets become segment-local). */
function annotateSegments(list: ParagraphDiff[], ctx: RefContext, selfHref: string, where: string): void {
  for (const p of list) {
    if (!p.segments || p.status === "deleted" || p.status === "unchanged") continue;
    const newFlat = p.segments.filter((s) => s.op !== "del").map((s) => s.text).join("");
    const refs = findRefs(newFlat, ctx)
      .map((r) => ({ ...r, href: resolveRef(r.href, `${where} ${p.anchor}`) }))
      .filter((r) => r.href !== selfHref);
    let off = 0;
    for (const s of p.segments) {
      if (s.op === "del") continue;
      const end = off + s.text.length;
      const local = refs
        .filter((r) => r.start < end && r.end > off)
        .map((r) => ({ start: Math.max(r.start, off) - off, end: Math.min(r.end, end) - off, href: r.href }));
      if (local.length > 0) {
        s.refs = local;
        refCount += local.length;
      }
      off = end;
    }
  }
}
for (const [slug, list] of Object.entries(diffs.articles)) {
  const a = articles.find((x) => x.slug === slug)!;
  annotateSegments(
    list,
    // amendment articles 102-110 quote text of other acts: only self-forms link
    { selfType: "artikel", selfRef: slug, linkBareRefs: !(a.number >= 102 && a.number <= 110) },
    `/artikel/${slug}`,
    `artikel ${a.displayNumber}`,
  );
}
for (const [roman, list] of Object.entries(diffs.annexes))
  annotateSegments(list, { selfType: "bijlage", selfRef: roman.toUpperCase() }, `/bijlage/${roman}`, `bijlage ${roman}`);

// ------------------------------------------------- search docs (change layer)
// Instruction wording only — never legal text: the law in force is indexed by
// parse-aiact.ts, and text the act struck is not law any more.

const composed = (i: Amendment) => (i.parentIntro ? `${i.parentIntro} ${i.intro}` : i.intro);
const searchDocs: SearchDoc[] = [
  {
    id: "wijz-overzicht",
    type: "artikel",
    ref: "wijzigingen",
    heading: `Wijzigingen — ${meta.shortTitle} (${meta.document})`,
    url: "/wijzigingen",
    text: `${meta.document} ${meta.title}. ${meta.ojRef}. Wijzigingen in de AI-verordening per artikel en bijlage.`,
  },
];
for (const t of orderedTargets) {
  const ids = (t.kind === "article" ? byArticle : byAnnex)[t.slug] ?? [];
  const text = amendments.filter((a) => ids.includes(a.id)).map(composed).join(" ");
  if (t.kind === "article") {
    const a = articles.find((x) => x.slug === t.slug)!;
    const inserted = isNewArticle.has(t.slug);
    searchDocs.push({
      id: `wijz-art-${t.slug}`,
      type: "artikel",
      ref: t.slug,
      heading: `Artikel ${a.displayNumber} — ${a.title} (${inserted ? "ingevoegd" : "gewijzigd"} bij ${meta.document})`,
      url: inserted ? `/artikel/${t.slug}` : `/artikel/${t.slug}?diff=1`,
      text,
    });
  } else {
    const a = annexes.find((x) => x.roman.toLowerCase() === t.slug)!;
    const inserted = newAnnexes.some((n) => n.roman === a.roman);
    searchDocs.push({
      id: `wijz-anx-${t.slug}`,
      type: "bijlage",
      ref: t.slug,
      heading: `Bijlage ${a.roman} — ${a.title} (${inserted ? "toegevoegd" : "gewijzigd"} bij ${meta.document})`,
      url: inserted ? `/bijlage/${t.slug}` : `/bijlage/${t.slug}?diff=1`,
      text,
    });
  }
}

// ------------------------------------------------- write

const generated: AmendmentsGenerated = {
  meta,
  amendments,
  byArticle,
  byAnnex,
  orderedTargets,
  newArticles,
  newAnnexes,
  titleChanges,
};

const out = (rel: string, data: unknown) => writeFileSync(join(root, rel), JSON.stringify(data, null, 1) + "\n");
out("data/generated/amendments.json", generated);
out("data/generated/amendment-diffs.json", diffs);
out("public/amendment-search-docs.json", searchDocs);

console.log(
  `parse-amendments: ${meta.document} (in werking ${meta.inForce}): ${act.topLevelCount} instructions ` +
    `(${amendments.length} incl. sub-instructions), ${Object.keys(diffs.articles).length} amended articles, ` +
    `${newArticles.length} new articles, ${Object.keys(diffs.annexes).length} amended annexes, ` +
    `${newAnnexes.length} new annexes, ${refCount} cross-references, ${searchDocs.length} search docs`,
);
