import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";

export const metadata: Metadata = {
  title: "Transparantieverplichtingen (art. 50)",
  description:
    "Uitleg van de transparantieverplichtingen van art. 50 AI-verordening: chatbots, synthetische content en markering, emotieherkenning, deepfakes en AI-tekst — met uitzonderingen en data.",
};

/** Editorial explainer for the art. 50 transparency duties; linked from the assessment. */
export default function TransparantieArt50Page() {
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Transparantie (art. 50)" }]} />
      <h1 className="mb-2 text-2xl font-bold">
        Transparantieverplichtingen <span className="text-muted">(art. 50)</span>
      </h1>
      <p className="mb-6 text-sm text-muted">
        <Link href="/artikel/50" className="text-accent hover:underline">
          Artikel 50
        </Link>{" "}
        bevat vier transparantieplichten die gelden ongeacht de risicoklasse — dus ook voor
        systemen met &ldquo;minimaal&rdquo; risico. Twee richten zich tot aanbieders (leden 1 en
        2), twee tot deployers (leden 3 en 4). Redactionele uitleg, geen juridisch advies.
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Lid 1 — Interactie met AI (chatbots, voice-assistenten)
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Systemen die rechtstreeks met mensen interacteren, worden zó ontworpen dat de
            betrokkene weet dat die met AI communiceert — tenzij dat voor een normaal
            geïnformeerde, omzichtige persoon uit de context al duidelijk is. Uitzondering:
            wettelijk toegestane opsporing en rechtshandhaving. De ontwerp-plicht rust op de{" "}
            <em>aanbieder</em>; wie een chatbot inzet, verifieert de inbouw en richt de eigen
            interfaceteksten in (
            <Link href="/artikel/50#lid-1" className="text-accent hover:underline">
              art. 50, lid 1
            </Link>
            ).
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Lid 2 — Synthetische content en markering (genAI)
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Aanbieders van systemen die synthetische audio, beeld, video of tekst genereren,
            zorgen dat de output in <em>machineleesbaar formaat</em> als kunstmatig gegenereerd of
            gemanipuleerd gemarkeerd is — doeltreffend, interoperabel, robuust en betrouwbaar voor
            zover technisch haalbaar (denk aan watermerken of metadata zoals C2PA). Uitzondering:
            AI die slechts een ondersteunende of standaardbewerkingsfunctie vervult en de input
            niet wezenlijk verandert (
            <Link href="/artikel/50#lid-2" className="text-accent hover:underline">
              art. 50, lid 2
            </Link>
            ). Wie via een model-API genereert, is voor de technische markering afhankelijk van de
            leverancier — vraag ernaar en test of de markering bewerkingen overleeft.
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Lid 3 — Emotieherkenning en biometrische categorisering
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Deployers informeren de blootgestelde personen over de werking en verwerken de
            persoonsgegevens conform de AVG (
            <Link href="/artikel/50#lid-3" className="text-accent hover:underline">
              art. 50, lid 3
            </Link>
            ). Let op de samenloop met{" "}
            <Link href="/artikel/5" className="text-accent hover:underline">
              art. 5
            </Link>
            : emotieherkenning op de werkplek en in het onderwijs en biometrische categorisering
            naar gevoelige kenmerken zijn grotendeels verbóden; lid 3 dekt alleen wat daarna
            overblijft. Deze toepassingen zijn bovendien vaak hoog risico (bijlage III, punt 1).
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Lid 4 — Deepfakes en gepubliceerde AI-tekst
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              <span className="font-medium">Deepfakes:</span> deployers maken kenbaar dat beeld-,
              audio- of videocontent kunstmatig is gegenereerd of gemanipuleerd. Bij kennelijk
              artistieke, creatieve of satirische werken volstaat een lichtere, niet-storende
              vermelding.
            </li>
            <li>
              <span className="font-medium">AI-tekst over aangelegenheden van algemeen belang:</span>{" "}
              openbaarmaking is verplicht, tenzij een mens de content heeft gecontroleerd en een
              natuurlijke of rechtspersoon redactionele verantwoordelijkheid draagt (
              <Link href="/artikel/50#lid-4" className="text-accent hover:underline">
                art. 50, lid 4
              </Link>
              ).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Hoe en wanneer informeren (leden 5–7)
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            De informatie wordt duidelijk herkenbaar en uiterlijk bij de eerste interactie of
            blootstelling verstrekt, en voldoet aan de toegankelijkheidseisen (
            <Link href="/artikel/50#lid-5" className="text-accent hover:underline">
              art. 50, lid 5
            </Link>
            ). De plichten komen bóvenop hoofdstuk III (hoog risico) en ander Unierecht (lid 6).
            Het AI-bureau faciliteert praktijkcodes voor de praktische uitvoering van de detectie
            en markering; de omnibus vervangt lid 7 — de Commissie beoordeelt en publiceert
            voortaan of zulke codes toereikend zijn (
            <Link href="/artikel/50?diff=1" className="text-accent hover:underline">
              zie de diff van art. 50
            </Link>
            ).
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Vanaf wanneer?</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              Art. 50 is van toepassing met ingang van{" "}
              <span className="font-medium">2 augustus 2026</span>.
            </li>
            <li>
              Overgang (omnibus,{" "}
              <Link href="/artikel/111" className="text-accent hover:underline">
                art. 111, lid 4
              </Link>
              ): aanbieders van generatieve systemen die vóór 2 augustus 2026 in de handel zijn
              gebracht, krijgen tot <span className="font-medium">2 december 2026</span> om aan de
              markeringsplicht van lid 2 te voldoen.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Verder lezen</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/artikel/50" className="text-accent hover:underline">
                Artikel 50 — Transparantieverplichtingen
              </Link>
            </li>
            <li>
              <Link href="/gpai-praktijkcode" className="text-accent hover:underline">
                GPAI-praktijkcode (uitleg)
              </Link>
            </li>
            <li>
              <Link href="/assessment" className="text-accent hover:underline">
                Zelf toetsen: de assessment
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
