import MiniSearch, { type SearchResult } from "minisearch";
import type { SearchDoc } from "./types.js";

const DUTCH_STOPWORDS = new Set([
  "de", "het", "een", "en", "van", "in", "op", "te", "die", "dat", "voor", "met",
  "zijn", "is", "aan", "als", "of", "door", "worden", "wordt", "bij", "naar", "om",
  "tot", "uit", "over", "ook", "deze", "dit", "der", "niet", "waarin", "onder",
]);

function normalizeTerm(term: string): string | null {
  const t = term
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return DUTCH_STOPWORDS.has(t) || t.length < 2 ? null : t;
}

export type SearchHit = SearchResult & Pick<SearchDoc, "heading" | "url" | "type" | "text" | "ref">;

/** Build the MiniSearch index over a corpus — shared by the site and the MCP server. */
export function createSearchIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const mini = new MiniSearch<SearchDoc>({
    fields: ["heading", "text"],
    storeFields: ["heading", "url", "type", "text", "ref"],
    processTerm: normalizeTerm,
    searchOptions: {
      processTerm: (t) => normalizeTerm(t) ?? t.toLowerCase(),
      prefix: true,
      fuzzy: 0.2,
      boost: { heading: 3 },
    },
  });
  mini.addAll(docs);
  return mini;
}

export function searchDocs(mini: MiniSearch<SearchDoc>, query: string, limit = 30): SearchHit[] {
  if (query.trim().length < 2) return [];
  return (mini.search(query) as SearchHit[]).slice(0, limit);
}

/** ±radius chars of context around the first query-term match. */
export function makeSnippet(text: string, terms: string[], radius = 120): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return text.slice(0, radius * 2) + (text.length > radius * 2 ? "…" : "");
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
