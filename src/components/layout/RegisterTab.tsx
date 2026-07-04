"use client";

import { useEffect } from "react";
import { visitTab } from "@/lib/tabs";

interface RegisterTabProps {
  href: string;
  label: string;
  title?: string;
}

/**
 * Registers the current document in the tab strip on mount. Renders nothing.
 * Placed only in document pages (article/recital/annex), which compute labels
 * at build time — no client-side title lookup needed.
 */
export function RegisterTab({ href, label, title }: RegisterTabProps) {
  useEffect(() => {
    visitTab({ href, label, title });
  }, [href, label, title]);
  return null;
}
