import type {
  Annex,
  Article,
  ArticleParagraph,
  ContentNode,
  DiffSegment,
  Footnote,
  RefSpan,
} from "../../src/lib/types.js";
import { APPLICATION_CAVEAT, actLabel, actShort, inForceSince } from "../../src/lib/amendment-meta.js";
import { lidLabel } from "../../src/lib/flatten.js";
import { BASE_URL, amendmentDiffs, amendments, isNewAnnex, isNewArticle, type ResolvedArticle } from "./data.js";

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
