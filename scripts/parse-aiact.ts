/**
 * One-time parser -> structured JSON in data/generated/.
 *
 * Two sources, two EUR-Lex HTML dialects:
 *
 * 1. data/source/aiact_nl_consolidated.html — consolidated text CELEX
 *    02024R1689-20240712 (incorporates corrigenda R(02)/R(04), e.g. the fixed
 *    lid numbering of art. 73). Used for chapters/articles/annexes.
 *    Markup: div.eli-subdivision#art_N > p.title-article-norm + .eli-title
 *    > p.stitle-article-norm; leden as div.norm > span.no-parag ("1.") +
 *    div.norm.inline-element; points as div.grid-container.grid-list
 *    (.grid-list-column-1 = marker, .grid-list-column-2 = content, nesting
 *    recursively); chapters div#cpt_III (+ #cpt_III.sct_1) with
 *    p.title-division-1/2; annexes div#anx_III with p.title-annex-1/2 and
 *    p.title-gr-seq-level-1 sub-headings; footnotes p.footnote at document
 *    end, referenced inline via <a href="#E0001" id="src.E0001">.
 *
 * 2. data/source/aiact_nl.html — the original OJ text. Consolidated versions
 *    omit the preamble, so the 180 recitals come from here:
 *    div.eli-subdivision#rct_N with a 2-col table ("(N)" | text).
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRefs, type RefContext } from "../src/lib/crossrefs";
import { assignItemAnchors, flattenNodes, markerToSlug } from "../src/lib/flatten";
import type {
  Annex,
  Article,
  ArticleParagraph,
  ContentNode,
  Footnote,
  ListItem,
  Recital,
  SearchDoc,
  Toc,
  TocChapter,
} from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const $ = cheerio.load(readFileSync(join(root, "data/source/aiact_nl_consolidated.html"), "utf-8"));
const $oj = cheerio.load(readFileSync(join(root, "data/source/aiact_nl.html"), "utf-8"));

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function romanToInt(roman: string): number {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const v = ROMAN_VALUES[roman[i]];
    const next = ROMAN_VALUES[roman[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

function cleanText(raw: string): string {
  return raw
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+(\*?\d+)\s+\)/g, "($1)") // superscript footnote refs: "( 1 )" -> "(1)"
    .trim();
}

const isTag = (n: unknown): n is Element =>
  typeof n === "object" && n !== null && "tagName" in n && (n as Element).type === "tag";

const isText = (n: unknown): n is { type: "text"; data: string } =>
  typeof n === "object" && n !== null && (n as { type?: string }).type === "text";

// ------------------------------------------------- consolidated dialect

const SKIP_P_CLASSES = [
  "footnote",
  "arrow",
  "title-article-norm",
  "title-annex-1",
  "title-annex-2",
  "title-division-1",
  "title-division-2",
];

/**
 * Convert a container's child nodes into ContentNodes. Handles direct text
 * nodes (div.norm.inline-element often holds bare text), merges consecutive
 * grid-list point blocks into one list node.
 */
function parseBlocks(container: Element, skipLidMarker = false): ContentNode[] {
  return parseNodes(container.children, skipLidMarker);
}

