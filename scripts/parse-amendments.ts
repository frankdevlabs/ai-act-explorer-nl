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
import { findRefs, type RefContext } from "../src/lib/crossrefs";
import { assignItemAnchors, flattenNodes, flattenWithBreaks, markerToSlug } from "../src/lib/flatten";
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
  Recital,
  SearchDoc,
  Toc,
} from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const source = load<AmendmentsSource>("data/source/amendments/pe-cons-30-26.json");
const articles = load<Article[]>("data/generated/articles.json");
const annexes = load<Annex[]>("data/generated/annexes.json");
const recitals = load<Recital[]>("data/generated/recitals.json");
const toc = load<Toc>("data/generated/toc.json");

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

/** flattenWithBreaks, asserted byte-identical to the canonical projection. */
function flatBreaks(nodes: ContentNode[], ctx: string): Set<number> {
  const fw = flattenWithBreaks(nodes);
  if (fw.text !== flattenNodes(nodes)) fail(`${ctx}: flattenWithBreaks diverges from flattenNodes`);
  return new Set(fw.breaks);
}

/**
 * Split segments at block boundaries so the renderer can restore the line
 * structure flattening collapsed. eq/ins segments split at new-text breaks,
 * del segments at old-text breaks; a chunk starting exactly on a break gets
 * `br`. Same-op adjacency means concat(eq+ins)/concat(eq+del) are unchanged —
 * the diff invariant survives, only segmentation granularity changes.
 */
function splitAtBreaks(
  segments: DiffSegment[],
  oldBreaks: Set<number>,
  newBreaks: Set<number>,
): DiffSegment[] {
  const out: DiffSegment[] = [];
  let oldOff = 0;
  let newOff = 0;
  for (const s of segments) {
    const breaks = s.op === "del" ? oldBreaks : newBreaks;
    const base = s.op === "del" ? oldOff : newOff;
    const cuts = [...breaks].filter((b) => b > base && b < base + s.text.length).sort((a, b) => a - b);
    let pos = base;
    for (const cut of [...cuts, base + s.text.length]) {
      const text = s.text.slice(pos - base, cut - base);
      if (text) out.push(breaks.has(pos) ? { op: s.op, text, br: true } : { op: s.op, text });
      pos = cut;
    }
    if (s.op !== "ins") oldOff += s.text.length;
    if (s.op !== "del") newOff += s.text.length;
  }
  return out;
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

  // anchor may be absent only for "add" (append at end)
  if (!anchor && am.operation !== "add") fail(`${ctx}: scoped amendment without anchor`);

  // paragraph-level anchor?
  const paraIdx = anchor ? states.findIndex((s) => s.anchor === anchor) : -1;

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
    const where = `${ctx} ${s.anchor}`;
    if (s.status === "unchanged") return { anchor: s.anchor, status: s.status, seq: [] };
    if (s.status === "deleted") {
      const oldFlat = flattenNodes(s.old!);
      return {
        anchor: s.anchor,
        status: s.status,
        segments: splitAtBreaks(
          [{ op: "del" as const, text: oldFlat }],
          flatBreaks(s.old!, where),
          new Set(),
        ),
        seq: s.seq,
      };
    }
    if (s.status === "inserted") {
      const newFlat = flattenNodes(s.next!);
      return {
        anchor: s.anchor,
        status: s.status,
        displayNumber: s.displayNumber,
        segments: splitAtBreaks(
          [{ op: "ins" as const, text: newFlat }],
          new Set(),
          flatBreaks(s.next!, where),
        ),
        newContent: s.next,
        seq: s.seq,
      };
    }
    const oldFlat = flattenNodes(s.old!);
    const newFlat = flattenNodes(s.next!);
    const segments = segmentsOf(oldFlat, newFlat);
    assertInvariant(segments, oldFlat, newFlat, where);
    if (!segments.some((x) => x.op !== "eq"))
      fail(`${where}: marked modified but diff is empty`);
    return {
      anchor: s.anchor,
      status: s.status,
      displayNumber: s.displayNumber,
      segments: splitAtBreaks(segments, flatBreaks(s.old!, where), flatBreaks(s.next!, where)),
      newContent: s.next,
      seq: s.seq,
    };
  });
}

// ------------------------------------------------- main

const amendments = source.amendments;

// never hand-curate refs in the transcription: the cross-reference post-pass
// below is the single deterministic authority. Strip any that sneak in (the
// verify script additionally rejects them at the source).
function stripRefs(nodes: ContentNode[]): void {
  for (const n of nodes) {
    if (n.type === "text") delete n.refs;
    else if (n.type === "list") for (const item of n.items) stripRefs(item.content);
  }
}
for (const am of amendments) {
  if (am.newContent) stripRefs(am.newContent);
  for (const p of am.newParagraphs ?? []) stripRefs(p.content);
  for (const it of am.newItems ?? []) stripRefs(it.content);
  for (const p of am.newArticle?.paragraphs ?? []) stripRefs(p.content);
  if (am.newAnnex) stripRefs(am.newAnnex.content);
}

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

