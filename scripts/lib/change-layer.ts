/**
 * The change layer of an in-force amending act, derived deterministically:
 * WHAT changed comes from diffing two consolidated versions of the AI Act
 * (both parsed by parseConsolidated), WHICH instruction changed it from the
 * amending act's own Article 1 (parseAmendingAct). Instruction targets are
 * read from the instruction wording by a small grammar that throws on
 * anything it does not recognize; the attribution is then checked both ways
 * (every instruction changed something, every change has an instruction).
 */
import { diffWordsWithSpace } from "diff";
import { flattenNodes, flattenWithBreaks, lidAnchor } from "../../src/lib/flatten";
import type { Annex, Article, ContentNode, DiffSegment } from "../../src/lib/types";
import type { OjInstruction } from "./oj-instructions";

export type Operation = "replace" | "insert" | "add" | "delete";

export interface InstructionTarget {
  kind: "article" | "annex";
  /** Article slug ("4bis") or lowercase annex roman ("xiv"). */
  slug: string;
  /** Paragraph anchors this instruction changed; "titel" for the article
   *  title. Whole inserted articles/annexes: every anchor of the new target. */
  anchors: string[];
  /** The instruction inserts the whole article/annex. */
  inserted?: true;
}

export interface ResolvedInstruction extends OjInstruction {
  id: string;
  operation: Operation;
  targets: InstructionTarget[];
}

export interface ParaChange {
  anchor: string;
  status: "modified" | "inserted" | "deleted" | "unchanged";
  displayNumber?: string;
  old?: ContentNode[];
  next?: ContentNode[];
}

export interface CorpusDiff {
  /** Per article present in both versions with ≥1 changed paragraph:
   *  paragraphs in new-document order, deleted ones at their old position. */
  articles: Record<string, ParaChange[]>;
  /** Per annex present in both versions whose content changed ("inhoud"). */
  annexes: Record<string, ParaChange[]>;
  titleChanges: Record<string, { title: string; previous: string }>;
  newArticles: Article[];
  newAnnexes: Annex[];
}

interface Corpus {
  articles: Article[];
  annexes: Annex[];
}

// ------------------------------------------------- diffable text

/** Content without EUR-Lex struck-provision placeholders ("—————"): the diff
 *  shows the struck text as deleted, not the placeholder as inserted. */
export function withoutRepealed(nodes: ContentNode[]): ContentNode[] {
  return nodes
    .filter((n) => !(n.type === "text" && n.repealed))
    .map((n) =>
      n.type === "list"
        ? { ...n, items: n.items.map((i) => ({ ...i, content: withoutRepealed(i.content) })) }
        : n,
    );
}

export const diffText = (nodes: ContentNode[]) => flattenNodes(withoutRepealed(nodes));

// ------------------------------------------------- typographic baseline
//
// The 001.001 consolidation re-typeset the whole act: every opening quote “
// became „ (Dutch style), and footnotes after the one instruction 17 inserted
// in art. 40 were renumbered. Neither is a change by the amending act, so the
// previous version is compared — and its deleted text shown — in the current
// version's typography. verify-amendments re-checks that after this step
// every remaining difference sits under the amending act's ▼ marker.

const OPENING_QUOTE_OLD = "\u201C"; // “
const OPENING_QUOTE_NEW = "\u201E"; // „

function mapText(nodes: ContentNode[], f: (t: string) => string): ContentNode[] {
  return nodes.map((n) => {
    if (n.type === "text") return { ...n, text: f(n.text), refs: undefined };
    if (n.type === "heading") return { ...n, text: f(n.text) };
    if (n.type === "table") return { ...n, rows: n.rows.map((r) => r.map(f)) };
    return { ...n, items: n.items.map((i) => ({ ...i, marker: f(i.marker), content: mapText(i.content, f) })) };
  });
}

/** Previous-version article in the current version's typography. */
function retypeset(prevArticle: Article, curArticle: Article | undefined): Article {
  // footnote labels: same footnote text, new number ("(1)" → "(2)")
  const relabel = new Map<string, string>();
  for (const f of prevArticle.footnotes) {
    const g = curArticle?.footnotes.find((x) => x.text === f.text);
    if (g && g.label !== f.label) relabel.set(f.label, g.label);
  }
  const body = prevArticle.paragraphs.map((p) => diffText(p.content)).join(" ");
  for (const label of relabel.keys()) {
    const n = body.split(label).length - 1;
    if (n !== 1) throw new Error(`change-layer: footnote label ${label} occurs ${n}× in artikel ${prevArticle.slug}`);
  }
  const f = (t: string) => {
    let out = t.split(OPENING_QUOTE_OLD).join(OPENING_QUOTE_NEW);
    for (const [from, to] of relabel) out = out.split(from).join(to);
    return out;
  };
  return {
    ...prevArticle,
    title: f(prevArticle.title),
    paragraphs: prevArticle.paragraphs.map((p) => ({ ...p, content: mapText(p.content, f) })),
  };
}

