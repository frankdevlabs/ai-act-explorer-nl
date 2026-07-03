import type { DiffSegment } from "@/lib/types";
import { LinkedText } from "./LinkedText";

function Segment({ s }: { s: DiffSegment }) {
  if (s.op === "ins")
    return (
      <ins className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline dark:bg-emerald-950 dark:text-emerald-200">
        <LinkedText text={s.text} refs={s.refs} />
      </ins>
    );
  if (s.op === "del")
    return (
      <del className="rounded-sm bg-red-100 px-0.5 text-red-900 line-through dark:bg-red-950 dark:text-red-300">
        {s.text}
      </del>
    );
  return (
    <span>
      <LinkedText text={s.text} refs={s.refs} />
    </span>
  );
}

/** Word-level track changes: <ins>/<del> over the flattened paragraph text.
 *  `br` segments start a new display line, restoring the block structure the
 *  flat projection collapsed (definitions, list items). eq/ins segments carry
 *  segment-local cross-reference spans; del never does. */
export function DiffSegments({ segments }: { segments: DiffSegment[] }) {
  const lines: DiffSegment[][] = [];
  for (const s of segments) {
    if (s.br || lines.length === 0) lines.push([]);
    lines[lines.length - 1].push(s);
  }
  return (
    <div className="my-2 leading-relaxed">
      {lines.map((line, li) => (
        <p key={li} className="my-1 whitespace-pre-wrap">
          {line.map((s, i) => (
            <Segment key={i} s={s} />
          ))}
        </p>
      ))}
    </div>
  );
}
