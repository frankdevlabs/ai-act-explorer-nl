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
import { assignItemAnchors, lidAnchor } from "../../src/lib/flatten";
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

/**
 * Where an amending act's text sits in a consolidated version, read from
 * EUR-Lex's own block markers (p.modref "▼M1" with a[title] "32026R1744:
 * REPLACED|INSERTED|DELETED"; "▼B" returns to the base act). A marker governs
 * all following content until the next ▼ marker. Not persisted — the change
 * layer cross-checks its diff against it (verify-amendments gate b).
 */
export interface Provenance {
  celex: string;
  kind: "article" | "annex";
  /** Article slug ("4bis") or lowercase annex roman ("xiv"). */
  slug: string;
  /** "titel", a paragraph anchor ("lid-1bis", "inhoud") or "inhoud" for annexes. */
  anchor: string;
  /** DELETED placeholders only; other blocks may mix REPLACED and INSERTED. */
  deleted?: true;
}

export interface ParsedConsolidated {
  chapters: ChapterInfo[];
  articles: Article[];
  annexes: Annex[];
  footnoteCount: number;
  provenance: Provenance[];
}

/** EUR-Lex encodes "4 bis" as art_4a, "75 quater" as art_75c. */
const ID_SUFFIX: Record<string, string> = { a: "bis", b: "ter", c: "quater", d: "quinquies", e: "sexies" };
const LID_MARKER = /^(\d+)(?: (bis|ter|quater|quinquies|sexies|septies|octies))?\.$/;
/** A DELETED block marker carries EUR-Lex's placeholder for the struck text. */
const PLACEHOLDER = /^▼\S+ (—{3,})$/;

