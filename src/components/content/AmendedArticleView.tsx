"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, FileDiff } from "lucide-react";

const STORAGE_KEY = "omnibus-diff";

interface ChangedLink {
  href: string;
  label: string;
}

interface AmendedArticleViewProps {
  clean: ReactNode;
  diff: ReactNode;
  /** Prefixed element ids of changed paragraphs, in document order ("w-lid-2"). */
  changedAnchors?: string[];
  /** Previous/next amended target in the omnibus, for cross-target stepping. */
  prevChanged?: ChangedLink;
  nextChanged?: ChangedLink;
}

/**
 * Toggle between the current text and the track-changes view of an article
 * amended by the digitale omnibus. Both views are server-rendered siblings;
 * this component only switches visibility. ?diff=1 wins over the persisted
 * preference so deep links are stable.
 */
export function AmendedArticleView({
  clean,
  diff,
  changedAnchors = [],
  prevChanged,
  nextChanged,
}: AmendedArticleViewProps) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlDiff = params.get("diff");
  const [override, setOverride] = useState<boolean | null>(null);
  const [cursor, setCursor] = useState(-1);

  // this component never prerenders (useSearchParams bails the Suspense
  // boundary out to CSR under static export), so window is always available
  const stored = typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
  const showDiff = override ?? (urlDiff !== null ? urlDiff === "1" : stored);

  // the deep-link target is hidden until the state settles, so the browser's
  // own anchor scroll misses — redo it once the view is visible
  useEffect(() => {
    if (showDiff && window.location.hash.startsWith("#w-")) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
  }, [showDiff]);

  const toggle = () => {
    const next = !showDiff;
    setOverride(next);
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    router.replace(next ? `${pathname}?diff=1` : pathname, { scroll: false });
  };

  const jump = (delta: number) => {
    if (!changedAnchors.length) return;
    const next = (cursor + delta + changedAnchors.length) % changedAnchors.length;
    setCursor(next);
    document
      .getElementById(changedAnchors[next])
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={showDiff}
          className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-accent aria-pressed:border-accent aria-pressed:text-accent"
        >
          <FileDiff className="size-4" />
          Toon wijzigingen (digitale omnibus)
        </button>
        {showDiff && changedAnchors.length > 0 && (
          <span className="flex items-center gap-1 text-sm text-muted">
            <button
              type="button"
              onClick={() => jump(-1)}
              aria-label="Vorige wijziging"
              className="rounded border border-line p-1 hover:border-accent hover:text-accent"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => jump(1)}
              aria-label="Volgende wijziging"
              className="rounded border border-line p-1 hover:border-accent hover:text-accent"
            >
              <ChevronDown className="size-3.5" />
            </button>
            wijziging {cursor >= 0 ? cursor + 1 : "–"} van {changedAnchors.length}
          </span>
        )}
        {showDiff && (
          <span className="text-xs text-muted">
            <ins className="rounded-sm bg-emerald-100 px-1 no-underline dark:bg-emerald-950">
              toegevoegd
            </ins>{" "}
            <del className="rounded-sm bg-red-100 px-1 dark:bg-red-950">geschrapt</del> — PE-CONS
            30/26, nog niet bekendgemaakt in het Publicatieblad
          </span>
        )}
      </div>
      <div hidden={showDiff}>{clean}</div>
      <div hidden={!showDiff}>
        {diff}
        {(prevChanged || nextChanged) && (
          <nav
            aria-label="Gewijzigde artikelen"
            className="mt-8 flex gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            {prevChanged && (
              <a href={prevChanged.href} className="flex items-center gap-1 text-muted hover:text-accent">
                <ArrowLeft className="size-3.5" /> {prevChanged.label}
              </a>
            )}
            {nextChanged && (
              <a
                href={nextChanged.href}
                className="ml-auto flex items-center gap-1 text-muted hover:text-accent"
              >
                {nextChanged.label} <ArrowRight className="size-3.5" />
              </a>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
