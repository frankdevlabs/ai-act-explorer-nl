"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FileDiff } from "lucide-react";

const STORAGE_KEY = "omnibus-diff";

/**
 * Toggle between the current text and the track-changes view of an article
 * amended by the digitale omnibus. Both views are server-rendered siblings;
 * this component only switches visibility. ?diff=1 wins over the persisted
 * preference so deep links are stable.
 */
export function AmendedArticleView({ clean, diff }: { clean: ReactNode; diff: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlDiff = params.get("diff");
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    if (urlDiff !== null) setShowDiff(urlDiff === "1");
    else setShowDiff(localStorage.getItem(STORAGE_KEY) === "1");
  }, [urlDiff]);

  // the deep-link target is hidden until the effect above runs, so the
  // browser's own anchor scroll misses — redo it once the view is visible
  useEffect(() => {
    if (showDiff && window.location.hash.startsWith("#w-")) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
  }, [showDiff]);

  const toggle = () => {
    const next = !showDiff;
    setShowDiff(next);
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    router.replace(next ? `${pathname}?diff=1` : pathname, { scroll: false });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-pressed={showDiff}
          className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-accent aria-pressed:border-accent aria-pressed:text-accent"
        >
          <FileDiff className="size-4" />
          Toon wijzigingen (digitale omnibus)
        </button>
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
      <div hidden={!showDiff}>{diff}</div>
    </div>
  );
}
