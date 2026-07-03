"use client";

import { FileDiff, Menu, Moon, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { setOmnibusDiff, useOmnibusDiff } from "@/lib/omnibus-pref";

export const OPEN_SEARCH_EVENT = "aiact:open-search";
export const OPEN_MENU_EVENT = "aiact:open-menu";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // theme is unknowable during SSR; render a placeholder until hydrated
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return <div className="size-9" />;
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Licht thema" : "Donker thema"}
      className="flex size-9 items-center justify-center rounded-md border border-line text-muted hover:text-foreground"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function GlobalDiffToggle() {
  const on = useOmnibusDiff();
  const title = "Omnibus-wijzigingen tonen (op gewijzigde artikelen)";
  // no SSR placeholder: the icon never changes, only the pressed styling,
  // and the server snapshot (false) matches the unpressed default
  return (
    <button
      type="button"
      onClick={() => setOmnibusDiff(!on)}
      aria-pressed={on}
      aria-label={title}
      title={title}
      className="flex size-9 items-center justify-center rounded-md border border-line text-muted hover:text-foreground aria-pressed:border-accent aria-pressed:text-accent"
    >
      <FileDiff className="size-4" />
    </button>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <button
          type="button"
          aria-label="Menu openen"
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT))}
          className="flex size-9 items-center justify-center rounded-md border border-line text-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-4" />
        </button>
        <Link href="/" className="font-semibold tracking-tight">
          AI-verordening<span className="text-accent"> Explorer</span>
        </Link>
        <span className="hidden text-xs text-muted sm:block">(EU) 2024/1689 — NL</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT))}
            className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-muted hover:text-foreground"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Zoeken…</span>
            <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] sm:inline">
              Ctrl K
            </kbd>
          </button>
          <GlobalDiffToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
