"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, FileDiff } from "lucide-react";
import { getSnapshot, setOmnibusDiff, subscribe, useOmnibusDiff } from "@/lib/omnibus-pref";

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
 * this component only switches visibility. Precedence: ?diff=1 wins at load
 * (stable deep links); any preference change after load — this button, the
 * header toggle, another tab — wins over the URL.
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

  const pref = useOmnibusDiff();
  const showDiff = override ?? (urlDiff !== null ? urlDiff === "1" : pref);

  // a preference change from elsewhere (header toggle, other tab) overrides
  // the URL param — without this a ?diff=1 deep link makes the header look dead
  useEffect(() => subscribe(() => setOverride(getSnapshot())), []);

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
    setOmnibusDiff(next);
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
              <a
                href={prevChanged.href}
                className="flex min-w-0 max-w-[50%] items-center gap-1 text-muted hover:text-accent"
              >
                <ArrowLeft className="size-3.5 shrink-0" />{" "}
                <span className="truncate">{prevChanged.label}</span>
              </a>
            )}
            {nextChanged && (
              <a
                href={nextChanged.href}
                className="ml-auto flex min-w-0 max-w-[50%] items-center gap-1 text-muted hover:text-accent"
              >
                <span className="truncate">{nextChanged.label}</span>{" "}
                <ArrowRight className="size-3.5 shrink-0" />
              </a>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
