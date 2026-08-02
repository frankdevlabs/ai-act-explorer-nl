/**
 * The markdown render helpers shared by the explorer MCP servers: splicing
 * cross-reference links into text, tables, the ContentNode traversal and
 * footnotes. Everything that needs a route prefix or an instrument id stays in
 * each repo's own render.ts.
 *
 * Structural types, not imports: `MdNode` & friends are a superset of each
 * repo's `ContentNode` union, limited to the fields these renderers actually
 * read, so a repo's own types are assignable without core depending on them.
 */

/** Internal cross-reference span; `href` is a site-internal route. */
export interface MdRefSpan {
  start: number;
  end: number;
  href: string;
}

export interface MdFootnote {
  label: string;
  text: string;
}

export interface MdListItem {
  marker: string;
  content: MdNode[];
}

export type MdNode =
  | { type: "text"; text: string; refs?: MdRefSpan[] }
  | { type: "heading"; text: string }
  | { type: "list"; items: MdListItem[] }
  | { type: "table"; rows: string[][] }
  | { type: "figure"; alt?: string };

/** Deep-link label + href pair (assessment refs). */
export interface MdLinkRef {
  label: string;
  href: string;
}

export interface MarkdownOptions {
  /** Absolute origin every site-internal href is prefixed with. */
  baseUrl: string;
  /**
   * Escape hatch for a repo whose node union has drifted from core's — return
   * a rendered block to override the default, or `undefined` to fall through.
   * `figure` is the precedent: dora grew that kind in epic 14 while the sibling
   * explorers had not, and it took a fork of this file to carry it.
   */
  renderNode?: (node: MdNode) => string | undefined;
}

export function createMarkdown({ baseUrl, renderNode }: MarkdownOptions) {
  /** Mirror of LinkedText: splice refs into markdown links, right-to-left so
   *  earlier offsets stay valid. Refs hold site-internal hrefs. */
  function renderText(text: string, refs?: MdRefSpan[]): string {
    if (!refs?.length) return text;
    let out = text;
    const sorted = [...refs].sort((a, b) => b.start - a.start);
    let prevStart = Infinity;
    for (const ref of sorted) {
      if (ref.start < 0 || ref.end > text.length || ref.end <= ref.start || ref.end > prevStart) {
        continue; // out-of-range or overlapping span — leave text as-is
      }
      out = `${out.slice(0, ref.start)}[${out.slice(ref.start, ref.end)}](${baseUrl}${ref.href})${out.slice(ref.end)}`;
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
  function renderNodes(nodes: MdNode[]): string {
    const blocks: string[] = [];
    for (const node of nodes) {
      const override = renderNode?.(node);
      if (override !== undefined) {
        blocks.push(override);
      } else if (node.type === "heading") {
        blocks.push(`### ${node.text}`);
      } else if (node.type === "text") {
        blocks.push(renderText(node.text, node.refs));
      } else if (node.type === "table") {
        blocks.push(renderTable(node.rows));
      } else if (node.type === "figure") {
        // data: URI is megabytes of base64 — a placeholder serves MCP clients better
        blocks.push(node.alt ? `*[afbeelding: ${node.alt}]*` : "*[afbeelding]*");
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

  function renderFootnotes(footnotes: MdFootnote[]): string {
    if (!footnotes.length) return "";
    return `**Voetnoten**\n\n${footnotes.map((f) => `- [${f.label}] ${f.text}`).join("\n")}`;
  }

  /** Ref[] → " · "-joined deep links. */
  const refLinks = (refs: MdLinkRef[] | undefined) =>
    (refs ?? []).map((r) => `[${r.label}](${baseUrl}${r.href})`).join(" · ");

  return { renderText, renderTable, renderNodes, renderFootnotes, refLinks };
}

export type Markdown = ReturnType<typeof createMarkdown>;