function parseNodes(children: AnyNode[], skipLidMarker = false): ContentNode[] {
  const nodes: ContentNode[] = [];
  let textBuf = "";
  const flushText = () => {
    const text = cleanText(textBuf);
    textBuf = "";
    if (text) nodes.push({ type: "text", text });
  };

  let lidMarkerSkipped = false;
  for (const child of children) {
    if (isText(child)) {
      textBuf += child.data;
      continue;
    }
    if (!isTag(child)) continue;
    const $child = $(child);
    const cls = $child.attr("class") ?? "";

    if (child.tagName === "span" && cls.includes("no-parag")) {
      // the lid marker handled by the caller is dropped; any other no-parag
      // span (quoted lid numbers in amendment articles) stays in the text
      if (skipLidMarker && !lidMarkerSkipped) {
        lidMarkerSkipped = true;
      } else {
        textBuf += $child.text();
      }
      continue;
    }
    if (child.tagName === "a" || child.tagName === "span" || child.tagName === "em") {
      textBuf += $child.text();
      continue;
    }
    flushText();

    if (child.tagName === "p") {
      if (SKIP_P_CLASSES.some((c) => cls.includes(c))) continue;
      if (cls.includes("title-gr-seq")) {
        const text = cleanText($child.text());
        if (text) nodes.push({ type: "heading", text });
        continue;
      }
      const text = cleanText($child.text());
      if (text) nodes.push({ type: "text", text });
    } else if (child.tagName === "div") {
      if (cls.includes("eli-title")) continue;
      if (cls.includes("grid-container")) {
        const item = parseGridItem(child);
        const last = nodes[nodes.length - 1];
        if (last?.type === "list") last.items.push(item);
        else nodes.push({ type: "list", items: [item] });
      } else {
        nodes.push(...parseBlocks(child));
      }
    }
  }
  flushText();
  return nodes;
}

/** One div.grid-container.grid-list = one list item (marker column + content column). */
function parseGridItem(grid: Element): ListItem {
  const $grid = $(grid);
  const marker = cleanText($grid.children(".grid-list-column-1").first().text());
  const contentCell = $grid.children(".grid-list-column-2").first().get(0);
  return { marker, content: contentCell ? parseBlocks(contentCell) : [] };
}

// ------------------------------------------------- footnotes (global, ref-attached)

/** All p.footnote elements sit at document end; key them by their E-number. */
const footnoteTextById = new Map<string, string>();
$("p.footnote").each((_, p) => {
  const $p = $(p);
  const id = $p.find("a[id]").first().attr("id") ?? "";
  const clone = $p.clone();
  clone.find("a").remove();
  footnoteTextById.set(id, cleanText(clone.text()).replace(/^\(\s*\)\s*/, ""));
});

/**
 * Footnotes referenced from within `container` via <a id="src.E...."> markers;
 * the label is the visible superscript ("1", "*4"), matching the body text.
 */
