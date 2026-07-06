import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { RegisterClient, TemplateDownload } from "@/components/assessment/RegisterClient";
import { getQuestionnaire } from "@/lib/assessment/data";

export const metadata: Metadata = {
  title: "AI-register (sjabloon)",
  description:
    "Sjabloon voor een intern AI-register onder de AI-verordening: één rij per AI-toepassing, gevuld vanuit de AI Act-assessment. Inclusief kolomdocumentatie en CSV-download.",
};

/** Human explanation per register column, keyed by column id. */
const COLUMN_DOC: Record<string, string> = {
  naam: "Naam en interne referentie; de sleutel van de rij.",
  beschrijving: "Functionaliteit, beoogd doel (art. 3, punt 12) en beoogde gebruikers.",
  leverancier: "Naam, vestigingsland en of er een EU-entiteit is.",
  sourcing: "Inkoop SaaS, on-premise, eigen ontwikkeling, co-development, open source of feature in bestaand pakket.",
  owner: "Businessowner, afdeling en betrokken stakeholders.",
  status: "Verkenning, pilot/POC, productie of uitfasering.",
  datum: "Beoogde of feitelijke datum van ingebruikname.",
  kwalificatie: "AI-systeem, GPAI-systeem, GPAI-model of geen AI-systeem (art. 3, punten 1/63/66).",
  rollen: "Aanbieder, gebruiksverantwoordelijke (deployer), importeur en/of distributeur (art. 3; let op rolverschuiving art. 25).",
  verboden: "Uitkomst van de art. 5-toets; bij een hit: niet inzetten.",
  annex1: "Hoog risico via bijlage I (veiligheidscomponent + derde-partijbeoordeling, art. 6, lid 1).",
  annex3: "Toepasselijke bijlage III-categorieën (art. 6, lid 2).",
  profilering: "Profilering van natuurlijke personen: sluit de uitzondering van art. 6, lid 3, uit.",
  escape: "Status van de uitzondering van art. 6, lid 3 (incl. documentatie- en registratieplicht, art. 6, lid 4 / art. 49, lid 2).",
  risicoklasse: "Afgeleide AI Act-risicoklasse: verboden, hoog risico, transparantierisico of minimaal.",
  fria_status: "Of een grondrechteneffectbeoordeling (art. 27) vereist is en de status ervan.",
  dpia: "Of een DPIA (art. 35 AVG) vereist is en de status ervan.",
  art22: "Of art. 22 AVG (uitsluitend geautomatiseerde besluitvorming) relevant is.",
  transparantie: "Toepasselijke leden van art. 50.",
  databank: "EU-databankregistratie (art. 49/71): geverifieerd of gedaan.",
  ce: "CE-markering en EU-conformiteitsverklaring (art. 47/48) geverifieerd of opgesteld.",
  toezicht: "Menselijk toezicht belegd bij bekwame, getrainde personen (art. 26, lid 2 / art. 14).",
  logbewaring: "Logbewaring van ten minste zes maanden geregeld (art. 26, lid 6 / art. 19).",
  geletterdheid: "AI-geletterdheid van betrokken personeel geborgd (art. 4).",
  dora: "Opname in het DORA-informatieregister (art. 28, lid 3, DORA) — alleen voor financiële entiteiten.",
  contract: "Contract, verwerkersovereenkomst en AI-specifieke bijlagen.",
  besluit: "Go, go met voorwaarden, no-go of escalatie.",
  review: "Laatste en volgende reviewdatum (ten minste jaarlijks).",
  dossier: "Link naar het dossier (FRIA, DPIA, contracten, conformiteitsdocumenten, trainingsbewijs).",
  openacties: "Openstaande acties uit de verplichtingen-checklist.",
};

export default function RegisterPage() {
  const q = getQuestionnaire();
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "AI-register" }]} />
      <h1 className="mb-2 text-2xl font-bold">AI-register</h1>
      <p className="mb-2 text-sm text-muted">
        Een intern AI-register — één rij per AI-toepassing — is als zodanig geen zelfstandige
        verplichting uit de AI-verordening, maar wel praktisch noodzakelijk om naleving van
        art. 4 (AI-geletterdheid), art. 5 (verboden praktijken), art. 26/27 (deployerverplichtingen
        en FRIA) en art. 50 (transparantie) aantoonbaar te maken, en het sluit aan bij het
        accountability-beginsel van de AVG. Let op: registratie in de EU-databank (art. 49/71) is
        in specifieke gevallen wél een wettelijke plicht; dit interne register vervangt die
        EU-registratie niet.
      </p>
      <p className="mb-6 text-sm text-muted">
        Vul het register vanuit de{" "}
        <Link href="/assessment" className="text-accent hover:underline">
          AI Act-assessment
        </Link>
        : elke afgeronde beoordeling levert een rij die u hieronder of op de resultaatpagina
        kopieert (TSV, plakt direct in Google Sheets/Excel).
      </p>

      <h2 className="mb-3 text-lg font-semibold">Uw register (lokaal in deze browser)</h2>
      <RegisterClient />

      <h2 className="mt-10 mb-3 text-lg font-semibold">Sjabloon</h2>
      <p className="mb-3 text-sm text-muted">
        Download het lege sjabloon en beheer het register in uw eigen omgeving (spreadsheet, GRC-
        tool). De kolommen komen exact overeen met de gekopieerde rijen uit de assessment.
      </p>
      <TemplateDownload />

      <h3 className="mt-6 mb-2 text-sm font-semibold">Kolomdocumentatie</h3>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Kolom</th>
              <th className="px-3 py-2 font-medium">Toelichting</th>
            </tr>
          </thead>
          <tbody>
            {q.registerColumns.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-b-0 align-top">
                <th className="w-64 px-3 py-2 text-left font-medium">
                  {c.label}
                  {c.financeOnly && (
                    <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] font-normal text-muted">
                      financiële sector
                    </span>
                  )}
                </th>
                <td className="px-3 py-2 text-muted">{COLUMN_DOC[c.id] ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
        Reviewcyclus: herbeoordeel iedere rij ten minste jaarlijks én tussentijds bij substantiële
        wijziging van systeem of beoogd doel (let op providerverschuiving, art. 25), nieuwe
        modelversies, incidenten of relevante wijzigingen in wet- en regelgeving (zoals de digitale
        omnibus — zie{" "}
        <Link href="/wijzigingen" className="text-accent hover:underline">
          wijzigingen
        </Link>
        ).
      </p>
    </div>
  );
}
