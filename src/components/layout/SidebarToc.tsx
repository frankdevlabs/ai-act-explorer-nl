"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import type { Toc, TocEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

function ArticleLink({ entry, active, onNavigate }: { entry: TocEntry; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={`/artikel/${entry.number}`}
      onClick={onNavigate}
      className={cn(
        "block rounded px-2 py-1 text-sm hover:bg-surface hover:text-foreground",
        active ? "bg-surface font-medium text-accent" : "text-muted",
      )}
    >
      <span className="text-muted">Art. {entry.number}</span> {entry.title}
    </Link>
  );
}

/** Collapsible chapter/section tree; current article's chapter auto-expands. */
export function SidebarToc({ toc, onNavigate }: { toc: Toc; onNavigate?: () => void }) {
  const pathname = usePathname();
  const currentArticle = useMemo(() => {
    const m = pathname.match(/^\/artikel\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [pathname]);

  const activeChapter = useMemo(() => {
    if (currentArticle === null) return null;
    return (
      toc.chapters.find((c) =>
        [...c.articles, ...c.sections.flatMap((s) => s.articles)].some(
          (a) => a.number === currentArticle,
        ),
      )?.roman ?? null
    );
  }, [toc, currentArticle]);

  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <nav aria-label="Inhoudsopgave" className="space-y-1 text-sm">
      {toc.chapters.map((c) => {
        const isOpen = open[c.roman] ?? c.roman === activeChapter;
        return (
          <Collapsible.Root
            key={c.roman}
            open={isOpen}
            onOpenChange={(v) => setOpen((o) => ({ ...o, [c.roman]: v }))}
          >
            <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left font-medium hover:bg-surface">
              <span>
                <span className="text-muted">Hoofdstuk {c.roman}</span>
                <span className="block text-xs font-normal text-muted">{c.title}</span>
              </span>
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted transition-transform", isOpen && "rotate-180")}
                aria-hidden
              />
            </Collapsible.Trigger>
            <Collapsible.Content className="ml-2 border-l border-line pl-2">
              {c.articles.map((a) => (
                <ArticleLink key={a.number} entry={a} active={a.number === currentArticle} onNavigate={onNavigate} />
              ))}
              {c.sections.map((s) => (
                <div key={s.number} className="mt-1">
                  <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">
                    Afdeling {s.number} — {s.title}
                  </p>
                  {s.articles.map((a) => (
                    <ArticleLink key={a.number} entry={a} active={a.number === currentArticle} onNavigate={onNavigate} />
                  ))}
                </div>
              ))}
            </Collapsible.Content>
          </Collapsible.Root>
        );
      })}

      <div className="mt-3 border-t border-line pt-3">
        <Link
          href="/overwegingen"
          onClick={onNavigate}
          className={cn(
            "block rounded px-2 py-1.5 font-medium hover:bg-surface",
            pathname.startsWith("/overweging") && "text-accent",
          )}
        >
          Overwegingen <span className="text-xs font-normal text-muted">(1–{toc.recitalCount})</span>
        </Link>
        <Link
          href="/bijlagen"
          onClick={onNavigate}
          className={cn(
            "block rounded px-2 py-1.5 font-medium hover:bg-surface",
            pathname.startsWith("/bijlage") && "text-accent",
          )}
        >
          Bijlagen <span className="text-xs font-normal text-muted">(I–{toc.annexes[toc.annexes.length - 1]?.roman})</span>
        </Link>
      </div>
    </nav>
  );
}
