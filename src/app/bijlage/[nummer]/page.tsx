import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AmendedArticleView } from "@/components/content/AmendedArticleView";
import { ContentNodes } from "@/components/content/ContentNodes";
import { DiffArticleBody } from "@/components/content/DiffArticleBody";
import { FootnoteList } from "@/components/content/FootnoteList";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PrevNextNav } from "@/components/layout/PrevNextNav";
import { annexPrevNext, getAnnex, getAnnexDiff, getAnnexOrder, isNewAnnex } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return getAnnexOrder().map((roman) => ({ nummer: roman }));
}

type Props = { params: Promise<{ nummer: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { nummer } = await params;
  const annex = getAnnex(nummer);
  if (!annex) return {};
  return {
    title: `Bijlage ${annex.roman} — ${annex.title}`,
    description: isNewAnnex(nummer)
      ? `Bijlage ${annex.roman} van de AI-verordening (EU) 2024/1689, toegevoegd door de digitale omnibus (PE-CONS 30/26): ${annex.title}`
      : `Bijlage ${annex.roman} van de AI-verordening (EU) 2024/1689: ${annex.title}`,
  };
}

export default async function BijlagePage({ params }: Props) {
  const { nummer } = await params;
  const annex = getAnnex(nummer);
  if (!annex) notFound();

  const added = isNewAnnex(nummer);
  const diff = added ? undefined : getAnnexDiff(nummer);
  const cleanBody = (
    <>
      <ContentNodes nodes={annex.content} />
      <FootnoteList footnotes={annex.footnotes} />
    </>
  );

  return (
    <article>
      <Breadcrumbs
        crumbs={[{ label: "Bijlagen", href: "/bijlagen" }, { label: `Bijlage ${annex.roman}` }]}
      />
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">
          Bijlage {annex.roman}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-balance">{annex.title}</h1>
        {added && (
          <p className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
            Toegevoegd door de digitale omnibus inzake AI (PE-CONS 30/26); nog niet bekendgemaakt
            in het Publicatieblad.
          </p>
        )}
      </header>
      {diff ? (
        <Suspense fallback={cleanBody}>
          <AmendedArticleView
            clean={cleanBody}
            diff={
              <DiffArticleBody
                paragraphs={[{ number: null, anchor: "inhoud", content: annex.content }]}
                diffs={diff}
                idPrefix="w-"
              />
            }
          />
        </Suspense>
      ) : (
        cleanBody
      )}
      <PrevNextNav {...annexPrevNext(annex.roman)} />
    </article>
  );
}
