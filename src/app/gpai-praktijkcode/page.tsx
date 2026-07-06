import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";

export const metadata: Metadata = {
  title: "GPAI-praktijkcode (Code of Practice)",
  description:
    "Uitleg van de praktijkcode voor AI-modellen voor algemene doeleinden (art. 56 AI-verordening): inhoud, doelgroep en gevolgen van wel of niet ondertekenen.",
};

/** Editorial explainer for the GPAI Code of Practice; linked from the assessment. */
export default function GpaiPraktijkcodePage() {
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "GPAI-praktijkcode" }]} />
      <h1 className="mb-2 text-2xl font-bold">
        GPAI-praktijkcode <span className="text-muted">(Code of Practice)</span>
      </h1>
      <p className="mb-6 text-sm text-muted">
        De praktijkcode voor AI-modellen voor algemene doeleinden — in het Engels de{" "}
        <em>General-Purpose AI Code of Practice</em>, informeel ook wel &ldquo;code of
        conduct&rdquo; genoemd — is het vrijwillige nalevingsinstrument van{" "}
        <Link href="/artikel/56" className="text-accent hover:underline">
          artikel 56
        </Link>{" "}
        van de AI-verordening. Deze pagina is redactionele uitleg, geen juridisch advies;
        raadpleeg de <a
          href="https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          officiële tekst bij de Europese Commissie
        </a>.
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Wat is het?</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Een door het AI-bureau gefaciliteerde, door onafhankelijke deskundigen opgestelde
            praktijkcode (gepubliceerd 10 juli 2025) waarmee aanbieders van GPAI-modellen kunnen
            aantonen dat zij voldoen aan de verplichtingen van hoofdstuk V van de AI-verordening
            (
            <Link href="/artikel/53" className="text-accent hover:underline">
              art. 53
            </Link>{" "}
            en, bij systeemrisico,{" "}
            <Link href="/artikel/55" className="text-accent hover:underline">
              art. 55
            </Link>
            ). Ondertekenen is vrijwillig: de code is een middel om naleving aan te tonen, geen
            extra verplichting bovenop de verordening.
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Inhoud: drie hoofdstukken</h2>
          <ul className="mt-3 space-y-3 text-sm leading-relaxed">
            <li>
              <span className="font-medium">1. Transparantie</span> — voor álle
              GPAI-modelaanbieders. Kern: een gestandaardiseerd modeldocumentatieformulier
              (Model Documentation Form) met de informatie die{" "}
              <Link href="/artikel/53#lid-1" className="text-accent hover:underline">
                art. 53, lid 1, punten a) en b)
              </Link>{" "}
              vereist voor het AI-bureau, nationale autoriteiten en downstream-aanbieders die het
              model in hun AI-systeem integreren (zie ook bijlagen{" "}
              <Link href="/bijlage/xi" className="text-accent hover:underline">
                XI
              </Link>{" "}
              en{" "}
              <Link href="/bijlage/xii" className="text-accent hover:underline">
                XII
              </Link>
              ).
            </li>
            <li>
              <span className="font-medium">2. Auteursrecht</span> — voor álle
              GPAI-modelaanbieders. Een auteursrechtbeleid dat o.a. machineleesbare
              opt-outs voor tekst- en datamining respecteert, geen content van evident
              inbreukmakende (piraterij)sites crawlt en maatregelen neemt tegen inbreukmakende
              output — invulling van{" "}
              <Link href="/artikel/53#lid-1" className="text-accent hover:underline">
                art. 53, lid 1, punt c)
              </Link>
              .
            </li>
            <li>
              <span className="font-medium">3. Veiligheid en beveiliging</span> — alleen voor
              aanbieders van modellen met <em>systeemrisico</em> (
              <Link href="/artikel/51#lid-2" className="text-accent hover:underline">
                art. 51, lid 2
              </Link>
              : o.a. &gt; 10²⁵ FLOPs trainingscompute of aanwijzing door de Commissie). Kern: een
              veiligheids- en beveiligingskader met modelevaluaties, adversarial testing,
              beoordeling en beperking van systeemrisico&rsquo;s, rapportage van ernstige
              incidenten en cyberbeveiliging — invulling van{" "}
              <Link href="/artikel/55" className="text-accent hover:underline">
                art. 55
              </Link>
              .
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Voor wie?</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Aanbieders van GPAI-modellen — dus niet de gebruikers of afnemers van zulke modellen.
            Let op: wie een bestaand GPAI-model <em>substantieel</em> finetunet of wijzigt, kan
            volgens de Commissierichtsnoeren (juli 2025) zelf modelaanbieder worden voor die
            wijziging en valt dan ook binnen het bereik van de code. De hoofdstukken
            Transparantie en Auteursrecht gelden voor iedere GPAI-modelaanbieder; het hoofdstuk
            Veiligheid en beveiliging alleen bij systeemrisico. Organisaties die uitsluitend een
            AI-systeem <em>op</em> een GPAI-model bouwen (bijv. een chatbot op een model-API)
            hoeven niet te ondertekenen — voor hen blijven de gewone systeemverplichtingen
            (risicoclassificatie, transparantie) gelden.
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Gevolgen van wel of niet ondertekenen
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              <span className="font-medium">Wel ondertekenen:</span> een eenvoudige, door het
              AI-bureau erkende route om naleving van art. 53 en 55 aan te tonen; minder
              administratieve lasten en meer voorspelbaarheid in het toezicht (de handhaving
              concentreert zich op naleving van de code).
            </li>
            <li>
              <span className="font-medium">Niet ondertekenen:</span>{" "}
              geen sanctie op zichzelf —
              de code is vrijwillig — maar de aanbieder moet dan zelf, met &ldquo;alternatieve
              passende middelen&rdquo;, onderbouwen hoe aan art. 53 en 55 wordt voldaan. Dat
              betekent in de praktijk een zwaardere bewijslast en meer informatieverzoeken en
              toezichtsaandacht van het AI-bureau.
            </li>
            <li>
              Niet-naleving van de <em>onderliggende verplichtingen</em>{" "}
              (hoofdstuk V) kan
              uiteindelijk leiden tot boetes tot 3&nbsp;% van de wereldwijde jaaromzet of
              15&nbsp;miljoen EUR (
              <Link href="/artikel/101" className="text-accent hover:underline">
                art. 101
              </Link>
              ) — ongeacht of de code is ondertekend.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Status en tijdlijn</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              Gepubliceerd op 10 juli 2025; de Commissie en de AI-board hebben de code op
              1 augustus 2025 toereikend beoordeeld.
            </li>
            <li>
              De verplichtingen van hoofdstuk V zijn van toepassing sinds 2 augustus 2025;
              de handhavingsbevoegdheden van de Commissie gelden vanaf 2 augustus 2026. Voor
              modellen die vóór 2 augustus 2025 in de handel waren geldt een overgangstermijn
              tot 2 augustus 2027.
            </li>
            <li>
              Grote modelaanbieders — o.a. OpenAI, Anthropic, Google, Microsoft, Amazon, IBM en
              Mistral AI — hebben ondertekend (stand augustus 2025; Meta ondertekende niet).
              Actuele lijst: zie de Commissiepagina hieronder.
            </li>
            <li>
              Digitale omnibus (PE-CONS 30/26, nog niet bekendgemaakt): art. 56, lid 6 wordt
              vervangen — de Commissie (met advies van de AI-board) beoordeelt voortaan of
              praktijkcodes de verplichtingen dekken en <em>publiceert haar beoordeling</em>.
              Zie{" "}
              <Link href="/artikel/56?diff=1" className="text-accent hover:underline">
                art. 56 in de wijzigingenweergave
              </Link>
              .
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Verder lezen</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <a
                href="https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                De volledige praktijkcode (Europese Commissie, Engels)
              </a>
            </li>
            <li>
              <Link href="/artikel/56" className="text-accent hover:underline">
                Artikel 56 — Praktijkcodes
              </Link>
            </li>
            <li>
              <Link href="/artikel/53" className="text-accent hover:underline">
                Artikel 53 — Verplichtingen voor aanbieders van GPAI-modellen
              </Link>
            </li>
            <li>
              <Link href="/artikel/55" className="text-accent hover:underline">
                Artikel 55 — Verplichtingen bij systeemrisico
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
