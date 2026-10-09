"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import type { Toc, TocEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SidebarTocProps {
  toc: Toc;
  /** Article slugs amended by the in-force amending act. */
  amended?: string[];
  /** Article slugs inserted by it. */
  inserted?: string[];
  /** Dot tooltips: "Gewijzigd bij …" / "Ingevoegd bij …". */
  amendedTitle?: string;
  insertedTitle?: string;
  onNavigate?: () => void;
}

function OmnibusDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="ml-1 inline-block size-1.5 shrink-0 rounded-full bg-accent align-middle"
    />
  );
}

function ArticleLink({
  entry,
  active,
  dot,
  onNavigate,
}: {
  entry: TocEntry;
  active: boolean;
  /** Tooltip of the change marker, if the article was amended or inserted. */
  dot?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={`/artikel/${entry.slug}`}
      onClick={onNavigate}
      className={cn(
        "block rounded px-2 py-1 text-sm hover:bg-surface hover:text-foreground",
        active ? "bg-surface font-medium text-accent" : "text-muted",
      )}
    >
      <span className="text-muted">Art. {entry.displayNumber}</span> {entry.title}
      {dot && <OmnibusDot title={dot} />}
    </Link>
  );
}

/** Collapsible chapter/section tree; current article's chapter auto-expands. */
export function SidebarToc({
  toc,
  amended = [],
  inserted = [],
  amendedTitle = "Gewijzigd",
  insertedTitle = "Ingevoegd",
  onNavigate,
}: SidebarTocProps) {
  const pathname = usePathname();
  const currentArticle = useMemo(() => {
    const m = pathname.match(/^\/artikel\/(\d+(?:bis|ter|quater|quinquies)?)/);
    return m ? m[1] : null;
  }, [pathname]);
  const amendedSet = useMemo(() => new Set(amended), [amended]);
  const insertedSet = useMemo(() => new Set(inserted), [inserted]);

  const activeChapter = useMemo(() => {
    if (currentArticle === null) return null;
    return (
      toc.chapters.find((c) =>
        [...c.articles, ...c.sections.flatMap((s) => s.articles)].some((a) => a.slug === currentArticle),
      )?.roman ?? null
    );
  }, [toc, currentArticle]);

  const [open, setOpen] = useState<Record<string, boolean>>({});

  const renderEntry = (a: TocEntry) => (
    <div key={a.slug}>
      <ArticleLink
        entry={a}
        active={a.slug === currentArticle}
        dot={insertedSet.has(a.slug) ? insertedTitle : amendedSet.has(a.slug) ? amendedTitle : undefined}
        onNavigate={onNavigate}
      />
    </div>
  );

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
              {c.articles.map(renderEntry)}
              {c.sections.map((s) => (
                <div key={s.number} className="mt-1">
                  <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">
                    Afdeling {s.number} — {s.title}
                  </p>
                  {s.articles.map(renderEntry)}
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
        <Link
          href="/wijzigingen"
          onClick={onNavigate}
          className={cn(
            "block rounded px-2 py-1.5 font-medium hover:bg-surface",
            pathname.startsWith("/wijzigingen") && "text-accent",
          )}
        >
          Wijzigingen{" "}
          <span className="text-xs font-normal text-muted">(digitale omnibus)</span>
        </Link>
        <Link
          href="/gpai-praktijkcode"
          onClick={onNavigate}
          className={cn(
            "block rounded px-2 py-1.5 font-medium hover:bg-surface",
            pathname.startsWith("/gpai-praktijkcode") && "text-accent",
          )}
        >
          GPAI-praktijkcode{" "}
          <span className="text-xs font-normal text-muted">(uitleg)</span>
        </Link>
        <Link
          href="/assessment"
          onClick={onNavigate}
          className={cn(
            "block rounded px-2 py-1.5 font-medium hover:bg-surface",
            pathname.startsWith("/assessment") && "text-accent",
          )}
        >
          Assessment{" "}
          <span className="text-xs font-normal text-muted">(per AI-toepassing)</span>
        </Link>
        <Link
          href="/register"
          onClick={onNavigate}
          className={cn(
            "block rounded px-2 py-1.5 font-medium hover:bg-surface",
            pathname.startsWith("/register") && "text-accent",
          )}
        >
          AI-register{" "}
          <span className="text-xs font-normal text-muted">(sjabloon)</span>
        </Link>
      </div>
    </nav>
  );
}
