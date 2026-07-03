import type { ContentNode } from "./types";

/**
 * Canonical flat-text projection of a ContentNode tree (markers included).
 * Single source of truth: the amendment diff invariant
 * (concat(eq+del) === flatten(old) && concat(eq+ins) === flatten(new))
 * only holds if every producer and verifier flattens byte-identically —
 * import this everywhere, never re-implement.
 */
export function flattenNodes(nodes: ContentNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "list")
        return n.items.map((i) => `${i.marker} ${flattenNodes(i.content)}`).join(" ");
      if (n.type === "table") return n.rows.map((r) => r.join(" ")).join(" ");
      return n.text;
    })
    .join(" ")
    .trim();
}

/**
 * flattenNodes plus the flat-text offsets where a new block starts (each
 * content node, each list item at any depth). Must project byte-identically
 * to flattenNodes — parse-amendments asserts that — so the amendment diff
 * renderer can re-introduce line breaks into segment text without touching
 * the diff invariant. Offsets 0 and text.length are never emitted.
 */
export function flattenWithBreaks(nodes: ContentNode[]): { text: string; breaks: number[] } {
  let text = "";
  const breaks: number[] = [];
  nodes.forEach((n, idx) => {
    if (idx > 0) text += " ";
    breaks.push(text.length);
    if (n.type === "list") {
      n.items.forEach((item, j) => {
        if (j > 0) text += " ";
        breaks.push(text.length);
        const inner = flattenWithBreaks(item.content);
        const innerStart = text.length + item.marker.length + 1;
        breaks.push(...inner.breaks.map((b) => b + innerStart));
        text += `${item.marker} ${inner.text}`;
      });
    } else if (n.type === "table") {
      text += n.rows.map((r) => r.join(" ")).join(" ");
    } else {
      text += n.text;
    }
  });
  const shift = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return {
    text: trimmed,
    breaks: [...new Set(breaks.map((b) => b - shift))]
      .filter((b) => b > 0 && b < trimmed.length)
      .sort((x, y) => x - y),
  };
}

/** "a)" → "a", "(14)" → "14"; empty for markers like "—". */
export function markerToSlug(marker: string): string {
  return marker
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Anchor slugs for the top-level list items of a paragraph (lid-1-a, punt-12). */
export function assignItemAnchors(content: ContentNode[], prefix: string): void {
  for (const node of content) {
    if (node.type !== "list") continue;
    for (const item of node.items) {
      const slug = markerToSlug(item.marker);
      if (slug) item.anchor = prefix ? `${prefix}-${slug}` : `punt-${slug}`;
    }
  }
}
