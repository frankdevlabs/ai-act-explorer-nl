"use client";

import * as HoverCard from "@radix-ui/react-hover-card";
import Link from "next/link";
import type { ReactNode } from "react";

/** Internal cross-reference link with a hover-card preview of the target. */
export function RefLink({
  href,
  title,
  snippet,
  children,
}: {
  href: string;
  title?: string;
  snippet?: string;
  children: ReactNode;
}) {
  const link = (
    <Link
      href={href}
      className="text-accent underline decoration-accent/40 decoration-dotted underline-offset-2 hover:decoration-solid"
    >
      {children}
    </Link>
  );
  if (!title) return link;
  return (
    <HoverCard.Root openDelay={250} closeDelay={100}>
      <HoverCard.Trigger asChild>{link}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-80 max-w-[90vw] rounded-md border border-line bg-background p-3 shadow-lg"
        >
          <p className="mb-1 text-sm font-semibold">{title}</p>
          {snippet && <p className="text-xs leading-relaxed text-muted">{snippet}</p>}
          <HoverCard.Arrow className="fill-line" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
