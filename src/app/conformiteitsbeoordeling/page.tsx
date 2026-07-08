import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";

export const metadata: Metadata = {
  title: "Conformiteitsbeoordeling, CE-markering en registratie",
  description:
    "Uitleg van de conformiteitsroute voor hoogrisico-AI-systemen (art. 40–49 AI-verordening): bijlage VI of VII, EU-conformiteitsverklaring, CE-markering en EU-databankregistratie.",
};

/** Editorial explainer for the high-risk conformity path; linked from the assessment. */
export default function ConformiteitsbeoordelingPage() {
  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Conformiteitsbeoordeling" }]} />
      <h1 className="mb-2 text-2xl font-bold">
        Conformiteitsbeoordeling, CE-markering en registratie
      </h1>
      <p className="mb-6 text-sm text-muted">
        Vóór een AI-systeem met een hoog risico in de handel wordt gebracht of in gebruik wordt
        gesteld, moet de aanbieder aantonen dat het aan de eisen van afdeling 2 (
        <Link href="/artikel/8" className="text-accent hover:underline">
          art. 8–15
        </Link>
        ) voldoet. Deze pagina legt de route daarnaartoe uit:{" "}
        <Link href="/artikel/43" className="text-accent hover:underline">
          conformiteitsbeoordeling (art. 43)
        </Link>
        , EU-verklaring, CE-markering en registratie. Redactionele uitleg, geen juridisch advies.
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Stap 1 — Normen bepalen de route (art. 40–42)
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Wie{" "}
            <Link href="/artikel/40" className="text-accent hover:underline">
              geharmoniseerde normen
            </Link>{" "}
            (of delen daarvan) toepast waarvan de referenties in het Publicatieblad zijn
            bekendgemaakt, geniet een <em>vermoeden van conformiteit</em> voor de gedekte eisen.
            Bestaan er (nog) geen normen, dan kan de Commissie{" "}
            <Link href="/artikel/41" className="text-accent hover:underline">
              gemeenschappelijke specificaties
            </Link>{" "}
            vaststellen met hetzelfde effect. Twee aanvullende vermoedens staan in{" "}
            <Link href="/artikel/42" className="text-accent hover:underline">
              art. 42
            </Link>
            : training en tests op omgevingseigen data (voor art. 10, lid 4) en certificering
            onder een EU-cyberbeveiligingsregeling (voor art. 15, lid 5). De digitale omnibus
            verbreedt de normalisatieopdracht en de vermoedens — zie{" "}
            <Link href="/artikel/40?diff=1" className="text-accent hover:underline">
              art. 40 in de wijzigingenweergave
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Stap 2 — De beslisboom van art. 43
          </h2>
          <ul className="mt-3 space-y-3 text-sm leading-relaxed">
            <li>
              <span className="font-medium">Bijlage III, punten 2–8</span> (o.a. HR-tooling,
              kredietwaardigheid, verzekeringen, onderwijs, essentiële diensten):{" "}
              <Link href="/bijlage/vi" className="text-accent hover:underline">
                interne controle volgens bijlage VI
              </Link>{" "}
              — een zelfbeoordeling door de aanbieder, zónder aangemelde instantie (
              <Link href="/artikel/43#lid-2" className="text-accent hover:underline">
                art. 43, lid 2
              </Link>
              ). Er bestaat dus geen &ldquo;AI Act-certificaat&rdquo; voor deze categorieën:
              de aanbieder draagt zelf de bewijslast via technische documentatie.
            </li>
            <li>
              <span className="font-medium">Bijlage III, punt 1 (biometrie):</span> keuze tussen
              bijlage VI en{" "}
              <Link href="/bijlage/vii" className="text-accent hover:underline">
                bijlage VII
              </Link>{" "}
              (beoordeling van kwaliteitsbeheersysteem en technische documentatie dóór een
              aangemelde instantie) — maar de keuze voor interne controle bestaat alléén als
              geharmoniseerde normen of gemeenschappelijke specificaties volledig zijn toegepast;
              anders is bijlage VII verplicht (
              <Link href="/artikel/43#lid-1" className="text-accent hover:underline">
                art. 43, lid 1
              </Link>
              ).
            </li>
            <li>
              <span className="font-medium">Bijlage I, afdeling A (productwetgeving):</span> de
              sectorale conformiteitsprocedure van het onderliggende productregime (machines,
              medische hulpmiddelen, speelgoed enz.), waarbij de AI-eisen van afdeling 2 in die
              beoordeling worden meegenomen (
              <Link href="/artikel/43#lid-3" className="text-accent hover:underline">
                art. 43, lid 3
              </Link>
              , door de omnibus vervangen — zie{" "}
              <Link href="/artikel/43?diff=1" className="text-accent hover:underline">
                de diff
              </Link>
              ).
            </li>
            <li>
              <span className="font-medium">Substantiële wijziging?</span> Dan een niéuwe
              beoordeling (
              <Link href="/artikel/43#lid-4" className="text-accent hover:underline">
                art. 43, lid 4
              </Link>
              ). Voor doorlerende systemen zijn vooraf bepaalde en gedocumenteerde veranderingen
              géén substantiële wijziging.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Aangemelde instanties en certificaten (art. 28–39, 44)
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Aangemelde instanties zijn door de lidstaten aangewezen en bij de Commissie aangemelde
            keuringsinstanties (afdeling 4,{" "}
            <Link href="/artikel/28" className="text-accent hover:underline">
              art. 28–39
            </Link>
            ). Alleen de bijlage VII-route en sommige sectorale routes vereisen hun betrokkenheid.
            Certificaten zijn maximaal vijf jaar (bijlage I) of vier jaar (bijlage III) geldig en
            kunnen bij non-conformiteit worden geschorst of ingetrokken; er is een
            beroepsprocedure (
            <Link href="/artikel/44" className="text-accent hover:underline">
              art. 44
            </Link>
            ).
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">
            Stap 3 — Verklaring, CE-markering en registratie (art. 47–49)
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              <span className="font-medium">EU-conformiteitsverklaring (art. 47):</span> één
              verklaring per systeem, met de elementen van{" "}
              <Link href="/bijlage/v" className="text-accent hover:underline">
                bijlage V
              </Link>
              ; tien jaar bewaren en op verzoek verstrekken.
            </li>
            <li>
              <span className="font-medium">
                CE-markering (
                <Link href="/artikel/48" className="text-accent hover:underline">
                  art. 48
                </Link>
                ):
              </span>{" "}
              zichtbaar, leesbaar en onuitwisbaar op het systeem — of digitaal voor
              digitale systemen; met het identificatienummer van de aangemelde instantie waar die
              betrokken was.
            </li>
            <li>
              <span className="font-medium">
                EU-databankregistratie (
                <Link href="/artikel/49" className="text-accent hover:underline">
                  art. 49
                </Link>
                /
                <Link href="/artikel/71" className="text-accent hover:underline">
                  art. 71
                </Link>
                ):
              </span>{" "}
              vóór het in de handel brengen registreert de aanbieder zichzelf en het systeem
              (bijlage III-systemen, behalve punt 2 — dat wordt nationaal geregistreerd). Ook wie
              zich op de uitzondering van art. 6, lid 3, beroept, registreert (art. 49, lid 2).
              Publieke deployers registreren daarnaast hun gebruik (art. 49, lid 3). Zie{" "}
              <Link href="/bijlage/viii" className="text-accent hover:underline">
                bijlage VIII
              </Link>{" "}
              voor de gegevens.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Vanaf wanneer?</h2>
          <p className="mt-3 text-sm leading-relaxed">
            Volgens de digitale omnibus gelden de hoogrisicoverplichtingen — en dus ook deze
            sluitstukken — vanaf <span className="font-medium">2 december 2027</span> voor
            bijlage III-systemen en <span className="font-medium">2 augustus 2028</span> voor
            bijlage I-systemen. Richt de conformiteitsroute desondanks vóór go-live in: systemen
            die nu live gaan, zijn op die data al in gebruik.
          </p>
        </section>

        <section>
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Verder lezen</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/artikel/43" className="text-accent hover:underline">
                Artikel 43 — Conformiteitsbeoordeling
              </Link>
            </li>
            <li>
              <Link href="/bijlage/vi" className="text-accent hover:underline">
                Bijlage VI — Interne controle
              </Link>{" "}
              en{" "}
              <Link href="/bijlage/vii" className="text-accent hover:underline">
                bijlage VII — Beoordeling met aangemelde instantie
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
