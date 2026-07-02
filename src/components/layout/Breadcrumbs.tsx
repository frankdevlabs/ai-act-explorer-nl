import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Kruimelpad" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted">
      <Link href="/" className="hover:text-foreground">
        Home
      </Link>
      {crumbs.map((c, i) => (
        <Fragment key={i}>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          {c.href ? (
            <Link href={c.href} className="hover:text-foreground">
              {c.label}
            </Link>
          ) : (
            <span className="text-foreground">{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
