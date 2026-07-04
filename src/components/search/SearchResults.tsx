"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSearchIndex, makeSnippet, searchDocs, type SearchHit } from "@/lib/search";
import { Highlight } from "./Highlight";

const TYPE_LABEL = { artikel: "Artikel", overweging: "Overweging", bijlage: "Bijlage" } as const;

/** Full-page search: reads ?q=, reuses the palette's index singleton. */
export function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSearchIndex().then(() => setReady(true)).catch(() => setReady(false));
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getSearchIndex().then((mini) => {
      if (!cancelled) setHits(searchDocs(mini, query, 100));
    });
    return () => {
      cancelled = true;
    };
  }, [query, ready]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.replace(`/zoeken?q=${encodeURIComponent(query)}`);
        }}
        className="mb-6 flex items-center gap-2 rounded-lg border border-line px-3 focus-within:border-accent"
      >
        <Search className="size-4 shrink-0 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Zoek in artikelen, overwegingen en bijlagen…"
          className="h-11 w-full bg-transparent outline-none placeholder:text-muted"
        />
      </form>

      {!ready && <p className="text-sm text-muted">Zoekindex laden…</p>}
      {ready && query.trim().length >= 2 && (
        <p className="mb-4 text-sm text-muted">
          {hits.length === 100 ? "100+" : hits.length} resultaten voor “{query}”
        </p>
      )}

      <ul className="space-y-4">
        {hits.map((h) => (
          <li key={h.id}>
            <Link href={h.url} className="group block rounded-lg border border-line p-3 hover:border-accent">
              <span className="text-xs font-medium uppercase tracking-wide text-accent">
                {TYPE_LABEL[h.type as keyof typeof TYPE_LABEL]}
              </span>
              <span className="mt-1 block font-medium group-hover:text-accent">
                <Highlight text={h.heading} terms={h.terms} />
              </span>
              <span className="mt-1 block text-sm text-muted">
                <Highlight text={makeSnippet(h.text, h.terms, 160)} terms={h.terms} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
