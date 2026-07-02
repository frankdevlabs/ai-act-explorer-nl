import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PrevNextLink } from "@/lib/data";

export function PrevNextNav({ prev, next }: { prev?: PrevNextLink; next?: PrevNextLink }) {
  return (
    <nav aria-label="Vorige en volgende" className="mt-12 flex gap-3 border-t border-line pt-6">
      {prev && (
        <Link
          href={prev.href}
          className="flex max-w-[50%] flex-col gap-1 rounded-lg border border-line p-3 hover:border-accent hover:bg-surface"
        >
          <span className="flex items-center gap-1 text-sm text-muted">
            <ArrowLeft className="size-3.5" /> {prev.label}
          </span>
          {prev.title && <span className="truncate text-sm">{prev.title}</span>}
        </Link>
      )}
      {next && (
        <Link
          href={next.href}
          className="ml-auto flex max-w-[50%] flex-col items-end gap-1 rounded-lg border border-line p-3 text-right hover:border-accent hover:bg-surface"
        >
          <span className="flex items-center gap-1 text-sm text-muted">
            {next.label} <ArrowRight className="size-3.5" />
          </span>
          {next.title && <span className="truncate text-sm">{next.title}</span>}
        </Link>
      )}
    </nav>
  );
}
