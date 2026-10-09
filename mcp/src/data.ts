import { join, resolve } from "node:path";
import type {
  AmendmentDiffs,
  AmendmentsGenerated,
  Annex,
  Article,
  Recital,
  RecitalMapGenerated,
  SearchDoc,
  Toc,
} from "../../src/lib/types.js";
import type { Questionnaire } from "../../src/lib/assessment/types.js";
import { createSearchIndex } from "../../src/lib/search-core.js";
import { baseUrlFromEnv, loadJson as load, normalizeArticleInput } from "./core/loader.js";

// Compiled file lives at mcp/dist/mcp/src/data.js → repo root is 4 levels up.
const REPO_ROOT = resolve(__dirname, "../../../..");
const DATA_DIR = process.env.AIACT_DATA_DIR ?? join(REPO_ROOT, "data/generated");

export const BASE_URL = baseUrlFromEnv("https://aia.mrfrank.dev");

export const articles = load<Article[]>(join(DATA_DIR, "articles.json"));
export const recitals = load<Recital[]>(join(DATA_DIR, "recitals.json"));
export const annexes = load<Annex[]>(join(DATA_DIR, "annexes.json"));
export const toc = load<Toc>(join(DATA_DIR, "toc.json"));
export const amendments = load<AmendmentsGenerated>(join(DATA_DIR, "amendments.json"));
export const amendmentDiffs = load<AmendmentDiffs>(join(DATA_DIR, "amendment-diffs.json"));
export const recitalMap = load<RecitalMapGenerated>(join(DATA_DIR, "recital-map.json"));

// The assessment questionnaire is curated source, not parser output, so it
// lives outside DATA_DIR and has no generated derivative. Its own env override
// keeps deployments that repoint AIACT_DATA_DIR workable.
export const questionnaire = load<Questionnaire>(
  process.env.AIACT_QUESTIONNAIRE ?? join(REPO_ROOT, "data/questionnaire/assessment-v1.json"),
);

// Search corpus: base docs live in data/generated; the amendment corpus is
// only emitted to public/ — tolerate its absence like the site does.
const searchDocs = load<SearchDoc[]>(join(DATA_DIR, "search-docs.json"));
let amendmentSearchDocs: SearchDoc[] = [];
try {
  amendmentSearchDocs = load<SearchDoc[]>(join(REPO_ROOT, "public/amendment-search-docs.json"));
} catch {
  // optional second corpus
}
export const index = createSearchIndex([...searchDocs, ...amendmentSearchDocs]);

// --- resolvers (ported from src/lib/data.ts, which uses static JSON imports) ---

/** Article by slug: "6", "75bis". */
export function getArticle(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug);
}

export function getRecital(nummer: number): Recital | undefined {
  return recitals.find((r) => r.number === nummer);
}

export function getAnnex(roman: string): Annex | undefined {
  return annexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
}

/** Inserted by the in-force amending act (Vo 2026/1744): "4bis", "XIV". */
export function isNewArticle(slug: string): boolean {
  return amendments.newArticles.some((a) => a.slug === slug);
}
export function isNewAnnex(roman: string): boolean {
  return amendments.newAnnexes.some((a) => a.roman.toLowerCase() === roman.toLowerCase());
}

export type ResolvedArticle = { kind: "base"; article: Article };

/** Resolve a (normalized) article input to the article in force. */
export function resolveArticle(nummer: string): ResolvedArticle | undefined {
  const article = getArticle(nummer);
  return article && { kind: "base", article };
}

// "Artikel 6" / "75 bis" / "75-BIS" → "6" / "75bis". Re-exported from core so
// server.ts keeps importing its whole data surface from this one module.
export { normalizeArticleInput };