function referencedFootnotes(container: Element): Footnote[] {
  const out: Footnote[] = [];
  $(container)
    .find('a[id^="src."]')
    .each((_, a) => {
      const target = ($(a).attr("href") ?? "").replace(/^#/, "");
      const text = footnoteTextById.get(target);
      const marker = cleanText($(a).text());
      if (text !== undefined && !out.some((f) => f.id === target)) {
        out.push({ id: target, label: `(${marker})`, text });
      }
    });
  return out;
}

// ------------------------------------------------- structure walk

interface ChapterInfo {
  roman: string;
  title: string;
  sections: { number: number; title: string; el: Element }[];
  el: Element;
}

const chapters: ChapterInfo[] = [];
$("div[id]").each((_, el) => {
  const id = $(el).attr("id")!;
  if (!/^cpt_[IVXLC]+$/.test(id)) return;
  const roman = id.slice(4);
  const title = cleanText($(el).find("p.title-division-2").first().text());
  const sections: ChapterInfo["sections"] = [];
  $(el)
    .find("div[id]")
    .each((_, s) => {
      const m = $(s).attr("id")!.match(/^cpt_[IVXLC]+\.sct_(\d+)$/);
      if (!m) return;
      sections.push({
        number: Number(m[1]),
        title: cleanText($(s).find("p.title-division-2").first().text()),
        el: s,
      });
    });
  chapters.push({ roman, title, sections, el });
});

const articles: Article[] = [];
$("div.eli-subdivision[id]").each((_, el) => {
  const id = $(el).attr("id")!;
  const m = id.match(/^art_(\d+)$/);
  if (!m) return;
  const number = Number(m[1]);
  const title = cleanText($(el).children(".eli-title").find(".stitle-article-norm").first().text());

  const chapter = chapters.find((c) => $.contains(c.el, el));
  if (!chapter) throw new Error(`Article ${number}: no containing chapter`);
  const section = chapter.sections.find((s) => $.contains(s.el, el)) ?? null;

  // Walk direct children in document order. A div.norm with an unquoted "N."
  // no-parag marker starts a new lid (quoted markers belong to text of amended
  // acts, art. 102-110); everything else — continuation alineas are SIBLINGS
  // of the lid div in this dialect — is appended to the current lid.
  const entries: { lid: number | null; content: ContentNode[] }[] = [];
  let buffer: AnyNode[] = [];
  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const nodes = parseNodes(buffer);
    buffer = [];
    if (nodes.length === 0) return;
    if (entries.length === 0) entries.push({ lid: null, content: [] });
    entries[entries.length - 1].content.push(...nodes);
  };
  for (const child of el.children) {
    if (isTag(child)) {
      const $child = $(child);
      const cls = $child.attr("class") ?? "";
      if (child.tagName === "p" && cls.includes("title-article-norm")) continue;
      if (child.tagName === "div" && cls.includes("eli-title")) continue;
      const marker = cleanText($child.children("span.no-parag").first().text());
      if (child.tagName === "div" && cls.includes("norm") && /^\d+\.$/.test(marker)) {
        flushBuffer();
        entries.push({ lid: Number(marker.slice(0, -1)), content: parseBlocks(child, true) });
        continue;
      }
    }
    buffer.push(child);
  }
  flushBuffer();

  const paragraphs: ArticleParagraph[] = [];
  for (const e of entries) {
    const base =
      e.lid !== null ? `lid-${e.lid}` : entries.length === 1 ? "inhoud" : `alinea-${paragraphs.length + 1}`;
    let anchor = base;
    for (let n = 2; paragraphs.some((p) => p.anchor === anchor); n++) {
      anchor = `${base}-bis${n > 2 ? `-${n}` : ""}`;
    }
    assignItemAnchors(e.content, e.lid !== null ? anchor : "");
    paragraphs.push({ number: e.lid, anchor, content: e.content });
  }

  articles.push({
    number,
    title,
    chapter: chapter.roman,
    chapterTitle: chapter.title,
    section: section?.number ?? null,
    sectionTitle: section?.title ?? null,
    paragraphs,
    footnotes: referencedFootnotes(el),
  });
});
articles.sort((a, b) => a.number - b.number);

// ------------------------------------------------- recitals (from the OJ text)

const recitals: Recital[] = [];
$oj("div.eli-subdivision[id]").each((_, el) => {
  const m = $oj(el).attr("id")!.match(/^rct_(\d+)$/);
  if (!m) return;
  const cells = $oj(el).find("tr").first().children("td");
  const paragraphs = cells
    .last()
    .children("p")
    .toArray()
    .map((p) => cleanText($oj(p).text()))
    .filter(Boolean)
    .map((text) => ({ text }));
  recitals.push({ number: Number(m[1]), paragraphs });
});
recitals.sort((a, b) => a.number - b.number);

// ------------------------------------------------- annexes

const annexes: Annex[] = [];
$("div[id]").each((_, el) => {
  const m = $(el).attr("id")!.match(/^anx_([IVXLC]+)$/);
  if (!m) return;
  const roman = m[1];
  const title =
    cleanText($(el).find("p.title-annex-2").first().text()) || `Bijlage ${roman}`;
  const content = parseBlocks(el);
  assignItemAnchors(content, "");
  annexes.push({
    roman,
    ordinal: romanToInt(roman),
    title,
    content,
    footnotes: referencedFootnotes(el),
  });
});
annexes.sort((a, b) => a.ordinal - b.ordinal);

// ------------------------------------------------- internal cross-references
//
// Post-pass: detect "artikel 6, lid 2"-style references in every text node and
// attach char-offset RefSpans. Every candidate href is validated against the
// just-built corpus: an unresolvable page target is a grammar bug (throw); a
// fragment whose anchor does not exist — or is not unique — on the target page
// is stripped, leaving the page link.

/** Anchor ids that occur exactly once on a page (duplicates are unreliable jump targets). */
function uniqueAnchors(ids: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n === 1).map(([id]) => id));
}

