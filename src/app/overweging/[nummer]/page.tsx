import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkedText } from "@/components/content/LinkedText";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PrevNextNav } from "@/components/layout/PrevNextNav";
import { getRecital, getRecitals, recitalPrevNext } from "@/lib/data";

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

  return (
    <article>
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
      <PrevNextNav {...recitalPrevNext(recital.number)} />
    </article>
  );
}
