"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface RelatedRecital {
  number: number;
  snippet: string;
}

/** Collapsible panel with the recitals mapped to the current article
 *  (curated editorial layer). Default collapsed; renders nothing when empty. */
export function RelatedRecitals({ recitals }: { recitals: RelatedRecital[] }) {
  const [open, setOpen] = useState(false);
  if (recitals.length === 0) return null;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-8 rounded-md border border-line">
      <Collapsible.Trigger className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-surface">
        <span>
          Relevante overwegingen{" "}
          <span className="font-normal text-muted">({recitals.length})</span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-line px-3 py-2">
        <ul className="space-y-2">
          {recitals.map((r) => (
            <li key={r.number} className="text-sm">
              <Link
                href={`/overweging/${r.number}`}
                className="font-medium text-accent hover:underline"
              >
                Overweging {r.number}
              </Link>{" "}
              <span className="text-muted">{r.snippet}</span>
            </li>
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
