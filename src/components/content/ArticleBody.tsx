import type { ArticleParagraph, Footnote } from "@/lib/types";
import { ContentNodes } from "./ContentNodes";
import { FootnoteList } from "./FootnoteList";
import { ParagraphAnchor } from "./ParagraphAnchor";

interface ArticleBodyProps {
  article: { paragraphs: ArticleParagraph[]; footnotes: Footnote[] };
}

export function ArticleBody({ article }: ArticleBodyProps) {
  return (
    <div>
      {article.paragraphs.map((p) => (
        <div
          key={p.anchor}
          id={p.anchor}
          className="group scroll-mt-24 target-highlight rounded-md -mx-2 px-2 py-1"
        >
          {p.number !== null ? (
            <div className="grid grid-cols-[minmax(2.25rem,auto)_minmax(0,1fr)] gap-x-2">
              <span className="mt-2 font-medium text-muted select-none flex items-start gap-0.5">
                {p.number}.
                <ParagraphAnchor anchor={p.anchor} label={`lid ${p.number}`} />
              </span>
              <div>
                <ContentNodes nodes={p.content} />
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
      ))}
      <FootnoteList footnotes={article.footnotes} />
    </div>
  );
}
