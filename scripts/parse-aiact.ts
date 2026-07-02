/**
 * One-time parser: official Dutch OJ HTML of Regulation (EU) 2024/1689
 * (data/source/aiact_nl.html) -> structured JSON in data/generated/.
 *
 * Source markup (EUR-Lex Formex-derived OJ HTML):
 * - chapters:  <div id="cpt_III"> with > p.oj-ti-section-1 + .eli-title
 * - sections:  <div id="cpt_III.sct_1"> nested inside chapters
 * - articles:  <div class="eli-subdivision" id="art_5">
 * - numbered paragraphs (leden): <div id="005.001"> inside the article
 * - points a)/1./i): 2-col <table> rows (marker | content), nesting recursively
 * - recitals:  <div class="eli-subdivision" id="rct_42"> (table (N) | text)
 * - annexes:   <div class="eli-container" id="anx_III"> with 2x p.oj-doc-ti
 * - footnotes: p.oj-note, referenced inline via <a href="#ntr...">
 */
import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const html = readFileSync(join(root, "data/source/aiact_nl.html"), "utf-8");
const $ = cheerio.load(html);

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
  return raw.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Visible text of an element, with footnote back-reference anchors kept as plain "(1)". */
function textOf(el: Cheerio<Element>): string {
  return cleanText(el.text());
}

const isTag = (n: unknown): n is Element =>
  typeof n === "object" && n !== null && "tagName" in n && (n as Element).type === "tag";

/**
 * Convert the children of a container into ContentNodes.
 * Consecutive point-tables merge into a single list node.
 */
function parseBlocks(container: Element): ContentNode[] {
  const nodes: ContentNode[] = [];
  for (const child of container.children) {
    if (!isTag(child)) continue;
    const $child = $(child);
    const cls = $child.attr("class") ?? "";
    if (child.tagName === "p") {
      if (cls.includes("oj-note") || cls.includes("oj-ti-art") || cls.includes("oj-doc-ti")) continue;
      if (cls.includes("oj-ti-grseq")) {
        const text = textOf($child);
        if (text) nodes.push({ type: "heading", text });
        continue;
      }
      const text = textOf($child);
      if (text) nodes.push({ type: "text", text });
    } else if (child.tagName === "table") {
      const items = parsePointTable(child);
      if (items.length === 0) continue;
      const last = nodes[nodes.length - 1];
      if (last?.type === "list") last.items.push(...items);
      else nodes.push({ type: "list", items });
    } else if (child.tagName === "div") {
      // quoted amendment blocks, .eli-title wrappers, etc. -> recurse
      if (cls.includes("eli-title")) continue;
      nodes.push(...parseBlocks(child));
    } else if (child.tagName !== "hr") {
      // inline containers (annex list cells hold bare <span>s)
      const text = textOf($child);
      if (text) nodes.push({ type: "text", text });
    }
  }
  return nodes;
}

/** A point table: each row = marker cell(s) + content cell (last td). */
function parsePointTable(table: Element): ListItem[] {
  const items: ListItem[] = [];
  const rows = $(table).children("tbody").children("tr");
  rows.each((_, tr) => {
    const cells = $(tr).children("td").toArray();
    if (cells.length === 0) return;
    if (cells.length === 1) {
      // spanning row: fold its content into the previous item if any
      const content = parseBlocks(cells[0]);
      const prev = items[items.length - 1];
      if (prev) prev.content.push(...content);
      else items.push({ marker: "", content });
      return;
    }
    const contentCell = cells[cells.length - 1];
    const marker = cells
      .slice(0, -1)
      .map((td) => textOf($(td)))
      .filter(Boolean)
      .join(" ");
    items.push({ marker, content: parseBlocks(contentCell) });
  });
  return items;
}

/** Collect p.oj-note descendants of a container as footnotes (they are excluded from the body). */
function collectFootnotes(container: Element): Footnote[] {
  const notes: Footnote[] = [];
  $(container)
    .find("p.oj-note")
    .each((_, p) => {
      const $p = $(p);
      const $a = $p.find("a").first();
      const label = cleanText($a.text()) || "(*)";
      const id = $a.attr("id") ?? `note-${notes.length + 1}`;
      const clone = $p.clone();
      clone.find("a").first().remove();
      notes.push({ id, label, text: cleanText(clone.text()) });
    });
  return notes;
}

