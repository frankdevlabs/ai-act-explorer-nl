/**
 * Curated amendments (data/source/amendments/pe-cons-30-26.json, the digitale
 * omnibus PE-CONS 30/26) -> data/generated/amendments.json (normalized list +
 * indexes) and amendment-diffs.json (word-level track changes per affected
 * article/annex), plus public/amendment-search-docs.json.
 *
 * Runs after parse-aiact.ts: diffs are computed against the base corpus in
 * data/generated/. The diff invariant is asserted here and re-checked by
 * verify-amendments.ts: concat(eq+del) === flatten(old) and
 * concat(eq+ins) === flatten(new), byte-exact.
 */
import { diffWordsWithSpace } from "diff";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignItemAnchors, flattenNodes, markerToSlug } from "../src/lib/flatten";
import type {
  Amendment,
  AmendmentDiffs,
  AmendmentsGenerated,
  AmendmentsSource,
  Annex,
  Article,
  ArticleParagraph,
  ContentNode,
  DiffSegment,
  ListItem,
  NewArticleSpec,
  ParagraphDiff,
  SearchDoc,
} from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const source = load<AmendmentsSource>("data/source/amendments/pe-cons-30-26.json");
const articles = load<Article[]>("data/generated/articles.json");
const annexes = load<Annex[]>("data/generated/annexes.json");

const fail = (msg: string): never => {
  throw new Error(`parse-amendments: ${msg}`);
};

const amendmentId = (a: Amendment) => `${a.seq}${a.sub ?? ""}`;
const label = (a: Amendment) => `instruction ${amendmentId(a)}`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ------------------------------------------------- anchor derivation