function retypesetAnnex(a: Annex): Annex {
  const f = (t: string) => t.split(OPENING_QUOTE_OLD).join(OPENING_QUOTE_NEW);
  return { ...a, title: f(a.title), content: mapText(a.content, f) };
}

// ------------------------------------------------- corpus vs corpus

function alignParagraphs(prev: Article, cur: Article): ParaChange[] {
  const oldByAnchor = new Map(prev.paragraphs.map((p) => [p.anchor, p]));
  const newAnchors = new Set(cur.paragraphs.map((p) => p.anchor));
  const out: ParaChange[] = [];
  let oi = 0;
  const flushDeletedUntil = (anchor: string | null) => {
    while (oi < prev.paragraphs.length && prev.paragraphs[oi].anchor !== anchor) {
      const o = prev.paragraphs[oi++];
      if (!newAnchors.has(o.anchor)) out.push({ anchor: o.anchor, status: "deleted", old: o.content });
    }
  };
  for (const n of cur.paragraphs) {
    const o = oldByAnchor.get(n.anchor);
    const displayNumber = n.displayNumber;
    if (!o) {
      out.push({ anchor: n.anchor, status: "inserted", displayNumber, next: n.content });
      continue;
    }
    flushDeletedUntil(n.anchor);
    oi++; // the matched old paragraph
    if (n.repealed) {
      out.push({ anchor: n.anchor, status: "deleted", old: o.content, next: n.content });
    } else if (diffText(o.content) === diffText(n.content)) {
      out.push({ anchor: n.anchor, status: "unchanged", displayNumber, old: o.content, next: n.content });
    } else {
      out.push({ anchor: n.anchor, status: "modified", displayNumber, old: o.content, next: n.content });
    }
  }
  flushDeletedUntil(null);
  return out;
}

export function diffCorpora(prevRaw: Corpus, cur: Corpus): CorpusDiff {
  const result: CorpusDiff = { articles: {}, annexes: {}, titleChanges: {}, newArticles: [], newAnnexes: [] };
  const prev: Corpus = {
    articles: prevRaw.articles.map((a) => retypeset(a, cur.articles.find((c) => c.slug === a.slug))),
    annexes: prevRaw.annexes.map(retypesetAnnex),
  };
  const prevBySlug = new Map(prev.articles.map((a) => [a.slug, a]));
  const curSlugs = new Set(cur.articles.map((a) => a.slug));
  for (const a of prev.articles)
    if (!curSlugs.has(a.slug)) throw new Error(`change-layer: article ${a.slug} disappeared`);
  for (const a of cur.articles) {
    const p = prevBySlug.get(a.slug);
    if (!p) {
      result.newArticles.push(a);
      continue;
    }
    if (p.title !== a.title) result.titleChanges[a.slug] = { title: a.title, previous: p.title };
    const paras = alignParagraphs(p, a);
    if (paras.some((x) => x.status !== "unchanged")) result.articles[a.slug] = paras;
  }
  const prevAnnex = new Map(prev.annexes.map((a) => [a.roman, a]));
  const curRomans = new Set(cur.annexes.map((a) => a.roman));
  for (const a of prev.annexes)
    if (!curRomans.has(a.roman)) throw new Error(`change-layer: annex ${a.roman} disappeared`);
  for (const a of cur.annexes) {
    const p = prevAnnex.get(a.roman);
    if (!p) {
      result.newAnnexes.push(a);
      continue;
    }
    if (p.title !== a.title) throw new Error(`change-layer: annex ${a.roman} title changed`);
    if (diffText(p.content) !== diffText(a.content))
      result.annexes[a.roman.toLowerCase()] = [
        { anchor: "inhoud", status: "modified", old: p.content, next: a.content },
      ];
  }
  return result;
}

// ------------------------------------------------- word-level segments

function segmentsOf(oldFlat: string, newFlat: string): DiffSegment[] {
  return diffWordsWithSpace(oldFlat, newFlat).map((part) => ({
    op: part.added ? ("ins" as const) : part.removed ? ("del" as const) : ("eq" as const),
    text: part.value,
  }));
}

