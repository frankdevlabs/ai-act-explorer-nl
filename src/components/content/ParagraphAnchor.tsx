"use client";

import { Check, Link as LinkIcon } from "lucide-react";
import { useState } from "react";

/** Hover copy-link button next to a paragraph number; copies the deep link. */
export function ParagraphAnchor({ anchor, label }: { anchor: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${window.location.pathname}#${anchor}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Kopieer link naar ${label}`}
      title={`Kopieer link naar ${label}`}
      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted hover:text-foreground p-1"
    >
      {copied ? <Check className="size-3.5" /> : <LinkIcon className="size-3.5" />}
    </button>
  );
}
