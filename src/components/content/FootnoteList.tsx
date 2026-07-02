import type { Footnote } from "@/lib/types";

export function FootnoteList({ footnotes }: { footnotes: Footnote[] }) {
  if (footnotes.length === 0) return null;
  return (
    <aside className="mt-10 border-t border-line pt-4 text-sm text-muted">
      <h2 className="mb-2 font-medium text-foreground">Voetnoten</h2>
      <ol className="space-y-2">
        {footnotes.map((f) => (
          <li key={f.id} className="grid grid-cols-[minmax(2rem,auto)_1fr] gap-x-2">
            <span>{f.label}</span>
            <span>{f.text}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
