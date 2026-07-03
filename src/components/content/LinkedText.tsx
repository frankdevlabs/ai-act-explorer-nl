import type { ReactNode } from "react";
import { getPreview } from "@/lib/data";
import type { RefSpan } from "@/lib/types";
import { RefLink } from "./RefLink";

/**
 * Text with its parse-time cross-reference annotations rendered as links.
 * Previews are resolved here (server, build time) and inlined as props.
 */
export function LinkedText({ text, refs }: { text: string; refs?: RefSpan[] }) {
  if (!refs || refs.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const [i, r] of refs.entries()) {
    if (r.start > pos) parts.push(text.slice(pos, r.start));
    const preview = getPreview(r.href);
    parts.push(
      <RefLink key={i} href={r.href} title={preview?.title} snippet={preview?.snippet}>
        {text.slice(r.start, r.end)}
      </RefLink>,
    );
    pos = r.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}
