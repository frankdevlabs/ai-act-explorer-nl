"use client";

import { Command } from "cmdk";
import { FileText, Landmark, ScrollText, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OPEN_SEARCH_EVENT } from "@/components/layout/Header";
import { getSearchIndex, makeSnippet, searchDocs, type SearchHit } from "@/lib/search";
import { Highlight } from "./Highlight";

const TYPE_META = {
  artikel: { label: "Artikelen", icon: FileText },
  overweging: { label: "Overwegingen", icon: ScrollText },
  bijlage: { label: "Bijlagen", icon: Landmark },
} as const;

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  // build the index the moment the palette first opens
  useEffect(() => {
    if (!open) return;
    getSearchIndex().then(() => setReady(true)).catch(() => setReady(false));
  }, [open]);

  useEffect(() => {
    if (!open || !ready) return;
    let cancelled = false;
    getSearchIndex().then((mini) => {
      if (!cancelled) setHits(searchDocs(mini, query, 24));
    });
    return () => {
      cancelled = true;
    };
  }, [query, open, ready]);

  const grouped = useMemo(() => {
    const groups: Record<string, SearchHit[]> = {};
    for (const h of hits) (groups[h.type] ??= []).push(h);
    return groups;
  }, [hits]);

  function go(url: string) {
    setOpen(false);
    setQuery("");
    router.push(url);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      shouldFilter={false}
      label="Zoeken in de AI-verordening"
      className="fixed left-1/2 top-24 z-50 w-[min(40rem,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-background shadow-2xl"
      overlayClassName="fixed inset-0 z-50 bg-black/40"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="size-4 shrink-0 text-muted" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Zoek in artikelen, overwegingen en bijlagen…"
          className="h-12 w-full bg-transparent outline-none placeholder:text-muted"
        />
        <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-muted">
          Esc
        </kbd>
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        {query.trim().length >= 2 && hits.length === 0 && (
          <Command.Empty className="p-4 text-sm text-muted">
            {ready ? "Geen resultaten." : "Zoekindex laden…"}
          </Command.Empty>
        )}
        {query.trim().length < 2 && (
          <p className="p-4 text-sm text-muted">
            Typ minimaal twee tekens. Voorbeeld: <em>verboden praktijken</em>,{" "}
            <em>hoog risico</em>, <em>transparantie</em>.
          </p>
        )}
        {(Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).map((type) => {
          const items = grouped[type];
          if (!items?.length) return null;
          const { label, icon: Icon } = TYPE_META[type];
          return (
            <Command.Group
              key={type}
              heading={label}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted"
            >
              {items.map((h) => (
                <Command.Item
                  key={h.id}
                  value={String(h.id)}
                  onSelect={() => go(h.url)}
                  className="flex cursor-pointer gap-3 rounded-lg px-2 py-2 data-[selected=true]:bg-surface"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      <Highlight text={h.heading} terms={h.queryTerms} />
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs text-muted">
                      <Highlight text={makeSnippet(h.text, h.queryTerms)} terms={h.queryTerms} />
                    </span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          );
        })}
      </Command.List>
    </Command.Dialog>
  );
}
