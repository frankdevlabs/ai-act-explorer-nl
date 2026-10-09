import Link from "next/link";
import { actLabel, dottedDate, inForceSince } from "@/lib/amendment-meta";
import {
  getAmendedAnnexRomans,
  getAmendedArticleNumbers,
  getAmendingAct,
  getArticles,
  getInsertedArticleSlugs,
  getToc,
  isNewAnnex,
} from "@/lib/data";
import type { TocEntry } from "@/lib/types";

/** Accent marker for articles inserted or amended by the digitale omnibus. */
function OmnibusDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="ml-1 inline-block size-1.5 shrink-0 rounded-full bg-accent align-middle"
    />
  );
}

export default function Home() {
  const toc = getToc();
  const act = getAmendingAct();
  const inserted = new Set(getInsertedArticleSlugs());
  const amended = getAmendedArticleNumbers();
  const amendedAnnexes = getAmendedAnnexRomans();
  const insertedTitle = `Ingevoegd bij ${actLabel(act)}`;
  const amendedTitle = `Gewijzigd bij ${actLabel(act)}`;

  const articleItems = (a: TocEntry) => (
    <li key={a.slug}>
      <Link
        href={`/artikel/${a.slug}`}
        className="group flex gap-3 rounded px-2 py-1 hover:bg-surface"
      >
        <span className="w-16 shrink-0 text-sm text-muted">Art. {a.displayNumber}</span>
        <span className="group-hover:text-accent">
          {a.title}
          {inserted.has(a.slug) ? (
            <OmnibusDot title={insertedTitle} />
          ) : (
            amended.has(a.slug) && <OmnibusDot title={amendedTitle} />
          )}
        </span>
      </Link>
    </li>
  );

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          AI-verordening <span className="text-accent">(EU) 2024/1689</span>
        </h1>
        <p className="mt-3 text-muted">
          De volledige Nederlandse tekst van de Europese AI-verordening zoals die geldt sinds{" "}
          {dottedDate(act.inForce)}: {getArticles().length} artikelen, {toc.recitalCount}{" "}
          overwegingen en {toc.annexes.length} bijlagen. Gebruik de inhoudsopgave of zoek met{" "}
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs">Ctrl K</kbd>.
        </p>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <OmnibusDot title={amendedTitle} />
          <span>
            Ingevoegd of gewijzigd bij {actLabel(act)}, {inForceSince(act)} —{" "}
            <Link href="/wijzigingen" className="text-accent hover:underline">
              alle wijzigingen
            </Link>
          </span>
        </p>
      </header>

      <nav aria-label="Volledige inhoudsopgave" className="space-y-8">
        {toc.chapters.map((c) => (
          <section key={c.roman} id={`hoofdstuk-${c.roman.toLowerCase()}`} className="scroll-mt-20">
            <h2 className="border-b border-line pb-2 text-lg font-semibold">
              Hoofdstuk {c.roman} — {c.title}
            </h2>
            <ul className="mt-3 space-y-1">{c.articles.map(articleItems)}</ul>
            {c.sections.map((s) => (
              <div key={s.number} className="mt-4">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Afdeling {s.number} — {s.title}
                </h3>
                <ul className="mt-2 space-y-1">{s.articles.map(articleItems)}</ul>
              </div>
            ))}
          </section>
        ))}

        <section id="overwegingen">
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Overwegingen</h2>
          <p className="mt-3">
            <Link href="/overwegingen" className="text-accent hover:underline">
              Alle {toc.recitalCount} overwegingen bekijken →
            </Link>
          </p>
        </section>

        <section id="bijlagen">
          <h2 className="border-b border-line pb-2 text-lg font-semibold">Bijlagen</h2>
          <ul className="mt-3 space-y-1">
            {toc.annexes.map((a) => (
              <li key={a.roman}>
                <Link
                  href={`/bijlage/${a.roman.toLowerCase()}`}
                  className="group flex gap-3 rounded px-2 py-1 hover:bg-surface"
                >
                  <span className="w-16 shrink-0 text-sm text-muted">Blg. {a.roman}</span>
                  <span className="group-hover:text-accent">
                    {a.title}
                    {isNewAnnex(a.roman) ? (
                      <OmnibusDot title={`Toegevoegd bij ${actLabel(act)}`} />
                    ) : (
                      amendedAnnexes.has(a.roman.toLowerCase()) && <OmnibusDot title={amendedTitle} />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </nav>

      <footer className="mt-12 border-t border-line pt-4 text-xs text-muted">
        Bron: geconsolideerde Nederlandse tekst per {dottedDate(act.inForce)} (CELEX {act.current},
        incl. {act.document} en rectificaties); overwegingen uit het Publicatieblad L-serie
        2024/1689. Wijzigingsweergave t.o.v. CELEX {act.previous}. Geen officiële weergave;
        raadpleeg EUR-Lex voor de authentieke tekst.
      </footer>
    </div>
  );
}
