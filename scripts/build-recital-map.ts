/**
 * Curated recital↔article map (data/source/recital-article-map.json, an
 * editorial layer — explicitly NOT legal text) -> data/generated/recital-map.json
 * with both directions of the mapping precomputed.
 *
 * Runs after parse-amendments.ts: article values are validated against the
 * base corpus numbers plus the omnibus new-article slugs ("4bis" is legal).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AmendmentsGenerated,
  Article,
  Recital,
  RecitalMapGenerated,
  RecitalMapSource,
} from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const source = load<RecitalMapSource>("data/source/recital-article-map.json");
const articles = load<Article[]>("data/generated/articles.json");
const recitals = load<Recital[]>("data/generated/recitals.json");
const amendments = load<AmendmentsGenerated>("data/generated/amendments.json");

const fail = (msg: string): never => {
  throw new Error(`build-recital-map: ${msg}`);
};

// Valid targets: base article numbers ∪ omnibus new-article slugs.
const validSlugs = new Set<string>([
  ...articles.map((a) => String(a.number)),
  ...amendments.newArticles.map((n) => n.slug),
]);

// Document order for sorting a recital's articles (base + spliced insertions).
const SUFFIX_RANK: Record<string, number> = { bis: 1, ter: 2, quater: 3, quinquies: 4 };
const slugRank = (slug: string) => SUFFIX_RANK[slug.replace(/^\d+/, "")] ?? 0;
const docOrder = new Map<string, number>();
for (const a of articles) {
  docOrder.set(String(a.number), docOrder.size);
  for (const n of amendments.newArticles
    .filter((x) => x.insertAfter === a.number)
    .sort((x, y) => slugRank(x.slug) - slugRank(y.slug))) {
    docOrder.set(n.slug, docOrder.size);
  }
}

// ------------------------------------------------- structural validation

const expectedKeys = recitals.map((r) => String(r.number));
const sourceKeys = Object.keys(source.recitals);
for (const k of expectedKeys)
  if (!(k in source.recitals)) fail(`missing recital key "${k}"`);
for (const k of sourceKeys)
  if (!expectedKeys.includes(k)) fail(`extra recital key "${k}"`);

let pairCount = 0;
let reviewedCount = 0;
const byRecital: Record<string, string[]> = {};
const byArticle: Record<string, number[]> = {};

for (const k of expectedKeys) {
  const entry = source.recitals[k];
  if (typeof entry.reviewed !== "boolean") fail(`recital ${k}: reviewed must be boolean`);
  if (entry.reviewed) reviewedCount++;
  const seen = new Set<string>();
  for (const slug of entry.articles) {
    if (!validSlugs.has(slug)) fail(`recital ${k}: unknown article slug "${slug}"`);
    if (seen.has(slug)) fail(`recital ${k}: duplicate article "${slug}"`);
    seen.add(slug);
  }
  if (entry.articles.length === 0) continue;
  const sorted = [...entry.articles].sort((a, b) => docOrder.get(a)! - docOrder.get(b)!);
  byRecital[k] = sorted;
  pairCount += sorted.length;
  for (const slug of sorted) (byArticle[slug] ??= []).push(Number(k));
}
for (const list of Object.values(byArticle)) list.sort((a, b) => a - b);

const generated: RecitalMapGenerated = {
  meta: {
    version: source.meta.version,
    complete: source.meta.complete,
    reviewedCount,
    pairCount,
  },
  byRecital,
  byArticle,
};

writeFileSync(
  join(root, "data/generated/recital-map.json"),
  JSON.stringify(generated, null, 2) + "\n",
);

console.log(
  `build-recital-map: ${pairCount} pairs over ${Object.keys(byRecital).length} recitals / ` +
    `${Object.keys(byArticle).length} articles (reviewed ${reviewedCount}/180, complete=${source.meta.complete})`,
);
