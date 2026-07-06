import type { Metadata } from "next";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { Wizard } from "@/components/assessment/Wizard";
import { buildRefPreviews } from "@/components/assessment/ref-previews";
import { getQuestionnaire } from "@/lib/assessment/data";

export const metadata: Metadata = {
  title: "Intake-vragenlijst",
  description:
    "Intake-vragenlijst per AI-toepassing onder de AI-verordening: modules met automatische routing op basis van de antwoorden.",
};

export default function VragenlijstPage() {
  const previews = buildRefPreviews(getQuestionnaire());
  return (
    <div>
      <Breadcrumbs
        crumbs={[{ label: "Assessment", href: "/assessment" }, { label: "Vragenlijst" }]}
      />
      <Suspense fallback={<div className="py-12 text-center text-sm text-muted">Laden…</div>}>
        <Wizard previews={previews} />
      </Suspense>
    </div>
  );
}