export function parseConsolidated(html: string): ParsedConsolidated {
  const $ = cheerio.load(html);

  // ----------------------------------------------- consolidation markers
  // Document-order pre-pass: the ▼ marker in force at every element.
  interface MarkerState {
    celex: string;
    op?: string;
  }
  const stateOf = new Map<Element, MarkerState>();
  let state: MarkerState = { celex: "" };
  $("body *").each((_, el) => {
    const classes = ($(el).attr("class") ?? "").split(/\s+/);
    if (el.tagName === "p" && (classes.includes("modref") || classes.includes("arrow"))) {
      const text = cleanText($(el).text());
      if (text.startsWith("▼")) {
        const [celex, op] = ($(el).find("a[title]").first().attr("title") ?? "").split(/:\s*/);
        if (!celex) throw new Error(`consolidation marker without act: ${text}`);
        state = { celex, op };
      }
    }
    stateOf.set(el, state);
  });
  /** Acts (CELEX) governing text-bearing elements within `nodes`; a struck-
   *  provision placeholder counts as text of the act that struck it. */
  function governingActs(nodes: AnyNode[]): Set<string> {
    const acts = new Set<string>();
    const visit = (n: AnyNode) => {
      if (!isTag(n)) return;
      const classes = ($(n).attr("class") ?? "").split(/\s+/);
      if (n.tagName === "p" && classes.includes("modref")) {
        if (PLACEHOLDER.test(cleanText($(n).text()))) acts.add(stateOf.get(n)!.celex);
        return;
      }
      if (n.tagName === "p" && classes.includes("title-article-norm")) return;
      const ownText = n.children.some((c) => isText(c) && c.data.trim() !== "");
      if (ownText) acts.add(stateOf.get(n)!.celex);
      n.children.forEach(visit);
    };
    nodes.forEach(visit);
    return acts;
  }
  /** Acts that struck provisions inside `el` (DELETED placeholders). */
  function strikingActs(el: Element): Set<string> {
    const acts = new Set<string>();
    $(el)
      .find("p.modref")
      .each((_, m) => {
        if (PLACEHOLDER.test(cleanText($(m).text()))) acts.add(stateOf.get(m)!.celex);
      });
    return acts;
  }
  const provenance: Provenance[] = [];

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
        if (cls.includes("modref")) {
          // consolidation marker: no text of its own, except EUR-Lex's
          // placeholder where an amending act struck a provision
          const ph = cleanText($child.text()).match(PLACEHOLDER);
          if (ph) nodes.push({ type: "text", text: ph[1], repealed: true });
          continue;
        }
        if (SKIP_P_CLASSES.some((c) => cls.includes(c))) continue;
        if (cls.includes("title-gr-seq")) {
          const text = cleanText($child.text());
          if (text) nodes.push({ type: "heading", text });
          continue;
        }
        const text = cleanText($child.text());
        if (text) nodes.push({ type: "text", text });
      } else if (child.tagName === "table") {
        // data table (bijlage XIV): direct rows only — a nested table's text
        // belongs to the cell that contains it
        const rows = $child
          .children("tbody")
          .children("tr")
          .add($child.children("tr"))
          .toArray()
          .map((tr) =>
            $(tr)
              .children("td, th")
              .toArray()
              .map((td) => cleanText($(td).text())),
          );
        if (rows.length === 0) throw new Error("empty <table> in corpus text");
        nodes.push({ type: "table", rows });
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
    if (!id.startsWith("art_") || id.includes(".")) return;
    const m = id.match(/^art_(\d+)([a-e])?$/);
    if (!m) throw new Error(`unrecognized article id ${id}`);
    const number = Number(m[1]);
    const suffix = m[2] ? ID_SUFFIX[m[2]] : undefined;
    const slug = suffix ? `${number}${suffix}` : String(number);
    const displayNumber = suffix ? `${number} ${suffix}` : String(number);
    const heading = cleanText($(el).children("p.title-article-norm").first().text());
    if (heading !== `Artikel ${displayNumber}`)
      throw new Error(`${id}: heading "${heading}" does not match Artikel ${displayNumber}`);
    const titleDiv = $(el).children(".eli-title").first();
    const title = cleanText(titleDiv.find(".stitle-article-norm").first().text());
    for (const act of governingActs(titleDiv.toArray()))
      provenance.push({ celex: act, kind: "article", slug, anchor: "titel" });

    const chapter = chapters.find((c) => $.contains(c.el, el));
    if (!chapter) throw new Error(`Article ${displayNumber}: no containing chapter`);
    const section = chapter.sections.find((s) => $.contains(s.el, el)) ?? null;

    // Walk direct children in document order. A div.norm with an unquoted "N."
    // no-parag marker starts a new lid (quoted markers belong to text of amended
    // acts, art. 102-110); everything else — continuation alineas are SIBLINGS
    // of the lid div in this dialect — is appended to the current lid.
    interface Entry {
      lid: number | null;
      /** "1 bis" for inserted leden outside numeric numbering */
      display?: string;
      repealed?: true;
      content: ContentNode[];
      dom: AnyNode[];
    }
    const entries: Entry[] = [];
    let buffer: AnyNode[] = [];
    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const nodes = parseNodes(buffer);
      const dom = buffer;
      buffer = [];
      if (nodes.length === 0) return;
      if (entries.length === 0) entries.push({ lid: null, content: [], dom: [] });
      const last = entries[entries.length - 1];
      last.content.push(...nodes);
      last.dom.push(...dom);
    };
    for (const child of el.children) {
      if (isTag(child)) {
        const $child = $(child);
        const cls = $child.attr("class") ?? "";
        if (child.tagName === "p" && cls.includes("title-article-norm")) continue;
        if (child.tagName === "div" && cls.includes("eli-title")) continue;
        if (child.tagName === "p" && cls.includes("modref")) {
          // a placeholder between leden is a struck lid of its own: it takes the
          // number after the previous lid (checked against the next one below)
          const ph = cleanText($child.text()).match(PLACEHOLDER);
          if (ph) {
            flushBuffer();
            const prev = entries[entries.length - 1];
            if (prev?.lid == null || prev.display)
              throw new Error(`${id}: struck-lid placeholder without a numbered predecessor`);
            entries.push({
              lid: prev.lid + 1,
              repealed: true,
              content: [{ type: "text", text: ph[1], repealed: true }],
              dom: [child],
            });
          }
          continue;
        }
        const marker = cleanText($child.children("span.no-parag").first().text());
        const lm = marker.match(LID_MARKER);
        if (child.tagName === "div" && cls.includes("norm") && lm) {
          flushBuffer();
          entries.push(
            lm[2]
              ? { lid: null, display: `${lm[1]} ${lm[2]}`, content: parseBlocks(child, true), dom: [child] }
              : { lid: Number(lm[1]), content: parseBlocks(child, true), dom: [child] },
          );
          continue;
        }
      }
      buffer.push(child);
    }
    flushBuffer();

    const paragraphs: ArticleParagraph[] = [];
    entries.forEach((e, i) => {
      if (e.repealed) {
        const next = entries.slice(i + 1).find((x) => x.lid !== null);
        if (next && next.lid !== e.lid! + 1)
          throw new Error(`${id}: struck lid ${e.lid} is followed by lid ${next.lid}`);
      }
      const numbered = e.lid !== null || e.display !== undefined;
      const anchor = e.display
        ? lidAnchor(e.display)
        : e.lid !== null
          ? lidAnchor(e.lid)
          : entries.length === 1
            ? "inhoud"
            : `alinea-${paragraphs.length + 1}`;
      // a duplicate anchor would shadow a deep link; it used to be renamed with
      // a "-bis" suffix, which now collides with legal bis-numbering
      if (paragraphs.some((p) => p.anchor === anchor)) throw new Error(`${id}: duplicate anchor ${anchor}`);
      assignItemAnchors(e.content, numbered ? anchor : "");
      const para: ArticleParagraph = { number: e.lid, anchor, content: e.content };
      if (e.display) para.displayNumber = e.display;
      if (e.repealed) para.repealed = true;
      paragraphs.push(para);
      for (const act of governingActs(e.dom)) {
        const prov: Provenance = { celex: act, kind: "article", slug, anchor };
        if (e.repealed) prov.deleted = true;
        provenance.push(prov);
      }
    });

    articles.push({
      number,
      slug,
      displayNumber,
      title,
      chapter: chapter.roman,
      chapterTitle: chapter.title,
      section: section?.number ?? null,
      sectionTitle: section?.title ?? null,
      paragraphs,
      footnotes: referencedFootnotes(el),
    });
  });
  // document order: 4 < 4 bis < 5 — EUR-Lex emits them in that order already
  const SUFFIX_RANK = ["", "bis", "ter", "quater", "quinquies", "sexies"];
  const rank = (a: Article) => SUFFIX_RANK.indexOf(a.slug.replace(/^\d+/, ""));
  articles.sort((a, b) => a.number - b.number || rank(a) - rank(b));

  // ----------------------------------------------- annexes

  const annexes: Annex[] = [];
  $("div[id]").each((_, el) => {
    const m = $(el).attr("id")!.match(/^anx_([IVXLC]+)$/);
    if (!m) return;
    const roman = m[1];
    const title = cleanText($(el).find("p.title-annex-2").first().text()) || `Bijlage ${roman}`;
    const content = parseBlocks(el);
    assignItemAnchors(content, "");
    for (const act of governingActs([el]))
      provenance.push({ celex: act, kind: "annex", slug: roman.toLowerCase(), anchor: "inhoud" });
    for (const act of strikingActs(el))
      provenance.push({ celex: act, kind: "annex", slug: roman.toLowerCase(), anchor: "inhoud", deleted: true });
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
    provenance,
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
