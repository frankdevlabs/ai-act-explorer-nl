import { getPreview, type RefPreview } from "@/lib/data";
import type { Questionnaire } from "@/lib/assessment/types";

/**
 * Build-time hover previews for every ref in the questionnaire, keyed by the
 * ref's href. Computed in server components only: getPreview pulls the full
 * corpus, which must never be bundled into client code.
 */
export function buildRefPreviews(questionnaire: Questionnaire): Record<string, RefPreview> {
  const out: Record<string, RefPreview> = {};
  const add = (href: string) => {
    if (out[href]) return;
    // getPreview matches clean paths; refs may carry ?diff=1 for the diff view.
    const preview = getPreview(href.replace(/\?[^#]*/, ""));
    if (preview) out[href] = preview;
  };
  for (const m of questionnaire.modules) {
    for (const ref of m.refs ?? []) add(ref.href);
    for (const q of m.questions) for (const ref of q.refs ?? []) add(ref.href);
  }
  return out;
}
