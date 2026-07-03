import type { DiffSegment } from "@/lib/types";

/** Word-level track changes: <ins>/<del> over the flattened paragraph text. */
export function DiffSegments({ segments }: { segments: DiffSegment[] }) {
  return (
    <p className="my-2 leading-relaxed whitespace-pre-wrap">
      {segments.map((s, i) => {
        if (s.op === "ins")
          return (
            <ins key={i} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline dark:bg-emerald-950 dark:text-emerald-200">
              {s.text}
            </ins>
          );
        if (s.op === "del")
          return (
            <del key={i} className="rounded-sm bg-red-100 px-0.5 text-red-900 line-through dark:bg-red-950 dark:text-red-300">
              {s.text}
            </del>
          );
        return <span key={i}>{s.text}</span>;
      })}
    </p>
  );
}