/** Break offsets of the diffable projection, asserted against diffText. */
function flatBreaks(nodes: ContentNode[], ctx: string): Set<number> {
  const fw = flattenWithBreaks(withoutRepealed(nodes));
  if (fw.text !== diffText(nodes)) throw new Error(`${ctx}: flattenWithBreaks diverges from flattenNodes`);
  return new Set(fw.breaks);
}

/**
 * Split segments at block boundaries so the renderer can restore the line
 * structure flattening collapsed. eq/ins segments split at new-text breaks,
 * del segments at old-text breaks; a chunk starting exactly on a break gets
 * `br`. Same-op adjacency means concat(eq+ins)/concat(eq+del) are unchanged.
 */
function splitAtBreaks(segments: DiffSegment[], oldBreaks: Set<number>, newBreaks: Set<number>): DiffSegment[] {
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

/** concat(eq+del) === old && concat(eq+ins) === new, byte-exact. */
export function assertInvariant(segments: DiffSegment[], oldFlat: string, newFlat: string, ctx: string): void {
  const reOld = segments.filter((s) => s.op !== "ins").map((s) => s.text).join("");
  const reNew = segments.filter((s) => s.op !== "del").map((s) => s.text).join("");
  if (reOld !== oldFlat) throw new Error(`${ctx}: diff does not reconstruct old text`);
  if (reNew !== newFlat) throw new Error(`${ctx}: diff does not reconstruct new text`);
}

/** Word-level segments for one changed paragraph (none for unchanged). */
export function paragraphSegments(c: ParaChange, ctx: string): DiffSegment[] | undefined {
  if (c.status === "unchanged") return undefined;
  if (c.status === "deleted") {
    const oldFlat = diffText(c.old!);
    return splitAtBreaks([{ op: "del", text: oldFlat }], flatBreaks(c.old!, ctx), new Set());
  }
  if (c.status === "inserted") {
    const newFlat = diffText(c.next!);
    return splitAtBreaks([{ op: "ins", text: newFlat }], new Set(), flatBreaks(c.next!, ctx));
  }
  const oldFlat = diffText(c.old!);
  const newFlat = diffText(c.next!);
  const segments = segmentsOf(oldFlat, newFlat);
  assertInvariant(segments, oldFlat, newFlat, ctx);
  if (!segments.some((s) => s.op !== "eq")) throw new Error(`${ctx}: marked modified but diff is empty`);
  return splitAtBreaks(segments, flatBreaks(c.old!, ctx), flatBreaks(c.next!, ctx));
}

// ------------------------------------------------- instruction targets

const SUFFIX = "(?: (?:bis|ter|quater|quinquies|sexies))?";
const ARTIKEL = new RegExp(`\\bartikel (\\d+${SUFFIX})\\b`);
const LIDS = new RegExp(`\\b(?:lid (\\d+${SUFFIX})|de leden (\\d+${SUFFIX}(?:(?:, | en )\\d+${SUFFIX})*))\\b`);
const QUOTED_LID = new RegExp(`^[“„]?(\\d+${SUFFIX})\\.\\s`);
const QUOTED_ARTICLE = new RegExp(`^[“„]?Artikel (\\d+${SUFFIX})\\s`);
const QUOTED_ANNEX = /^[“„]?Bijlage ([IVXLC]+)\s/i;

function operationOf(intro: string): Operation {
  if (/\bvervangen\b|\bals volgt gewijzigd\b/.test(intro)) return "replace";
  if (/\bingevoegd\b/.test(intro)) return "insert";
  if (/\btoegevoegd\b/.test(intro)) return "add";
  if (/\bgeschrapt\b/.test(intro)) return "delete";
  throw new Error(`change-layer: no operation in "${intro}"`);
}

const slugOf = (display: string) => display.replace(/\s+/g, "");

/** Resolve one leaf instruction against the two corpora. */
export function resolveInstruction(ins: OjInstruction, prev: Corpus, cur: Corpus): ResolvedInstruction {
  const id = `${ins.seq}${ins.sub ?? ""}`;
  const where = `instructie ${ins.seq})${ins.sub ? ` ${ins.sub})` : ""}`;
  const fail = (msg: string): never => {
    throw new Error(`change-layer: ${where} "${ins.intro}": ${msg}`);
  };
  const operation = operationOf(ins.intro);
  const context = `${ins.parentIntro ?? ""} ${ins.intro}`;
  const curArticle = (slug: string) => cur.articles.find((a) => a.slug === slug);
  const prevArticle = (slug: string) => prev.articles.find((a) => a.slug === slug);
  const allAnchors = (a: Article) => [...a.paragraphs.map((p) => p.anchor), "titel"];

  // whole new annex / articles
  if (/de volgende bijlage wordt toegevoegd/.test(ins.intro)) {
    const m = ins.quoted[0]?.match(QUOTED_ANNEX) ?? fail("quoted text names no annex");
    const roman = m[1].toUpperCase();
    if (!cur.annexes.some((a) => a.roman === roman) || prev.annexes.some((a) => a.roman === roman))
      fail(`annex ${roman} is not new in the current version`);
    return { ...ins, id, operation, targets: [{ kind: "annex", slug: roman.toLowerCase(), anchors: ["inhoud"], inserted: true }] };
  }
  if (/(?:het volgende artikel wordt|de volgende artikelen worden) ingevoegd/.test(ins.intro)) {
    const targets = ins.quoted.flatMap((q): InstructionTarget[] => {
      const m = q.match(QUOTED_ARTICLE);
      if (!m) return [];
      const slug = slugOf(m[1]);
      const a = curArticle(slug) ?? fail(`inserted article ${m[1]} missing from the current version`);
      if (prevArticle(slug)) fail(`article ${m[1]} already existed`);
      return [{ kind: "article", slug, anchors: allAnchors(a), inserted: true }];
    });
    if (targets.length === 0) fail("quoted text names no article");
    return { ...ins, id, operation, targets };
  }

  // scoped change in an existing annex
  const annex = context.match(/\bbijlage ([IVXLC]+)\b/);
  if (annex) {
    const roman = annex[1].toLowerCase();
    if (!prev.annexes.some((a) => a.roman.toLowerCase() === roman)) fail(`annex ${annex[1]} not in the previous version`);
    return { ...ins, id, operation, targets: [{ kind: "annex", slug: roman, anchors: ["inhoud"] }] };
  }

  // scoped change in an existing article
  const artMatch = (ins.parentIntro ?? "").match(ARTIKEL) ?? ins.intro.match(ARTIKEL) ?? fail("no article named");
  const slug = slugOf(artMatch[1]);
  const p = prevArticle(slug) ?? fail(`artikel ${artMatch[1]} not in the previous version`);
  const c = curArticle(slug) ?? fail(`artikel ${artMatch[1]} not in the current version`);
  const target = (anchors: string[]): ResolvedInstruction => ({
    ...ins,
    id,
    operation,
    targets: [{ kind: "article", slug, anchors }],
  });

  if (/\bde titel wordt vervangen\b/.test(ins.intro)) return target(["titel"]);
  if (new RegExp(`^artikel ${artMatch[1]} wordt vervangen door:$`).test(ins.intro))
    return target([...new Set([...allAnchors(p), ...allAnchors(c)])]);

  // leden: named in the sub-instruction, else in the parent, else (inserted /
  // added leden) read from the quoted lid numbers
  const lidsIn = (text: string): string[] => {
    const m = text.match(LIDS);
    if (!m) return [];
    return (m[1] ?? m[2]).split(/, | en /);
  };
  let lids = lidsIn(ins.intro);
  if (lids.length === 0) lids = lidsIn(ins.parentIntro ?? "");
  if (lids.length === 0 && /\b(?:het volgende lid|de volgende leden)\b/.test(ins.intro)) {
    lids = ins.quoted.map((q) => q.match(QUOTED_LID)?.[1] ?? fail(`quoted lid without number: ${q.slice(0, 40)}`));
  }
  if (lids.length > 0) {
    const anchors = lids.map((l) => lidAnchor(l));
    for (const a of anchors) {
      const inPrev = p.paragraphs.some((x) => x.anchor === a);
      const inCur = c.paragraphs.some((x) => x.anchor === a);
      if (operation === "insert" || operation === "add") {
        // an inserted/added lid is new — unless the instruction adds a point
        // or alinea inside an existing lid
        if (!inCur) fail(`lid ${a} missing from the current version`);
      } else if (!inPrev) fail(`lid ${a} missing from the previous version`);
    }
    return target(anchors);
  }
  // no lid: the article must be a single unnumbered body ("artikel 3", "artikel 113")
  if (c.paragraphs.length === 1 && c.paragraphs[0].anchor === "inhoud") return target(["inhoud"]);
  return fail("cannot locate the changed paragraph");
}
