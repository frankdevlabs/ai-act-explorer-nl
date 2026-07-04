"use client";

import { useEffect } from "react";
import { visitTab, visitTabScript } from "@/lib/tabs";

interface RegisterTabProps {
  href: string;
  label: string;
  title?: string;
}

/**
 * Registers the current document in the tab strip. Placed only in document
 * pages (article/recital/annex), which compute labels at build time — no
 * client-side title lookup needed.
 *
 * Dual registration: the inline script is server-rendered into the static
 * HTML and runs at document parse, so a visit is recorded even if the user
 * leaves before hydration; the effect covers client-side Link navigations,
 * where React diffs the script element without re-executing it. Both paths
 * are idempotent upserts.
 */
export function RegisterTab({ href, label, title }: RegisterTabProps) {
  useEffect(() => {
    visitTab({ href, label, title });
  }, [href, label, title]);
  return <script dangerouslySetInnerHTML={{ __html: visitTabScript({ href, label, title }) }} />;
}
