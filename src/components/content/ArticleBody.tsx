import { lidLabel } from "@/lib/flatten";
import type { ArticleParagraph, Footnote } from "@/lib/types";
import { ContentNodes } from "./ContentNodes";
import { FootnoteList } from "./FootnoteList";
import { ParagraphAnchor } from "./ParagraphAnchor";

interface ArticleBodyProps {
  article: { paragraphs: ArticleParagraph[]; footnotes: Footnote[] };
  /** Shown under a struck lid ("Geschrapt bij Vo. (EU) 2026/1744"). */
  repealedNote?: string;
  /** Diff view of the article, where the struck text is shown. */
  repealedHref?: string;
}

export function ArticleBody({ article, repealedNote, repealedHref }: ArticleBodyProps) {
  return (
    <div>
      {article.paragraphs.map((p) => {
        const label = lidLabel(p);
        return (
        <div
          key={p.anchor}
          id={p.anchor}
          className="group scroll-mt-24 target-highlight rounded-md -mx-2 px-2 py-1"
        >
          {label !== null ? (
            <div className="grid grid-cols-[minmax(2.25rem,auto)_minmax(0,1fr)] gap-x-2">
              <span className="mt-2 font-medium text-muted select-none flex items-start gap-0.5">
                {label}.
                <ParagraphAnchor anchor={p.anchor} label={`lid ${label}`} />
              </span>
              <div>
                <ContentNodes nodes={p.content} />
                {p.repealed && repealedNote && (
                  <p className="-mt-1 text-xs text-muted">
                    {repealedNote}
                    {repealedHref && (
                      <>
                        {" · "}
                        <a href={`${repealedHref}#w-${p.anchor}`} className="text-accent hover:underline">
                          toon geschrapte tekst
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              <span className="absolute -left-7 top-2 hidden lg:block">
                <ParagraphAnchor anchor={p.anchor} label="dit artikel" />
              </span>
              <ContentNodes nodes={p.content} />
            </div>
          )}
        </div>
        );
      })}
      <FootnoteList footnotes={article.footnotes} />
    </div>
  );
}