function collectItemAnchors(nodes: ContentNode[], into: string[]): void {
  for (const n of nodes) {
    if (n.type !== "list") continue;
    for (const item of n.items) {
      if (item.anchor) into.push(item.anchor);
      collectItemAnchors(item.content, into);
    }
  }
}

const articleAnchors = new Map<string, Set<string>>();
for (const a of articles) {
  const ids: string[] = [];
  for (const p of a.paragraphs) {
    ids.push(p.anchor);
    collectItemAnchors(p.content, ids);
  }
  articleAnchors.set(String(a.number), uniqueAnchors(ids));
}
const annexAnchors = new Map<string, Set<string>>();
for (const a of annexes) {
  const ids: string[] = [];
  collectItemAnchors(a.content, ids);
  annexAnchors.set(a.roman.toLowerCase(), uniqueAnchors(ids));
}
const chapterRomans = new Set(chapters.map((c) => c.roman.toLowerCase()));
const recitalNumbers = new Set(recitals.map((r) => String(r.number)));

let refCount = 0;

/** Validate a candidate href; returns it with the fragment stripped if unanchorable. */
function resolveRefHref(href: string, where: string): string {
  const [page, fragment] = href.split("#");
  if (page === "/") {
    // homepage chapter anchor: /#hoofdstuk-iii
    const roman = fragment?.replace(/^hoofdstuk-/, "") ?? "";
    if (!chapterRomans.has(roman)) throw new Error(`${where}: unresolvable chapter ref ${href}`);
    return href;
  }
  let anchors: Set<string> | undefined;
  const art = page.match(/^\/artikel\/(\d+)$/);
  const anx = page.match(/^\/bijlage\/([a-z]+)$/);
  const rct = page.match(/^\/overweging\/(\d+)$/);
  if (art) anchors = articleAnchors.get(art[1]);
  else if (anx) anchors = annexAnchors.get(anx[1]);
  else if (!rct || !recitalNumbers.has(rct[1])) {
    throw new Error(`${where}: unresolvable cross-reference target ${href}`);
  }
  if ((art || anx) && !anchors) throw new Error(`${where}: unresolvable cross-reference target ${href}`);
  if (!fragment) return href;
  return anchors?.has(fragment) ? href : page;
}

