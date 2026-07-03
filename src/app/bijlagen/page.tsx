import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { getAmendedAnnexRomans, getAnnex, getAnnexOrder, isNewAnnex } from "@/lib/data";

export const metadata: Metadata = {
  title: "Bijlagen",
  description: "Alle bijlagen van de AI-verordening (EU) 2024/1689",
};

export default function BijlagenPage() {
  const amended = getAmendedAnnexRomans();
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Bijlagen" }]} />
      <h1 className="mb-6 text-2xl font-bold">Bijlagen</h1>
      <ul className="space-y-2">
        {getAnnexOrder().map((roman) => {
          const a = getAnnex(roman);
          if (!a) return null;
          const badge = isNewAnnex(roman)
            ? "Toegevoegd door de digitale omnibus"
            : amended.has(roman)
              ? "Gewijzigd door de digitale omnibus"
              : null;
          return (
            <li key={a.roman}>
              <Link
                href={`/bijlage/${a.roman.toLowerCase()}`}
                className="group flex gap-3 rounded px-2 py-1.5 hover:bg-surface"
              >
                <span className="w-24 shrink-0 text-sm text-muted">Bijlage {a.roman}</span>
                <span className="text-sm group-hover:text-accent">
                  {a.title}
                  {badge && (
                    <span
                      title={badge}
                      className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle"
                    />
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
