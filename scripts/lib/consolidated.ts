/**
 * Pure EUR-Lex HTML → corpus parsers, shared by parse-aiact.ts (the base
 * corpus) and parse-amendments.ts (the previous consolidated version the
 * change layer diffs against). No module state: every call loads its own
 * cheerio document.
 *
 * Two EUR-Lex HTML dialects:
 *
 * 1. Consolidated text (parseConsolidated). Markup: div.eli-subdivision#art_N
 *    > p.title-article-norm + .eli-title > p.stitle-article-norm; leden as
 *    div.norm > span.no-parag ("1.") + div.norm.inline-element; points as
 *    div.grid-container.grid-list (.grid-list-column-1 = marker,
 *    .grid-list-column-2 = content, nesting recursively); chapters
 *    div#cpt_III (+ #cpt_III.sct_1) with p.title-division-1/2; annexes
 *    div#anx_III with p.title-annex-1/2 and p.title-gr-seq-level-1
 *    sub-headings; footnotes p.footnote at document end, referenced inline
 *    via <a href="#E0001" id="src.E0001">.
 *
 * 2. Original OJ text (parseRecitals). Consolidated versions omit the
 *    preamble, so the 180 recitals come from here: div.eli-subdivision#rct_N
 *    with a 2-col table ("(N)" | text).
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { assignItemAnchors } from "../../src/lib/flatten";
import type { Annex, Article, ArticleParagraph, ContentNode, Footnote, ListItem, Recital } from "../../src/lib/types";

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
export function romanToInt(roman: string): number {
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const v = ROMAN_VALUES[roman[i]];
    const next = ROMAN_VALUES[roman[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

export function cleanText(raw: string): string {
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

const SKIP_P_CLASSES = [
  "footnote",
  "arrow",
  "title-article-norm",
  "title-annex-1",
  "title-annex-2",
  "title-division-1",
  "title-division-2",
];

export interface ChapterInfo {
  roman: string;
  title: string;
  sections: { number: number; title: string }[];
}

export interface ParsedConsolidated {
  chapters: ChapterInfo[];
  articles: Article[];
  annexes: Annex[];
  footnoteCount: number;
}

export function parseConsolidated(html: string): ParsedConsolidated {
  const $ = cheerio.load(html);

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

  // ----------------------------------------------- footnotes (global, ref-attached)

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

  // ----------------------------------------------- structure walk

  interface ChapterEl {
    roman: string;
    title: string;
    el: Element;
    sections: { number: number; title: string; el: Element }[];
  }
  const chapters: ChapterEl[] = [];
  $("div[id]").each((_, el) => {
    const id = $(el).attr("id")!;
    if (!/^cpt_[IVXLC]+$/.test(id)) return;
    const roman = id.slice(4);
    const title = cleanText($(el).find("p.title-division-2").first().text());
    const sections: { number: number; title: string; el: Element }[] = [];
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

  // ----------------------------------------------- annexes

  const annexes: Annex[] = [];
  $("div[id]").each((_, el) => {
    const m = $(el).attr("id")!.match(/^anx_([IVXLC]+)$/);
    if (!m) return;
    const roman = m[1];
    const title = cleanText($(el).find("p.title-annex-2").first().text()) || `Bijlage ${roman}`;
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

  return {
    chapters: chapters.map((c) => ({
      roman: c.roman,
      title: c.title,
      sections: c.sections.map((s) => ({ number: s.number, title: s.title })),
    })),
    articles,
    annexes,
    footnoteCount: footnoteTextById.size,
  };
}

/** Recitals from the original OJ text (div.eli-subdivision#rct_N, 2-col table). */
export function parseRecitals(html: string): Recital[] {
  const $oj = cheerio.load(html);
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
  return recitals;
}
