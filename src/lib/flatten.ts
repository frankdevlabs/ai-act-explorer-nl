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