// ------------------------------------------------- cross-reference post-pass
// Annotate all amendment-layer text via findRefs, mirroring parse-aiact's
// post-pass semantics: unknown page target → throw, unknown fragment → strip.
// The validator is the base corpus unioned with what the omnibus itself adds
// (new articles/annexes, inserted leden/punten in amended targets).

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
  articleAnchors.set(String(a.number), set);
}
const annexAnchors = new Map<string, Set<string>>();
for (const a of annexes) {
  const set = new Set<string>(["inhoud"]);
  collectItemAnchors(a.content, set);
  annexAnchors.set(a.roman.toLowerCase(), set);
}
for (const na of newArticles) {
  const set = new Set<string>();
  for (const p of na.paragraphs) {
    set.add(p.anchor);
    collectItemAnchors(p.content, set);
  }
  articleAnchors.set(na.slug, set);
}
for (const na of newAnnexes) {
  const set = new Set<string>(["inhoud"]);
  collectItemAnchors(na.content, set);
  annexAnchors.set(na.roman.toLowerCase(), set);
}
// anchors the omnibus adds inside amended base targets (lid-5bis, new punten)
for (const [key, list] of Object.entries(diffs.articles)) {
  const set = articleAnchors.get(key)!;
  for (const p of list) {
    set.add(p.anchor);
    if (p.newContent) collectItemAnchors(p.newContent, set);
  }
}
for (const [roman, list] of Object.entries(diffs.annexes)) {
  const set = annexAnchors.get(roman)!;
  for (const p of list) if (p.newContent) collectItemAnchors(p.newContent, set);
}

/** Validate a candidate href; returns it with the fragment stripped if unanchorable. */
function resolveAmendmentRef(href: string, where: string): string {
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
  else if (!rct || !recitalNumbers.has(rct[1]))
    fail(`${where}: unresolvable cross-reference target ${href}`);
  if ((art || anx) && !anchors) fail(`${where}: unresolvable cross-reference target ${href}`);
  if (!fragment) return href;
  return anchors?.has(fragment) ? href : page;
}

let refCount = 0;

function annotateNodes(nodes: ContentNode[], ctx: RefContext, selfHref: string, where: string): void {
  for (const n of nodes) {
    if (n.type === "text") {
      const refs = findRefs(n.text, ctx)
        .map((r) => ({ ...r, href: resolveAmendmentRef(r.href, where) }))
        // fragment stripping can reduce a deep link to a plain self-page link
        .filter((r) => r.href !== selfHref);
      if (refs.length > 0) {
        n.refs = refs;
        refCount += refs.length;
      }
    } else if (n.type === "list") {
      for (const item of n.items) annotateNodes(item.content, ctx, selfHref, where);
    }
  }
}

// base rule carried over: amendment articles 102-110 quote text of other acts
const articleCtx = (key: string): RefContext => ({
  selfType: "artikel",
  selfRef: key,
  linkBareRefs: !/^(10[2-9]|110)$/.test(key),
});

/** Annotate a diff list: structured newContent plus per-segment ref clips. */
function annotateDiff(list: ParagraphDiff[], ctx: RefContext, selfHref: string, where: string): void {
  for (const p of list) {
    const ctxWhere = `${where} ${p.anchor}`;
    if (p.newContent) annotateNodes(p.newContent, ctx, selfHref, ctxWhere);
    if (!p.segments || p.status === "deleted" || p.status === "unchanged") continue;
    // one findRefs run over the whole new text, then clip each span onto the
    // eq/ins segments it crosses (offsets become segment-local)
    const newFlat = p.segments
      .filter((s) => s.op !== "del")
      .map((s) => s.text)
      .join("");
    const refs = findRefs(newFlat, ctx)
      .map((r) => ({ ...r, href: resolveAmendmentRef(r.href, ctxWhere) }))
      .filter((r) => r.href !== selfHref);
    let off = 0;
    for (const s of p.segments) {
      if (s.op === "del") continue;
      const end = off + s.text.length;
      const local = refs
        .filter((r) => r.start < end && r.end > off)
        .map((r) => ({
          start: Math.max(r.start, off) - off,
          end: Math.min(r.end, end) - off,
          href: r.href,
        }));
      if (local.length > 0) {
        s.refs = local;
        refCount += local.length;
      }
      off = end;
    }
  }
}

for (const na of newArticles)
  for (const p of na.paragraphs)
    annotateNodes(p.content, articleCtx(na.slug), `/artikel/${na.slug}`, `artikel ${na.displayNumber}`);
for (const na of newAnnexes)
  annotateNodes(
    na.content,
    { selfType: "bijlage", selfRef: na.roman },
    `/bijlage/${na.roman.toLowerCase()}`,
    `bijlage ${na.roman}`,
  );
for (const [key, list] of Object.entries(diffs.articles))
  annotateDiff(list, articleCtx(key), `/artikel/${key}`, `artikel ${key}`);
for (const [roman, list] of Object.entries(diffs.annexes)) {
  const annex = annexes.find((a) => a.roman.toLowerCase() === roman)!;
  annotateDiff(
    list,
    { selfType: "bijlage", selfRef: annex.roman },
    `/bijlage/${roman}`,
    `bijlage ${annex.roman}`,
  );
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
    `${refCount} cross-references, ` +
    `${searchDocs.length} search docs (complete=${source.meta.complete})`,
);
