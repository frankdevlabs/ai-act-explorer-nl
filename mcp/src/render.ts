import type { Annex, ArticleParagraph, DiffSegment } from "../../src/lib/types.js";
import { APPLICATION_CAVEAT, actLabel, actShort, inForceSince } from "../../src/lib/amendment-meta.js";
import { lidLabel } from "../../src/lib/flatten.js";
import {
  BASE_URL,
  amendmentDiffs,
  amendments,
  isNewAnnex,
  isNewArticle,
  type ResolvedArticle,
} from "./data.js";
import { createMarkdown } from "./core/markdown.js";

/**
 * The corpus-specific render layer: everything below needs an article slug, the
 * amending-act status banner (Vo 2026/1744, in force) or a diff segment. The corpus-agnostic half (text/table/node/
 * footnote/ref rendering) lives in core/markdown.ts and is re-exported here, so
 * call sites keep importing the whole render surface from one module.
 * See mcp/README.md, "Code layout (core/ vs corpus)".
 */
const md = createMarkdown({ baseUrl: BASE_URL });
export const { renderText, renderNodes, renderFootnotes, refLinks } = md;

function renderParagraphs(paragraphs: ArticleParagraph[]): string {
  return paragraphs
    .map((p) => {
      const label = lidLabel(p);
      const heading = label !== null ? `## Lid ${label}\n\n` : "";
      const struck = p.repealed ? `\n\n*Geschrapt bij ${actShort(amendments.meta)}.*` : "";
      return `${heading}${renderNodes(p.content)}${struck}`;
    })
    .join("\n\n");
}

function contextLine(a: {
  chapter: string;
  chapterTitle: string;
  section: number | null;
  sectionTitle: string | null;
}): string {
  const section =
    a.section != null ? ` · Afdeling ${a.section}${a.sectionTitle ? ` — ${a.sectionTitle}` : ""}` : "";
  return `*Hoofdstuk ${a.chapter} — ${a.chapterTitle}${section}*`;
}

function deepLinks(slug: string, paragraphs: ArticleParagraph[]): string {
  const links = paragraphs
    .filter((p) => lidLabel(p) !== null && !p.repealed)
    .map((p) => `- ${BASE_URL}/artikel/${slug}#${p.anchor}`);
  return [`**Deep links**`, `- ${BASE_URL}/artikel/${slug}`, ...links].join("\n");
}

export function renderArticle(resolved: ResolvedArticle): string {
  const a = resolved.article;
  const m = amendments.meta;
  return [
    `# Artikel ${a.displayNumber} — ${a.title}`,
    contextLine(a),
    isNewArticle(a.slug) ? `> Ingevoegd bij ${actLabel(m)}, ${inForceSince(m)}. ${APPLICATION_CAVEAT}` : "",
    renderParagraphs(a.paragraphs),
    renderFootnotes(a.footnotes),
    deepLinks(a.slug, a.paragraphs),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderAnnex(a: Annex): string {
  const m = amendments.meta;
  const roman = a.roman.toLowerCase();
  const status = isNewAnnex(roman)
    ? `> Toegevoegd bij ${actLabel(m)}, ${inForceSince(m)}.`
    : amendmentDiffs.annexes[roman]
      ? `> Let op: deze bijlage is gewijzigd bij ${actLabel(m)}, ${inForceSince(m)}; de wijzigingen: ${BASE_URL}/bijlage/${roman}?diff=1.`
      : "";
  return [
    `# Bijlage ${a.roman} — ${a.title}`,
    status,
    renderNodes(a.content),
    renderFootnotes(a.footnotes),
    `**Deep link**: ${BASE_URL}/bijlage/${roman}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Word-diff segments → running text with ~~del~~ / **ins** markup. */
export function renderSegments(segments: DiffSegment[]): string {
  return segments
    .map((s) => {
      const t = s.text;
      if (!t.trim()) return t;
      if (s.op === "del") return `~~${t.trim()}~~${t.endsWith(" ") ? " " : ""}`;
      if (s.op === "ins") return `**${t.trim()}**${t.endsWith(" ") ? " " : ""}`;
      return t;
    })
    .join("");
}
