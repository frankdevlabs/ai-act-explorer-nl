import MiniSearch, { type SearchOptions, type SearchResult } from "minisearch";
import { SYNONYMS } from "./search-expansion";
import type { SearchDoc } from "./types.js";

const DUTCH_STOPWORDS = new Set([
  "de", "het", "een", "en", "van", "in", "op", "te", "die", "dat", "voor", "met",
  "zijn", "is", "aan", "als", "of", "door", "worden", "wordt", "bij", "naar", "om",
  "tot", "uit", "over", "ook", "deze", "dit", "der", "niet", "waarin", "onder",
]);

export function normalizeTerm(term: string): string | null {
  const t = term
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  // single digits stay searchable ("artikel 6"); other 1-char tokens drop
  return DUTCH_STOPWORDS.has(t) || (t.length < 2 && !/^\d$/.test(t)) ? null : t;
}

const BASE_QUERY_OPTIONS = {
  processTerm: (t: string) => normalizeTerm(t) ?? t.toLowerCase(),
};

/** MCP / agent consumers: precision. No typo guessing; prefix only on terms
 *  long enough to be Dutch compound stems (krediet → kredietwaardigheid). */
export const PRECISION_SEARCH_OPTIONS: SearchOptions = {
  ...BASE_QUERY_OPTIONS,
  combineWith: "OR",
  prefix: (t) => t.length >= 5,
  fuzzy: false,
  boost: { heading: 2 },
};

/** Site Ctrl+K palette and /zoeken: typeahead. Fuzzy only on terms long
 *  enough that one edit is plausibly a typo rather than a different word. */
export const TYPEAHEAD_SEARCH_OPTIONS: SearchOptions = {
  ...BASE_QUERY_OPTIONS,
  combineWith: "OR",
  prefix: true,
  fuzzy: (t) => (t.length >= 5 ? 0.2 : false),
  boost: { heading: 3 },
};

export type SearchHit = SearchResult & Pick<SearchDoc, "heading" | "url" | "type" | "text" | "ref">;

/** Build the MiniSearch index over a corpus — shared by the site and the MCP server. */
export function createSearchIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const mini = new MiniSearch<SearchDoc>({
    fields: ["heading", "text"],
    storeFields: ["heading", "url", "type", "text", "ref"],
    processTerm: normalizeTerm,
    searchOptions: TYPEAHEAD_SEARCH_OPTIONS,
  });
  mini.addAll(docs);
  return mini;
}

const tokenize: (text: string) => string[] = MiniSearch.getDefault("tokenize");

/**
 * Direct-reference queries ("artikel 6, lid 2", "overweging 58",
 * "bijlage iii punt 5") resolve to the doc id (or id prefix) they name,
 * so searchDocs can pin the intended doc ahead of BM25's opinion.
 */
export function parseReferenceQuery(query: string): { exact?: string; prefix?: string } | null {
  const q = query.trim().toLowerCase();
  let m = q.match(/^artikel\s+(\d+)(?:\s*,?\s*lid\s+(\d+))?$/);
  if (m) return m[2] ? { exact: `art-${m[1]}-lid-${m[2]}` } : { prefix: `art-${m[1]}-` };
  m = q.match(/^overweging\s+(\d+)$/);
  if (m) return { exact: `rct-${m[1]}` };
  m = q.match(/^bijlage\s+([ivxlc]+)(?:\s*,?\s*punt\s+(\d+|[a-z]))?$/);
  if (m) return m[2] ? { exact: `anx-${m[1]}-punt-${m[2]}` } : { prefix: `anx-${m[1]}-` };
  return null;
}

/**
 * Query pipeline: synonym expansion → one OR search → coverage-tier re-rank
 * (docs matching more distinct query terms first, BM25 within a tier, id as
 * final tiebreak — fully deterministic) → reference fast-path.
 * Expansion terms count as covering the query term they expand, so synonyms
 * add recall without diluting the ranking.
 */
export function searchDocs(
  mini: MiniSearch<SearchDoc>,
  query: string,
  limit = 30,
  options: SearchOptions = TYPEAHEAD_SEARCH_OPTIONS,
): SearchHit[] {
  if (query.trim().length < 2) return [];

  const tokens = tokenize(query).map((t) => normalizeTerm(t) ?? t.toLowerCase());
  const groupOf = new Map<string, number>();
  tokens.forEach((t, i) => {
    if (!groupOf.has(t)) groupOf.set(t, i);
    for (const syn of SYNONYMS.get(t) ?? []) if (!groupOf.has(syn)) groupOf.set(syn, i);
  });
  if (groupOf.size === 0) return [];

  const hits = mini.search({ combineWith: "OR", queries: [...groupOf.keys()] }, options) as SearchHit[];

  const coverage = (h: SearchHit) =>
    new Set(h.queryTerms.map((t) => groupOf.get(t)).filter((g) => g !== undefined)).size;
  hits.sort(
    (a, b) =>
      coverage(b) - coverage(a) ||
      b.score - a.score ||
      String(a.id).localeCompare(String(b.id)),
  );

  const ref = parseReferenceQuery(query);
  if (ref) {
    const matches = (id: string) =>
      ref.exact ? id === ref.exact : id.startsWith(ref.prefix!);
    const pinned = hits.filter((h) => matches(String(h.id)));
    const rest = hits.filter((h) => !matches(String(h.id)));
    return [...pinned, ...rest].slice(0, limit);
  }
  return hits.slice(0, limit);
}

/** Character-level diacritic fold that preserves offsets (1 char in = 1 char out). */
function foldChar(ch: string): string {
  const folded = ch.normalize("NFD").replace(/\p{M}/gu, "");
  const lower = (folded || ch).toLowerCase();
  return lower.length === 1 ? lower : ch.toLowerCase().slice(0, 1) || ch;
}

/**
 * Snippet around the best-matching region: the window containing the most
 * distinct matched terms (ties: most matches, then earliest). Short texts
 * are returned whole.
 */
export function makeSnippet(text: string, terms: string[], radius = 120): string {
  if (text.length <= radius * 2 + 60) return text;
  const folded = Array.from(text, foldChar).join("");
  const matches: { pos: number; term: number }[] = [];
  terms.forEach((t, ti) => {
    const needle = t.toLowerCase();
    if (needle.length < 2) return;
    for (let i = folded.indexOf(needle); i !== -1; i = folded.indexOf(needle, i + 1)) {
      matches.push({ pos: i, term: ti });
    }
  });
  if (matches.length === 0) return text.slice(0, radius * 2) + "…";
  matches.sort((a, b) => a.pos - b.pos);

  let best = { pos: matches[0].pos, distinct: 0, count: 0 };
  for (let lo = 0, hi = 0; lo < matches.length; lo++) {
    while (hi < matches.length && matches[hi].pos - matches[lo].pos <= radius * 2) hi++;
    const window = matches.slice(lo, hi);
    const distinct = new Set(window.map((m) => m.term)).size;
    if (distinct > best.distinct || (distinct === best.distinct && window.length > best.count)) {
      best = { pos: matches[lo].pos, distinct, count: window.length };
    }
  }
  const start = Math.max(0, best.pos - 40);
  const end = Math.min(text.length, start + radius * 2);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}