function markerToSlug(marker: string): string {
  return marker
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Anchor slugs for the top-level list items of a paragraph (lid-1-a, punt-12). */
function assignItemAnchors(content: ContentNode[], prefix: string): void {
  for (const node of content) {
    if (node.type !== "list") continue;
    for (const item of node.items) {
      const slug = markerToSlug(item.marker);
      if (slug) item.anchor = prefix ? `${prefix}-${slug}` : `punt-${slug}`;
    }
  }
}

// ---------------------------------------------------------------- articles

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
  const title = textOf($(el).children(".eli-title").first());
  const sections: ChapterInfo["sections"] = [];
  $(el)
    .find("div[id]")
    .each((_, s) => {
      const sid = $(s).attr("id")!;
      const m = sid.match(/^cpt_[IVXLC]+\.sct_(\d+)$/);
      if (!m) return;
      sections.push({
        number: Number(m[1]),
        title: textOf($(s).children(".eli-title").first()),
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
  const title = textOf($(el).children(".eli-title").find(".oj-sti-art").first());

  const chapter = chapters.find((c) => $.contains(c.el, el));
  if (!chapter) throw new Error(`Article ${number}: no containing chapter`);
  const section = chapter.sections.find((s) => $.contains(s.el, el)) ?? null;

  const footnotes = collectFootnotes(el);

  // numbered paragraph divs: id NNN.MMM
  const paraDivs = $(el)
    .children("div[id]")
    .toArray()
    .filter((d) => /^\d{3}\.\d{3}$/.test($(d).attr("id")!));

  const paragraphs: ArticleParagraph[] = [];
  if (paraDivs.length > 0) {
    for (const d of paraDivs) {
      const mm = Number($(d).attr("id")!.split(".")[1]);
      const content = parseBlocks(d);
      // the printed lid number is authoritative (div ids drift where the OJ
      // numbering skips, e.g. art. 73 has no lid 10); a quoted marker ("1.)
      // is amendment text, not a lid of this article
      const first = content[0];
      let lid: number | null = null;
      if (first?.type === "text") {
        const lm = first.text.match(/^(\d+)\.\s+/);
        if (lm) {
          lid = Number(lm[1]);
          first.text = first.text.replace(/^\d+\.\s+/, "");
        }
      }
      const base = lid !== null ? `lid-${lid}` : paraDivs.length === 1 ? "inhoud" : `alinea-${mm}`;
      // the OJ itself contains duplicate lid numbers (art. 73 prints "11." twice)
      let anchor = base;
      for (let n = 2; paragraphs.some((p) => p.anchor === anchor); n++) {
        anchor = `${base}-bis${n > 2 ? `-${n}` : ""}`;
      }
      assignItemAnchors(content, anchor);
      paragraphs.push({ number: lid, anchor, content });
    }
  } else {
    // flat article: whole body is one unnumbered paragraph
    const content = parseBlocks(el).filter(
      (n) => !(n.type === "text" && /^Artikel \d+$/.test(n.text)),
    );
    assignItemAnchors(content, "");
    paragraphs.push({ number: null, anchor: "inhoud", content });
  }

  articles.push({
    number,
    title,
    chapter: chapter.roman,
    chapterTitle: chapter.title,
    section: section?.number ?? null,
    sectionTitle: section?.title ?? null,
    paragraphs,
    footnotes,
  });
});
articles.sort((a, b) => a.number - b.number);

// ---------------------------------------------------------------- recitals

const recitals: Recital[] = [];
$("div.eli-subdivision[id]").each((_, el) => {
  const m = $(el).attr("id")!.match(/^rct_(\d+)$/);
  if (!m) return;
  const cells = $(el).find("tr").first().children("td");
  const paragraphs = cells
    .last()
    .children("p")
    .toArray()
    .map((p) => textOf($(p)))
    .filter(Boolean);
  recitals.push({ number: Number(m[1]), paragraphs });
});
recitals.sort((a, b) => a.number - b.number);

// ---------------------------------------------------------------- annexes

const annexes: Annex[] = [];
$("div.eli-container[id]").each((_, el) => {
  const m = $(el).attr("id")!.match(/^anx_([IVXLC]+)$/);
  if (!m) return;
  const roman = m[1];
  const docTitles = $(el)
    .children("p.oj-doc-ti")
    .toArray()
    .map((p) => textOf($(p)));
  const title = docTitles[1] ?? docTitles[0] ?? `Bijlage ${roman}`;
  const footnotes = collectFootnotes(el);
  const content = parseBlocks(el);
  assignItemAnchors(content, "");
  annexes.push({ roman, ordinal: romanToInt(roman), title, content, footnotes });
});
annexes.sort((a, b) => a.ordinal - b.ordinal);

// ---------------------------------------------------------------- toc

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

// ---------------------------------------------------------------- search docs

function flattenNodes(nodes: ContentNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "list")
        return n.items.map((i) => `${i.marker} ${flattenNodes(i.content)}`).join(" ");
      return n.text;
    })
    .join(" ")
    .trim();
}

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
    text: r.paragraphs.join(" "),
  });
}
for (const a of annexes) {
  // chunk per heading (or whole annex when no headings)
  let chunkIdx = 0;
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    chunkIdx += 1;
    searchDocs.push({
      id: `anx-${a.roman.toLowerCase()}-${chunkIdx}`,
      type: "bijlage",
      ref: a.roman.toLowerCase(),
      heading: `Bijlage ${a.roman} — ${a.title}${heading ? ` (${heading})` : ""}`,
      url: `/bijlage/${a.roman.toLowerCase()}`,
      text: buf.join(" "),
    });
    buf = [];
  };
  for (const node of a.content) {
    if (node.type === "heading") {
      flush();
      heading = node.text;
    } else {
      buf.push(flattenNodes([node]));
    }
  }
  flush();
}

// ---------------------------------------------------------------- write

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
    `${chapters.length} chapters, ${searchDocs.length} search docs`,
);
