import type MiniSearch from "minisearch";
import type { SearchDoc } from "./types";
import { createSearchIndex } from "./search-core";

export type { SearchDoc };
export type { SearchHit } from "./search-core";
export { searchDocs, makeSnippet } from "./search-core";

let indexPromise: Promise<MiniSearch<SearchDoc>> | null = null;

async function buildIndex(): Promise<MiniSearch<SearchDoc>> {
  const [res, amendmentRes] = await Promise.all([
    fetch("/search-docs.json"),
    fetch("/amendment-search-docs.json"),
  ]);
  if (!res.ok) throw new Error(`search-docs.json: HTTP ${res.status}`);
  const docs: SearchDoc[] = await res.json();
  // amendment layer (digitale omnibus) — optional second corpus
  if (amendmentRes.ok) docs.push(...((await amendmentRes.json()) as SearchDoc[]));
  return createSearchIndex(docs);
}

/** Lazily built singleton; first call fetches the corpus and indexes it. */
export function getSearchIndex(): Promise<MiniSearch<SearchDoc>> {
  indexPromise ??= buildIndex().catch((e) => {
    indexPromise = null;
    throw e;
  });
  return indexPromise;
}