/** Anchor for a (possibly bis-numbered) paragraph: lid-5, lid-5bis, inhoud. */
function paragraphAnchor(p: ArticleParagraph & { displayNumber?: string }): string {
  if (p.displayNumber) return `lid-${p.displayNumber.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  return p.number !== null ? `lid-${p.number}` : "inhoud";
}

/** Fill in paragraph + top-level item anchors the transcription may omit. */
function withAnchors(
  paragraphs: (ArticleParagraph & { displayNumber?: string })[],
): (ArticleParagraph & { displayNumber?: string })[] {
  return paragraphs.map((p) => {
    const anchor = p.anchor || paragraphAnchor(p);
    const content = clone(p.content);
    assignItemAnchors(content, p.number !== null || p.displayNumber ? anchor : "");
    return { ...p, anchor, content };
  });
}

// ------------------------------------------------- content tree helpers

/** Top-level list item lookup by anchor within a paragraph's content. */
function findItem(
  content: ContentNode[],
  anchor: string,
): { list: ListItem[]; index: number } | undefined {
  for (const node of content) {
    if (node.type !== "list") continue;
    const index = node.items.findIndex((i) => i.anchor === anchor);
    if (index !== -1) return { list: node.items, index };
  }
  return undefined;
}

// ------------------------------------------------- diff machinery

function segmentsOf(oldFlat: string, newFlat: string): DiffSegment[] {
  return diffWordsWithSpace(oldFlat, newFlat).map((part) => ({
    op: part.added ? ("ins" as const) : part.removed ? ("del" as const) : ("eq" as const),
    text: part.value,
  }));
}

function assertInvariant(segments: DiffSegment[], oldFlat: string, newFlat: string, ctx: string) {
  const reOld = segments
    .filter((s) => s.op !== "ins")
    .map((s) => s.text)
    .join("");
  const reNew = segments
    .filter((s) => s.op !== "del")
    .map((s) => s.text)
    .join("");
  if (reOld !== oldFlat) fail(`${ctx}: diff does not reconstruct old text`);
  if (reNew !== newFlat) fail(`${ctx}: diff does not reconstruct new text`);
}

// ------------------------------------------------- per-target application

interface ParaState {
  anchor: string;
  number: number | null;
  displayNumber?: string;
  old?: ContentNode[]; // absent for inserted paragraphs
  next?: ContentNode[]; // absent for deleted paragraphs
  status: ParagraphDiff["status"];
  seq: number[];
}

function stateFromBase(paragraphs: ArticleParagraph[]): ParaState[] {
  return paragraphs.map((p) => ({
    anchor: p.anchor,
    number: p.number,
    old: p.content,
    next: clone(p.content),
    status: "unchanged" as const,
    seq: [],
  }));
}

function markModified(s: ParaState, seq: number) {
  if (s.status === "unchanged") s.status = "modified";
  if (!s.seq.includes(seq)) s.seq.push(seq);
}

/** Apply one scoped amendment to the working paragraph states of an article. */
function applyToArticle(states: ParaState[], am: Amendment) {
  const { anchor, wholeArticle, title } = am.scope;
  const ctx = label(am);

  if (title) return; // handled separately (titleChanges)

  if (wholeArticle) {
    if (am.operation !== "replace" || !am.newParagraphs)
      fail(`${ctx}: wholeArticle requires operation "replace" + newParagraphs`);
    const nextParas = withAnchors(am.newParagraphs!);
    const oldByAnchor = new Map(states.map((s) => [s.anchor, s]));
    const flatToFlat = states.length === 1 && nextParas.length === 1;
    const rebuilt: ParaState[] = nextParas.map((p) => {
      const match = flatToFlat ? states[0] : oldByAnchor.get(p.anchor);
      if (match) {
        oldByAnchor.delete(match.anchor);
        return { ...match, next: p.content, displayNumber: p.displayNumber, status: match.status, seq: [...match.seq] };
      }
      return {
        anchor: p.anchor,
        number: p.number,
        displayNumber: p.displayNumber,
        next: p.content,
        status: "inserted" as const,
        seq: [],
      };
    });
    // paragraphs absent from the new text: keep them, marked deleted, right
    // after their nearest surviving predecessor
    for (const s of states) {
      if (!oldByAnchor.has(s.anchor)) continue;
      const pos = states.indexOf(s);
      let insertAt = 0;
      for (let i = pos - 1; i >= 0; i--) {
        const idx = rebuilt.findIndex((r) => r.anchor === states[i].anchor);
        if (idx !== -1) {
          insertAt = idx + 1;
          break;
        }
      }
      rebuilt.splice(insertAt, 0, { ...s, next: undefined, status: "deleted", seq: [...s.seq] });
    }
    for (const r of rebuilt) {
      if (r.status === "inserted" || r.status === "deleted") markModified(r, am.seq);
      else if (r.old && flattenNodes(r.old) !== flattenNodes(r.next!)) markModified(r, am.seq);
      else if (!r.seq.includes(am.seq) && r.status !== "unchanged") r.seq.push(am.seq);
    }
    states.length = 0;
    states.push(...rebuilt);
    return;
  }

  if (!anchor) fail(`${ctx}: scoped amendment without anchor`);

  // paragraph-level anchor?
  const paraIdx = states.findIndex((s) => s.anchor === anchor);

  switch (am.operation) {
    case "replace": {
      if (anchor!.endsWith("-aanhef")) {
        const base = anchor!.slice(0, -"-aanhef".length);
        const s = states.find((x) => x.anchor === base) ?? fail(`${ctx}: aanhef base ${base} not found`);
        if (!am.newContent) fail(`${ctx}: replace requires newContent`);
        if (!s.next) fail(`${ctx}: target paragraph was deleted`);
        const firstList = s.next!.findIndex((n) => n.type === "list");
        const tail = firstList === -1 ? [] : s.next!.slice(firstList);
        s.next = [...clone(am.newContent!), ...tail];
        markModified(s, am.seq);
        return;
      }
      if (paraIdx !== -1) {
        const s = states[paraIdx];
        if (!am.newContent) fail(`${ctx}: replace requires newContent`);
        if (!s.next) fail(`${ctx}: target paragraph was deleted`);
        const content = clone(am.newContent!);
        assignItemAnchors(content, s.number !== null || s.displayNumber ? s.anchor : "");
        s.next = content;
        markModified(s, am.seq);
        return;
      }
      // point-level replace
      for (const s of states) {
        if (!s.next) continue;
        const hit = findItem(s.next, anchor!);
        if (hit) {
          if (!am.newContent) fail(`${ctx}: replace requires newContent`);
          hit.list[hit.index] = { ...hit.list[hit.index], content: clone(am.newContent!) };
          markModified(s, am.seq);
          return;
        }
      }
      fail(`${ctx}: anchor ${anchor} not found`);
      return;
    }
    case "insert":
    case "add": {
      if (am.newParagraphs) {
        const paras = withAnchors(am.newParagraphs);
        const inserted: ParaState[] = paras.map((p) => ({
          anchor: p.anchor,
          number: p.number,
          displayNumber: p.displayNumber,
          next: p.content,
          status: "inserted" as const,
          seq: [am.seq],
        }));
        if (anchor === undefined || paraIdx === -1) {
          if (am.operation === "add") states.push(...inserted);
          else fail(`${ctx}: insert needs an existing paragraph anchor`);
        } else {
          states.splice(paraIdx + 1, 0, ...inserted);
        }
        return;
      }
      if (am.newItems) {
        // new points after an existing item anchor
        for (const s of states) {
          if (!s.next) continue;
          const hit = findItem(s.next, anchor!);
          if (hit) {
            const items = am.newItems!.map((it) => ({
              ...clone(it),
              anchor: (() => {
                const slug = markerToSlug(it.marker);
                const prefix = s.anchor === "inhoud" ? "punt" : s.anchor;
                return slug ? `${prefix}-${slug}` : undefined;
              })(),
            }));
            hit.list.splice(hit.index + 1, 0, ...items);
            markModified(s, am.seq);
            return;
          }
        }
        fail(`${ctx}: anchor ${anchor} not found for newItems`);
        return;
      }
      fail(`${ctx}: insert/add requires newParagraphs or newItems`);
      return;
    }
    case "delete": {
      if (paraIdx !== -1) {
        const s = states[paraIdx];
        s.next = undefined;
        s.status = "deleted";
        if (!s.seq.includes(am.seq)) s.seq.push(am.seq);
        return;
      }
      for (const s of states) {
        if (!s.next) continue;
        const hit = findItem(s.next, anchor!);
        if (hit) {
          hit.list.splice(hit.index, 1);
          markModified(s, am.seq);
          return;
        }
      }
      fail(`${ctx}: anchor ${anchor} not found for delete`);
      return;
    }
  }
}

function statesToDiffs(states: ParaState[], ctx: string): ParagraphDiff[] {
  return states.map((s) => {
    if (s.status === "unchanged") return { anchor: s.anchor, status: s.status, seq: [] };
    if (s.status === "deleted") {
      const oldFlat = flattenNodes(s.old!);
      return {
        anchor: s.anchor,
        status: s.status,
        segments: [{ op: "del" as const, text: oldFlat }],
        seq: s.seq,
      };
    }
    if (s.status === "inserted") {
      const newFlat = flattenNodes(s.next!);
      return {
        anchor: s.anchor,
        status: s.status,
        displayNumber: s.displayNumber,
        segments: [{ op: "ins" as const, text: newFlat }],
        newContent: s.next,
        seq: s.seq,
      };
    }
    const oldFlat = flattenNodes(s.old!);
    const newFlat = flattenNodes(s.next!);
    const segments = segmentsOf(oldFlat, newFlat);
    assertInvariant(segments, oldFlat, newFlat, `${ctx} ${s.anchor}`);
    if (!segments.some((x) => x.op !== "eq"))
      fail(`${ctx} ${s.anchor}: marked modified but diff is empty`);
    return {
      anchor: s.anchor,
      status: s.status,
      displayNumber: s.displayNumber,
      segments,
      newContent: s.next,
      seq: s.seq,
    };
  });
}

// ------------------------------------------------- main

const amendments = source.amendments;

// schema sanity
const seenIds = new Set<string>();
for (const am of amendments) {
  const id = amendmentId(am);
  if (seenIds.has(id)) fail(`duplicate instruction id ${id}`);
  seenIds.add(id);
  const kinds = [am.newArticle, am.newAnnex].filter(Boolean).length;
  if (kinds > 1) fail(`${label(am)}: newArticle and newAnnex are mutually exclusive`);
  if (!am.newArticle && !am.newAnnex && !am.target.article && !am.target.annex)
    fail(`${label(am)}: scoped amendment needs target.article or target.annex`);
}

const newArticles: NewArticleSpec[] = amendments
  .filter((a) => a.newArticle)
  .map((a) => {
    const spec = a.newArticle!;
    if (!/^\d+(bis|ter|quater|quinquies)$/.test(spec.slug))
      fail(`${label(a)}: bad new-article slug ${spec.slug}`);
    return { ...spec, paragraphs: withAnchors(spec.paragraphs) };
  });
const newAnnexes = amendments
  .filter((a) => a.newAnnex)
  .map((a) => {
    const spec = clone(a.newAnnex!);
    assignItemAnchors(spec.content, "");
    return spec;
  });

const byArticle: Record<string, string[]> = {};
const byAnnex: Record<string, string[]> = {};
const orderedTargets: AmendmentsGenerated["orderedTargets"] = [];
const titleChanges: AmendmentsGenerated["titleChanges"] = {};

const pushTarget = (kind: "article" | "annex", slug: string) => {
  if (!orderedTargets.some((t) => t.kind === kind && t.slug === slug))
    orderedTargets.push({ kind, slug });
};

for (const am of amendments) {
  const id = amendmentId(am);
  if (am.newArticle) {
    const slug = am.newArticle.slug;
    (byArticle[slug] ??= []).push(id);
    pushTarget("article", slug);
    continue;
  }
  if (am.newAnnex) {
    const roman = am.newAnnex.roman.toLowerCase();
    (byAnnex[roman] ??= []).push(id);
    pushTarget("annex", roman);
    continue;
  }
  if (am.target.article) {
    (byArticle[am.target.article] ??= []).push(id);
    pushTarget("article", am.target.article);
    if (am.scope.title) {
      const first = am.newContent?.[0];
      if (!first || first.type !== "text")
        throw new Error(`parse-amendments: ${label(am)}: title change needs newContent [{type:"text"}]`);
      titleChanges[am.target.article] = { title: first.text, seq: am.seq };
    }
  } else if (am.target.annex) {
    (byAnnex[am.target.annex.toLowerCase()] ??= []).push(id);
    pushTarget("annex", am.target.annex.toLowerCase());
  }
}

// diffs per affected base article
const diffs: AmendmentDiffs = { articles: {}, annexes: {} };

for (const key of Object.keys(byArticle)) {
  if (!/^\d+$/.test(key)) continue; // new articles have no base to diff against
  const article = articles.find((a) => a.number === Number(key)) ?? fail(`article ${key} not in base corpus`);
  const scoped = amendments
    .filter((a) => a.target.article === key && !a.newArticle && !a.scope.title)
    .sort((a, b) => a.seq - b.seq || (a.sub ?? "").localeCompare(b.sub ?? ""));
  if (!scoped.length) continue;
  const states = stateFromBase(article!.paragraphs);
  for (const am of scoped) applyToArticle(states, am);
  diffs.articles[key] = statesToDiffs(states, `artikel ${key}`);
}

// diffs per affected base annex (whole content as one pseudo-paragraph)
for (const roman of Object.keys(byAnnex)) {
  const annex = annexes.find((a) => a.roman.toLowerCase() === roman);
  if (!annex) {
    if (!newAnnexes.some((n) => n.roman.toLowerCase() === roman)) fail(`annex ${roman} not in base corpus`);
    continue;
  }
  const scoped = amendments
    .filter((a) => a.target.annex?.toLowerCase() === roman && !a.newAnnex)
    .sort((a, b) => a.seq - b.seq || (a.sub ?? "").localeCompare(b.sub ?? ""));
  if (!scoped.length) continue;
  const states: ParaState[] = [
    {
      anchor: "inhoud",
      number: null,
      old: annex.content,
      next: clone(annex.content),
      status: "unchanged",
      seq: [],
    },
  ];
  for (const am of scoped) applyToArticle(states, am);
  diffs.annexes[roman] = statesToDiffs(states, `bijlage ${roman}`);
}

// ------------------------------------------------- search docs (amendment layer)

const searchDocs: SearchDoc[] = [];
for (const na of newArticles) {
  for (const p of na.paragraphs) {
    const lid = p.number !== null ? `, lid ${p.number}` : "";
    searchDocs.push({
      id: `omnibus-art-${na.slug}-${p.anchor}`,
      type: "artikel",
      ref: `Artikel ${na.displayNumber}${lid}`,
      heading: `${na.title} (digitale omnibus)`,
      url: `/artikel/${na.slug}#${p.anchor}`,
      text: flattenNodes(p.content),
    });
  }
}
for (const na of newAnnexes) {
  searchDocs.push({
    id: `omnibus-anx-${na.roman.toLowerCase()}`,
    type: "bijlage",
    ref: `Bijlage ${na.roman}`,
    heading: `${na.title} (digitale omnibus)`,
    url: `/bijlage/${na.roman.toLowerCase()}`,
    text: flattenNodes(na.content),
  });
}
for (const [key, paras] of Object.entries(diffs.articles)) {
  const article = articles.find((a) => a.number === Number(key))!;
  for (const p of paras) {
    if (p.status !== "modified" && p.status !== "inserted") continue;
    const flat = p.newContent ? flattenNodes(p.newContent) : "";
    if (!flat) continue;
    searchDocs.push({
      id: `omnibus-art-${key}-${p.anchor}`,
      type: "artikel",
      ref: `Artikel ${key}`,
      heading: `${titleChanges[key]?.title ?? article.title} (digitale omnibus)`,
      url: `/artikel/${key}?diff=1#w-${p.anchor}`,
      text: flat,
    });
  }
}

// ------------------------------------------------- write

const generated: AmendmentsGenerated = {
  meta: source.meta,
  amendments,
  byArticle,
  byAnnex,
  orderedTargets,
  newArticles,
  newAnnexes,
  titleChanges,
};

const out = (rel: string, data: unknown) =>
  writeFileSync(join(root, rel), JSON.stringify(data, null, 1) + "\n");

out("data/generated/amendments.json", generated);
out("data/generated/amendment-diffs.json", diffs);
out("public/amendment-search-docs.json", searchDocs);

console.log(
  `parse-amendments: ${amendments.length} instructions, ` +
    `${Object.keys(diffs.articles).length} amended articles, ` +
    `${newArticles.length} new articles, ${newAnnexes.length} new annexes, ` +
    `${searchDocs.length} search docs (complete=${source.meta.complete})`,
);
