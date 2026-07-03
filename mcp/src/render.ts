import type {
  Annex,
  Article,
  ArticleParagraph,
  ContentNode,
  DiffSegment,
  Footnote,
  RefSpan,
} from "../../src/lib/types.js";
import { BASE_URL, type ResolvedArticle } from "./data.js";

/** Mirror of LinkedText: splice refs into markdown links, right-to-left so
 *  earlier offsets stay valid. Refs hold site-internal hrefs. */
export function renderText(text: string, refs?: RefSpan[]): string {
  if (!refs?.length) return text;
  let out = text;
  const sorted = [...refs].sort((a, b) => b.start - a.start);
  let prevStart = Infinity;
  for (const ref of sorted) {
    if (ref.start < 0 || ref.end > text.length || ref.end <= ref.start || ref.end > prevStart) {
      continue; // out-of-range or overlapping span — leave text as-is
    }
    out = `${out.slice(0, ref.start)}[${out.slice(ref.start, ref.end)}](${BASE_URL}${ref.href})${out.slice(ref.end)}`;
    prevStart = ref.start;
  }
  return out;
}

function renderTable(rows: string[][]): string {
  const esc = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  const [head, ...body] = rows;
  if (!head) return "";
  const lines = [
    `| ${head.map(esc).join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** ContentNode[] → markdown; traversal mirrors ContentNodes.tsx. */
export function renderNodes(nodes: ContentNode[]): string {
  const blocks: string[] = [];
  for (const node of nodes) {
    if (node.type === "heading") {
      blocks.push(`### ${node.text}`);
    } else if (node.type === "text") {
      blocks.push(renderText(node.text, node.refs));
    } else if (node.type === "table") {
      blocks.push(renderTable(node.rows));
    } else {
      const items = node.items.map((item) => {
        const body = renderNodes(item.content);
        const [first = "", ...rest] = body.split("\n");
        const restIndented = rest.map((l) => (l ? `  ${l}` : l)).join("\n");
        return `- **${item.marker}** ${first}${rest.length ? `\n${restIndented}` : ""}`;
      });
      blocks.push(items.join("\n"));
    }
  }
  return blocks.join("\n\n").trim();
}

export function renderFootnotes(footnotes: Footnote[]): string {
  if (!footnotes.length) return "";
  return `**Voetnoten**\n\n${footnotes.map((f) => `- [${f.label}] ${f.text}`).join("\n")}`;
}

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
