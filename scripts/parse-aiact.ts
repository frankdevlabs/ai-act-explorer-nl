/**
 * Corpus parser -> structured JSON in data/generated/.
 *
 * Sources are listed in data/source/corpus.json: `base` is the consolidated
 * text the site and MCP serve (articles/annexes/TOC), `recitals` the original
 * OJ text (consolidated versions omit the preamble). Dialect handling lives in
 * scripts/lib/consolidated.ts; this script adds the cross-reference post-pass,
 * the TOC and the search docs, and writes the generated files.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRefs, type RefContext } from "../src/lib/crossrefs";
import { flattenNodes, markerToSlug } from "../src/lib/flatten";
import type { ContentNode, SearchDoc, Toc, TocChapter } from "../src/lib/types";
import { parseConsolidated, parseRecitals } from "./lib/consolidated";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(readFileSync(join(root, "data/source/corpus.json"), "utf-8")) as {
  base: { celex: string; file: string };
  recitals: { celex: string; file: string };
};
const read = (rel: string) => readFileSync(join(root, "data/source", rel), "utf-8");

const { chapters, articles, annexes, footnoteCount } = parseConsolidated(read(corpus.base.file));
const recitals = parseRecitals(read(corpus.recitals.file));

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
          .map((a) => ({ number: a.number, slug: a.slug, displayNumber: a.displayNumber, title: a.title })),
      })),
      articles: inChapter
        .filter((a) => a.section === null)
        .map((a) => ({ number: a.number, slug: a.slug, displayNumber: a.displayNumber, title: a.title })),
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
    `${chapters.length} chapters, ${footnoteCount} footnotes, ${searchDocs.length} search docs, ` +
    `${refCount} cross-references`,
);
