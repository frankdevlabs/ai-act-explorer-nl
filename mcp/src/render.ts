import type { Annex, ArticleParagraph, DiffSegment } from "../../src/lib/types.js";
import { BASE_URL, type ResolvedArticle } from "./data.js";
import { createMarkdown } from "./core/markdown.js";

/**
 * The corpus-specific render layer: everything below needs an article slug, the
 * omnibus banner or a diff segment. The corpus-agnostic half (text/table/node/
 * footnote/ref rendering) lives in core/markdown.ts and is re-exported here, so
 * call sites keep importing the whole render surface from one module.
 * See mcp/README.md, "Code layout (core/ vs corpus)".
 */
const md = createMarkdown({ baseUrl: BASE_URL });
export const { renderText, renderNodes, renderFootnotes, refLinks } = md;

function renderParagraphs(paragraphs: ArticleParagraph[]): string {
  return paragraphs
    .map((p) => {
      const heading = p.number != null ? `## Lid ${p.number}\n\n` : "";
      return `${heading}${renderNodes(p.content)}`;
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
    .filter((p) => p.number != null)
    .map((p) => `- ${BASE_URL}/artikel/${slug}#${p.anchor}`);
  return [`**Deep links**`, `- ${BASE_URL}/artikel/${slug}`, ...links].join("\n");
}

export function renderArticle(resolved: ResolvedArticle): string {
  if (resolved.kind === "base") {
    const a = resolved.article;
    return [
      `# Artikel ${a.number} — ${a.title}`,
      contextLine(a),
      renderParagraphs(a.paragraphs),
      renderFootnotes(a.footnotes),
      deepLinks(String(a.number), a.paragraphs),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const s = resolved.spec;
  return [
    `# Artikel ${s.displayNumber} — ${s.title}`,
    contextLine(resolved),
    `> Ingevoegd door de digitale omnibus (PE-CONS 30/26) — nog niet in werking.`,
    renderParagraphs(s.paragraphs),
    deepLinks(s.slug, s.paragraphs),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderAnnex(a: Annex, isNew: boolean): string {
  return [
    `# Bijlage ${a.roman} — ${a.title}`,
    isNew ? `> Toegevoegd door de digitale omnibus (PE-CONS 30/26) — nog niet in werking.` : "",
    renderNodes(a.content),
    renderFootnotes(a.footnotes),
    `**Deep link**: ${BASE_URL}/bijlage/${a.roman.toLowerCase()}`,
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