function annotateNodes(nodes: ContentNode[], ctx: RefContext, selfHref: string, where: string): void {
  for (const n of nodes) {
    if (n.type === "text") {
      const refs = findRefs(n.text, ctx)
        .map((r) => ({ ...r, href: resolveRefHref(r.href, where) }))
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

for (const a of articles) {
  const ctx: RefContext = {
    selfType: "artikel",
    selfRef: String(a.number),
    // amendment articles quote text of other acts; only explicit self-forms link
    linkBareRefs: !(a.number >= 102 && a.number <= 110),
  };
  for (const p of a.paragraphs) {
    annotateNodes(p.content, ctx, `/artikel/${a.number}`, `artikel ${a.number}`);
  }
}
for (const r of recitals) {
  const ctx: RefContext = { selfType: "overweging", selfRef: String(r.number) };
  for (const p of r.paragraphs) {
    const refs = findRefs(p.text, ctx)
      .map((s) => ({ ...s, href: resolveRefHref(s.href, `overweging ${r.number}`) }))
      .filter((s) => s.href !== `/overweging/${r.number}`);
    if (refs.length > 0) {
      p.refs = refs;
      refCount += refs.length;
    }
  }
}
for (const a of annexes) {
  const ctx: RefContext = { selfType: "bijlage", selfRef: a.roman };
  annotateNodes(a.content, ctx, `/bijlage/${a.roman.toLowerCase()}`, `bijlage ${a.roman}`);
}

// ------------------------------------------------- toc

const toc: Toc = {
  chapters: chapters.map((c): TocChapter => {
    const inChapter = articles.filter((a) => a.chapter === c.roman);
    return {
      roman: c.roman,
      title: c.title,
      sections: c.sections.map((s) => ({
        number: s.number,
        title: s.title,
        articles: inChapter
          .filter((a) => a.section === s.number)
          .map((a) => ({ number: a.number, title: a.title })),
      })),
      articles: inChapter
        .filter((a) => a.section === null)
        .map((a) => ({ number: a.number, title: a.title })),
    };
  }),
  annexes: annexes.map((a) => ({ roman: a.roman, title: a.title })),
  recitalCount: recitals.length,
};

// ------------------------------------------------- search docs

const searchDocs: SearchDoc[] = [];
for (const a of articles) {
  for (const p of a.paragraphs) {
    const lid = p.number !== null ? `, lid ${p.number}` : "";
    searchDocs.push({
      id: `art-${a.number}-${p.anchor}`,
      type: "artikel",
      ref: String(a.number),
      heading: `Artikel ${a.number} — ${a.title}${lid}`,
      url: `/artikel/${a.number}#${p.anchor}`,
      text: flattenNodes(p.content),
    });
  }
}
for (const r of recitals) {
  searchDocs.push({
    id: `rct-${r.number}`,
    type: "overweging",
    ref: String(r.number),
    heading: `Overweging ${r.number}`,
    url: `/overweging/${r.number}`,
    text: r.paragraphs.map((p) => p.text).join(" "),
  });
}
for (const a of annexes) {
  // chunk per top-level list item ("punt"), with heading-group buffers for
  // the surrounding prose — one search doc per point keeps rare terms from
  // drowning in annex-wide text and gives snippets the right region
  const roman = a.roman.toLowerCase();
  // deep-link fragments only for anchors unique on the annex page (VII/VIII/X
  // repeat punt-* anchors across lists under different headings)
  const anchorCounts = new Map<string, number>();
  for (const node of a.content) {
    if (node.type !== "list") continue;
    for (const item of node.items) {
      if (item.anchor) anchorCounts.set(item.anchor, (anchorCounts.get(item.anchor) ?? 0) + 1);
    }
  }
  let seq = 0;
  let heading = "";
  let buf: string[] = [];
  const usedIds = new Set<string>();
  const push = (suffix: string, anchor: string | null, text: string) => {
    if (!text.trim()) return;
    seq += 1;
    let id = anchor ? `anx-${roman}-${anchor}` : `anx-${roman}-${seq}`;
    if (usedIds.has(id)) id = `anx-${roman}-${seq}`;
    usedIds.add(id);
    const fragment = anchor && anchorCounts.get(anchor) === 1 ? `#${anchor}` : "";
    searchDocs.push({
      id,
      type: "bijlage",
      ref: roman,
      heading: `Bijlage ${a.roman} — ${a.title}${heading ? ` (${heading})` : ""}${suffix}`,
      url: `/bijlage/${roman}${fragment}`,
      text,
    });
  };
  const flush = () => {
    if (buf.length === 0) return;
    push("", null, buf.join(" "));
    buf = [];
  };
  for (const node of a.content) {
    if (node.type === "heading") {
      flush();
      heading = node.text;
    } else if (node.type === "list") {
      flush();
      for (const item of node.items) {
        const label = markerToSlug(item.marker);
        push(
          label ? `, punt ${label}` : "",
          item.anchor ?? null,
          `${item.marker} ${flattenNodes(item.content)}`.trim(),
        );
      }
    } else {
      buf.push(flattenNodes([node]));
    }
  }
  flush();
}

// ------------------------------------------------- write

const outDir = join(root, "data/generated");
mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) =>
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 1) + "\n");

write("toc.json", toc);
write("articles.json", articles);
write("recitals.json", recitals);
write("annexes.json", annexes);
write("search-docs.json", searchDocs);
copyFileSync(join(outDir, "search-docs.json"), join(root, "public/search-docs.json"));

console.log(
  `parsed: ${articles.length} articles, ${recitals.length} recitals, ${annexes.length} annexes, ` +
    `${chapters.length} chapters, ${footnoteTextById.size} footnotes, ${searchDocs.length} search docs, ` +
    `${refCount} cross-references`,
);
