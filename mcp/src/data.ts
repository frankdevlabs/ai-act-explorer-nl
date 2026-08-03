import { join, resolve } from "node:path";
import type {
  AmendmentDiffs,
  AmendmentsGenerated,
  Annex,
  Article,
  NewArticleSpec,
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

export function getArticle(nummer: number): Article | undefined {
  return articles.find((a) => a.number === nummer);
}

export function getRecital(nummer: number): Recital | undefined {
  return recitals.find((r) => r.number === nummer);
}

export function getAnnex(roman: string): Annex | undefined {
  const base = annexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
  if (base) return base;
  const added = amendments.newAnnexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
  if (!added) return undefined;
  return {
    roman: added.roman,
    ordinal: annexes.length + 1 + amendments.newAnnexes.indexOf(added),
    title: added.title,
    content: added.content,
    footnotes: [],
  };
}

export function getNewArticle(slug: string): NewArticleSpec | undefined {
  return amendments.newArticles.find((a) => a.slug === slug);
}

export type ResolvedArticle =
  | { kind: "base"; article: Article }
  | {
      kind: "new";
      spec: NewArticleSpec;
      chapter: string;
      chapterTitle: string;
      section: number | null;
      sectionTitle: string | null;
    };

/** Numeric input = base article; otherwise an omnibus slug ("75bis"),
 *  chapter/section metadata inherited from its insertAfter neighbor. */
export function resolveArticle(nummer: string): ResolvedArticle | undefined {
  if (/^\d+$/.test(nummer)) {
    const article = getArticle(Number(nummer));
    return article && { kind: "base", article };
  }
  const spec = getNewArticle(nummer);
  if (!spec) return undefined;
  const neighbor = getArticle(spec.insertAfter);
  if (!neighbor) return undefined;
  return {
    kind: "new",
    spec,
    chapter: neighbor.chapter,
    chapterTitle: neighbor.chapterTitle,
    section: neighbor.section,
    sectionTitle: neighbor.sectionTitle,
  };
}

const SUFFIX_RANK: Record<string, number> = { bis: 1, ter: 2, quater: 3, quinquies: 4 };

export function slugRank(slug: string): number {
  return SUFFIX_RANK[slug.replace(/^\d+/, "")] ?? 0;
}

// "Artikel 6" / "75 bis" / "75-BIS" → "6" / "75bis". Re-exported from core so
// server.ts keeps importing its whole data surface from this one module.
export { normalizeArticleInput };
