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
 * leaves before hydration; the effect covers client-side Link navigations.
 * Both paths are idempotent upserts. The script is embedded via innerHTML on
 * a wrapper div (not a React <script> element) so client renders neither
 * execute it nor trigger React's script-tag console error.
 */
export function RegisterTab({ href, label, title }: RegisterTabProps) {
  useEffect(() => {
    visitTab({ href, label, title });
  }, [href, label, title]);
  return (
    <div
      hidden
      dangerouslySetInnerHTML={{
        __html: `<script>${visitTabScript({ href, label, title })}</script>`,
      }}
    />
  );
}
