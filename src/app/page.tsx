import Link from "next/link";
import { getNewArticleTocEntries, getToc } from "@/lib/data";

/** Accent marker for articles inserted by the digitale omnibus. */
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
  const newEntries = getNewArticleTocEntries();

  // A base article followed by any omnibus-inserted articles, as sibling <li>s
  // (flatMap keeps them direct children of <ul> so space-y-1 spacing holds).
  const articleItems = (a: { number: number; title: string }) => [
    <li key={a.number}>
      <Link
        href={`/artikel/${a.number}`}
        className="group flex gap-3 rounded px-2 py-1 hover:bg-surface"
      >
        <span className="w-16 shrink-0 text-sm text-muted">Art. {a.number}</span>
        <span className="group-hover:text-accent">{a.title}</span>
      </Link>
    </li>,
    ...(newEntries[String(a.number)] ?? []).map((n) => (
      <li key={n.slug}>
        <Link
          href={`/artikel/${n.slug}`}
          className="group flex gap-3 rounded px-2 py-1 hover:bg-surface"
        >
          <span className="w-16 shrink-0 text-sm text-muted">
            Art. {n.slug.replace(/^(\d+)(.+)$/, "$1 $2")}
          </span>
          <span className="group-hover:text-accent">
            {n.title}
            <OmnibusDot title="Ingevoegd door de digitale omnibus" />
          </span>
        </Link>
      </li>
    )),
  ];

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-balance">
          AI-verordening <span className="text-accent">(EU) 2024/1689</span>
        </h1>
        <p className="mt-3 text-muted">
          De volledige Nederlandse tekst van de Europese AI-verordening: 113 artikelen,{" "}
          {toc.recitalCount} overwegingen en {toc.annexes.length} bijlagen. Gebruik de
          inhoudsopgave of zoek met{" "}
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-xs">Ctrl K</kbd>.
        </p>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <OmnibusDot title="Ingevoegd door de digitale omnibus" />
          Ingevoegd door de digitale omnibus (PE-CONS 30/26, nog niet bekendgemaakt in het
          Publicatieblad)
        </p>
      </header>

      <nav aria-label="Volledige inhoudsopgave" className="space-y-8">
        {toc.chapters.map((c) => (
          <section key={c.roman} id={`hoofdstuk-${c.roman.toLowerCase()}`} className="scroll-mt-20">
            <h2 className="border-b border-line pb-2 text-lg font-semibold">
              Hoofdstuk {c.roman} — {c.title}
            </h2>
            <ul className="mt-3 space-y-1">{c.articles.flatMap(articleItems)}</ul>
            {c.sections.map((s) => (
              <div key={s.number} className="mt-4">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Afdeling {s.number} — {s.title}
                </h3>
                <ul className="mt-2 space-y-1">{s.articles.flatMap(articleItems)}</ul>
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
                  <span className="group-hover:text-accent">{a.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </nav>

      <footer className="mt-12 border-t border-line pt-4 text-xs text-muted">
        Bron: geconsolideerde Nederlandse tekst per 12.7.2024 (CELEX 02024R1689-20240712,
        rectificaties verwerkt); overwegingen uit het Publicatieblad L-serie 2024/1689. Geen
        officiële weergave; raadpleeg EUR-Lex voor de authentieke tekst.
      </footer>
    </div>
  );
}
