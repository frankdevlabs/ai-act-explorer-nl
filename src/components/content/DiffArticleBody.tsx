import type { ArticleParagraph, ParagraphDiff } from "@/lib/types";
import { ContentNodes } from "./ContentNodes";
import { DiffSegments } from "./DiffSegments";

interface DiffArticleBodyProps {
  paragraphs: ArticleParagraph[];
  diffs: ParagraphDiff[];
  /** Prepended to every anchor id — the clean sibling view keeps the
   *  canonical ids, so the diff view must not duplicate them. */
  idPrefix: string;
}

function numberLabel(diff: ParagraphDiff, base?: ArticleParagraph): string | null {
  if (diff.displayNumber) return `${diff.displayNumber}.`;
  if (base?.number != null) return `${base.number}.`;
  const m = diff.anchor.match(/^lid-(\d+)$/);
  return m ? `${m[1]}.` : null;
}

/** Track-changes rendering of an amended article: diffs define the paragraph
 *  order/status; unchanged content is joined back from the base paragraphs. */
export function DiffArticleBody({ paragraphs, diffs, idPrefix }: DiffArticleBodyProps) {
  const byAnchor = new Map(paragraphs.map((p) => [p.anchor, p]));
  return (
    <div>
      {diffs.map((d) => {
        const base = byAnchor.get(d.anchor);
        const label = numberLabel(d, base);
        const body =
          d.status === "unchanged" && base ? (
            <ContentNodes nodes={base.content} />
          ) : (
            <DiffSegments segments={d.segments ?? []} />
          );
        return (
          <div
            key={d.anchor}
            id={`${idPrefix}${d.anchor}`}
            data-diff-status={d.status}
            className="group scroll-mt-24 target-highlight rounded-md -mx-2 px-2 py-1"
          >
            {label ? (
              <div className="grid grid-cols-[minmax(2.25rem,auto)_1fr] gap-x-2">
                <span className="mt-2 font-medium text-muted select-none">{label}</span>
                <div>{body}</div>
              </div>
            ) : (
              body
            )}
          </div>
        );
      })}
    </div>
  );
}
