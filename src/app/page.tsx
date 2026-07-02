import Link from "next/link";
import { getToc } from "@/lib/data";

export default function Home() {
  const toc = getToc();
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
      </header>

      <nav aria-label="Volledige inhoudsopgave" className="space-y-8">
        {toc.chapters.map((c) => (
          <section key={c.roman} id={`hoofdstuk-${c.roman.toLowerCase()}`} className="scroll-mt-20">
            <h2 className="border-b border-line pb-2 text-lg font-semibold">
              Hoofdstuk {c.roman} — {c.title}
            </h2>
            <ul className="mt-3 space-y-1">
              {c.articles.map((a) => (
                <li key={a.number}>
                  <Link
                    href={`/artikel/${a.number}`}
                    className="group flex gap-3 rounded px-2 py-1 hover:bg-surface"
                  >
                    <span className="w-16 shrink-0 text-sm text-muted">Art. {a.number}</span>
                    <span className="group-hover:text-accent">{a.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {c.sections.map((s) => (
              <div key={s.number} className="mt-4">
                <h3 className="text-sm font-medium uppercase tracking-wide text-muted">
                  Afdeling {s.number} — {s.title}
                </h3>
                <ul className="mt-2 space-y-1">
                  {s.articles.map((a) => (
                    <li key={a.number}>
                      <Link
                        href={`/artikel/${a.number}`}
                        className="group flex gap-3 rounded px-2 py-1 hover:bg-surface"
                      >
                        <span className="w-16 shrink-0 text-sm text-muted">Art. {a.number}</span>
                        <span className="group-hover:text-accent">{a.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
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
