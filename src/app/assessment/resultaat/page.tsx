import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Outcome } from "@/components/assessment/Outcome";
import { buildRefPreviews } from "@/components/assessment/ref-previews";
import { getQuestionnaire } from "@/lib/assessment/data";

export const metadata: Metadata = {
  title: "Assessmentresultaat",
  description:
    "Uitkomst van de AI Act-assessment: risicoklasse, verplichtingen-checklist, toepasselijke data en registerrij.",
};

export default function ResultaatPage() {
  const previews = buildRefPreviews(getQuestionnaire());
  return (
    <div>
      <Breadcrumbs
        crumbs={[{ label: "Assessment", href: "/assessment" }, { label: "Resultaat" }]}
      />
      <Suspense fallback={<div className="py-12 text-center text-sm text-muted">Laden…</div>}>
        <Outcome previews={previews} />
      </Suspense>
    </div>
  );
}
