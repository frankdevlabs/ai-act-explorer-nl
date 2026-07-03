import type { ContentNode } from "@/lib/types";
import { LinkedText } from "./LinkedText";

/** Recursive renderer for parsed OJ content: paragraphs, headings and marker lists. */
export function ContentNodes({ nodes }: { nodes: ContentNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === "heading") {
          return (
            <h3 key={i} className="mt-6 mb-2 font-semibold text-foreground">
              {node.text}
            </h3>
          );
        }
        if (node.type === "text") {
          return (
            <p key={i} className="my-2 leading-relaxed">
              <LinkedText text={node.text} refs={node.refs} />
            </p>
          );
        }
        return (
          <ul key={i} className="my-2 space-y-2">
            {node.items.map((item, j) => (
              <li
                key={j}
                id={item.anchor}
                className="grid grid-cols-[minmax(2.25rem,auto)_1fr] gap-x-2 scroll-mt-24 target-highlight"
              >
                <span className="text-muted select-none">{item.marker}</span>
                <div>
                  <ContentNodes nodes={item.content} />
                </div>
              </li>
            ))}
          </ul>
        );
      })}
    </>
  );
}
