/**
 * Golden-query regression gate over the search pipeline; runs before every
 * build. Asserts that curated queries rank their intended doc first (or
 * within the top N) per surface preset, that the synonym map obeys its
 * invariants, and that ranking is deterministic. When a corpus or ranking
 * change legitimately shifts an expectation, update the entry consciously —
 * never delete it to pass (same protocol as verify-data.ts pins).
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRECISION_SEARCH_OPTIONS,
  TYPEAHEAD_SEARCH_OPTIONS,
  createSearchIndex,
  makeSnippet,
  normalizeTerm,
  searchDocs,
} from "../src/lib/search-core";
import { SYNONYM_GROUPS } from "../src/lib/search-expansion";
import type { SearchDoc } from "../src/lib/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (path: string): SearchDoc[] => JSON.parse(readFileSync(join(root, path), "utf-8"));

// same union as the MCP server and the browser build
const docs = [...load("data/generated/search-docs.json"), ...load("public/amendment-search-docs.json")];
const index = createSearchIndex(docs);

// ------------------------------------------------- synonym-map invariants

const seen = new Map<string, number>();
SYNONYM_GROUPS.forEach((group, gi) => {
  for (const term of group) {
    assert.equal(normalizeTerm(term), term, `synonym "${term}" is not a normalizeTerm fixpoint`);
    assert.ok(!/\s/.test(term), `synonym "${term}" must be a single token`);
    assert.ok(!seen.has(term), `synonym "${term}" appears in groups ${seen.get(term)} and ${gi}`);
    seen.set(term, gi);
    assert.ok(
      searchDocs(index, term, 1, PRECISION_SEARCH_OPTIONS).length > 0,
      `synonym "${term}" matches no corpus doc — typo or dead vocabulary`,
    );
  }
});

// ------------------------------------------------- golden queries

interface Golden {
  q: string;
  /** Which preset to search with; default precision (the MCP surface). */
  surface?: "mcp" | "site";
  /** Doc id (or id prefix ending in "-") expected at rank 1. */
  top1?: string;
  /** Doc id expected within the first n results. */
  topN?: { id: string; n: number };
  note?: string;
}

const GOLDEN: Golden[] = [
  // the failure that motivated the overhaul: rare term + ubiquitous terms
  { q: "kredietwaardigheid natuurlijke personen", top1: "anx-iii-punt-5" },
  // synonym expansion (kredietscore) and compound stem via prefix (krediet)
  { q: "kredietscore", top1: "anx-iii-punt-5" },
  { q: "krediet", top1: "anx-iii-punt-5" },
  { q: "uitkeringen essentiële diensten", topN: { id: "anx-iii-punt-5", n: 3 } },
  // reference fast-path pins the named doc regardless of BM25
  { q: "artikel 6 lid 2", top1: "art-6-lid-2" },
  { q: "artikel 6, lid 2", top1: "art-6-lid-2" },
  { q: "overweging 58", top1: "rct-58" },
  { q: "bijlage iii punt 5", top1: "anx-iii-punt-5" },
  { q: "artikel 5", top1: "art-5-", note: "all leden of art 5 float up; any lid first" },
  // domain queries: statutory provision within the top ranks
  { q: "biometrische identificatie op afstand", top1: "anx-iii-punt-1" },
  { q: "subliminale technieken", topN: { id: "art-5-lid-1", n: 3 } },
  { q: "gezichtsherkenning databank", topN: { id: "art-5-lid-1", n: 3 } },
  { q: "deepfake transparantie", topN: { id: "art-50-lid-4", n: 3 } },
  { q: "emotieherkenning werkplek", topN: { id: "art-5-lid-1", n: 3 } },
  { q: "algemene doeleinden systeemrisico", top1: "art-51-lid-1" },
  // typeahead surface: typo tolerance (fuzzy) and mid-word prefix
  { q: "sublimnale technieken", surface: "site", topN: { id: "art-5-lid-1", n: 3 } },
  { q: "transparantiever", surface: "site", top1: "art-13-lid-1" },
  // amendment corpus stays reachable through the shared index
  { q: "digitale omnibus", top1: "omnibus-" },
];

for (const g of GOLDEN) {
  const opts = g.surface === "site" ? TYPEAHEAD_SEARCH_OPTIONS : PRECISION_SEARCH_OPTIONS;
  const n = Math.max(10, g.topN?.n ?? 0);
  const ids = searchDocs(index, g.q, n, opts).map((h) => String(h.id));
  const label = `"${g.q}" [${g.surface ?? "mcp"}] → ${ids.slice(0, 5).join(", ")}`;
  if (g.top1) {
    const ok = g.top1.endsWith("-") ? ids[0]?.startsWith(g.top1) : ids[0] === g.top1;
    assert.ok(ok, `${label} — expected ${g.top1} first`);
  }
  if (g.topN) {
    assert.ok(
      ids.slice(0, g.topN.n).includes(g.topN.id),
      `${label} — expected ${g.topN.id} in top ${g.topN.n}`,
    );
  }
  // determinism: identical id sequence on a second run
  const again = searchDocs(index, g.q, n, opts).map((h) => String(h.id));
  assert.deepEqual(again, ids, `"${g.q}" not deterministic`);
}

// ------------------------------------------------- snippet regression

const p5 = searchDocs(index, "kredietwaardigheid natuurlijke personen", 1, PRECISION_SEARCH_OPTIONS)[0];
assert.ok(
  makeSnippet(p5.text, p5.terms, 200).includes("kredietwaardigheid"),
  "snippet for the motivating query must show the credit-scoring region",
);

console.log(`verify-search: ${GOLDEN.length} golden queries + synonym invariants passed`);
