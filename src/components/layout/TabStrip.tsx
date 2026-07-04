"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { closeTab, useTabs } from "@/lib/tabs";

/**
 * Strip of recently visited documents, directly under the header. Non-sticky
 * on purpose: the sidebar and all scroll-mt anchor offsets assume the 3.5rem
 * header, and under static export every navigation lands at scroll-top anyway.
 */
export function TabStrip() {
  const tabs = useTabs();
  const pathname = usePathname();
  if (tabs.length === 0) return null;
  return (
    <nav aria-label="Geopende documenten" className="border-b border-line">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-sm ${
              pathname === tab.href
                ? "border-accent bg-surface text-accent"
                : "border-line text-muted hover:text-foreground"
            }`}
          >
            <span>{tab.label}</span>
            {tab.title && (
              <span className="hidden max-w-[9rem] truncate sm:inline">{tab.title}</span>
            )}
            <button
              type="button"
              aria-label={`Sluit ${tab.label}`}
              className="rounded-sm hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Closing the current tab only removes it — no navigation; it
                // re-registers on the next full navigation to this document.
                closeTab(tab.href);
              }}
            >
              <X className="size-3.5" />
            </button>
          </Link>
        ))}
      </div>
    </nav>
  );
}
