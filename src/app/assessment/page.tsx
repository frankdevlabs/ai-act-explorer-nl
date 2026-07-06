import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { AssessmentHome } from "@/components/assessment/AssessmentHome";
import { getQuestionnaire } from "@/lib/assessment/data";

export const metadata: Metadata = {
  title: "AI Act-assessment",
  description:
    "Beoordeel per AI-toepassing de verplichtingen onder de AI-verordening (EU) 2024/1689: kwalificatie, rol, verboden praktijken, hoogrisicoclassificatie, transparantie en registerinvoer. Alle gegevens blijven lokaal in de browser.",
};

export default function AssessmentPage() {
  const q = getQuestionnaire();
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Assessment" }]} />
      <h1 className="mb-2 text-2xl font-bold">AI Act-assessment</h1>
      <p className="mb-2 text-sm text-muted">
        Doorloop per (voorgenomen) AI-toepassing een intake-vragenlijst van 18 modules:
        kwalificatie (art. 3), rolbepaling, verboden praktijken (art. 5), hoogrisicoclassificatie
        (art. 6, bijlagen I en III), verplichtingen per rol (art. 16/26/27/53), transparantie
        (art. 50), AI-geletterdheid (art. 4) en raakvlakken met AVG en DORA. De uitkomst is een
        risicoklasse, een verplichtingen-checklist met toepasselijke data en een kant-en-klare rij
        voor het <Link href="/register" className="text-accent hover:underline">AI-register</Link>.
      </p>
      <p className="mb-6 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
        {q.meta.disclaimer}
      </p>
      <AssessmentHome />
    </div>
  );
}
