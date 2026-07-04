import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkedText } from "@/components/content/LinkedText";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PrevNextNav } from "@/components/layout/PrevNextNav";
import { RegisterTab } from "@/components/layout/RegisterTab";
import { getArticlesForRecital, getRecital, getRecitals, recitalPrevNext } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return getRecitals().map((r) => ({ nummer: String(r.number) }));
}

type Props = { params: Promise<{ nummer: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { nummer } = await params;
  return {
    title: `Overweging ${nummer}`,
    description: `Overweging ${nummer} van de AI-verordening (EU) 2024/1689`,
  };
}

export default async function OverwegingPage({ params }: Props) {
  const { nummer } = await params;
  const recital = getRecital(Number(nummer));
  if (!recital) notFound();
  const related = getArticlesForRecital(recital.number);

  return (
    <article>
      <RegisterTab href={`/overweging/${nummer}`} label={`Ov. ${recital.number}`} />
      <Breadcrumbs
        crumbs={[
          { label: "Overwegingen", href: "/overwegingen" },
          { label: `Overweging ${recital.number}` },
        ]}
      />
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Overweging {recital.number}</h1>
      </header>
      {recital.paragraphs.map((p, i) => (
        <p key={i} className="my-3 leading-relaxed">
          <LinkedText text={p.text} refs={p.refs} />
        </p>
      ))}
      {related.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted">Relevante artikelen</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {related.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/artikel/${a.slug}`}
                  title={a.title}
                  className="inline-block rounded-full border border-line px-2.5 py-0.5 text-sm hover:border-accent"
                >
                  {a.label.replace(/^Artikel/, "Art.")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <PrevNextNav {...recitalPrevNext(recital.number)} />
    </article>
  );
}
