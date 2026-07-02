import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { getRecitals } from "@/lib/data";

export const metadata: Metadata = {
  title: "Overwegingen",
  description: "Alle 180 overwegingen van de AI-verordening (EU) 2024/1689",
};

export default function OverwegingenPage() {
  const recitals = getRecitals();
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Overwegingen" }]} />
      <h1 className="mb-6 text-2xl font-bold">Overwegingen</h1>
      <ul className="space-y-2">
        {recitals.map((r) => (
          <li key={r.number}>
            <Link
              href={`/overweging/${r.number}`}
              className="group flex gap-3 rounded px-2 py-1.5 hover:bg-surface"
            >
              <span className="w-10 shrink-0 text-sm text-muted">({r.number})</span>
              <span className="line-clamp-2 text-sm group-hover:text-accent">
                {r.paragraphs[0]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
