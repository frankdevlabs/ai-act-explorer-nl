import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AmendedArticleView } from "@/components/content/AmendedArticleView";
import { ArticleBody } from "@/components/content/ArticleBody";
import { DiffArticleBody } from "@/components/content/DiffArticleBody";
import { RelatedRecitals } from "@/components/content/RelatedRecitals";
import { Breadcrumbs, type Crumb } from "@/components/layout/Breadcrumbs";
import { PrevNextNav } from "@/components/layout/PrevNextNav";
import { RegisterTab } from "@/components/layout/RegisterTab";
import {
  articlePrevNext,
  changedTargetPrevNext,
  getArticleDiff,
  getArticleOrder,
  getRecitalsForArticle,
  resolveArticle,
} from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return getArticleOrder().map((e) => ({ nummer: e.slug }));
}

type Props = { params: Promise<{ nummer: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { nummer } = await params;
  const resolved = resolveArticle(nummer);
  if (!resolved) return {};
  if (resolved.kind === "new") {
    return {
      title: `Artikel ${resolved.spec.displayNumber} — ${resolved.spec.title}`,
      description: `Artikel ${resolved.spec.displayNumber} van de AI-verordening (EU) 2024/1689, ingevoegd door de digitale omnibus (PE-CONS 30/26): ${resolved.spec.title}`,
    };
  }
  const article = resolved.article;
  return {
    title: `Artikel ${article.number} — ${article.title}`,
    description: `Artikel ${article.number} van de AI-verordening (EU) 2024/1689: ${article.title}`,
  };
}

export default async function ArtikelPage({ params }: Props) {
  const { nummer } = await params;
  const resolved = resolveArticle(nummer);
  if (!resolved) notFound();

  const isNew = resolved.kind === "new";
  const display = isNew ? `Artikel ${resolved.spec.displayNumber}` : `Artikel ${resolved.article.number}`;
  const title = isNew ? resolved.spec.title : resolved.article.title;
  const chapter = isNew ? resolved.chapter : resolved.article.chapter;
  const chapterTitle = isNew ? resolved.chapterTitle : resolved.article.chapterTitle;
  const section = isNew ? resolved.section : resolved.article.section;
  const sectionTitle = isNew ? resolved.sectionTitle : resolved.article.sectionTitle;

  const crumbs: Crumb[] = [
    { label: `Hoofdstuk ${chapter}`, href: `/#hoofdstuk-${chapter.toLowerCase()}` },
  ];
  if (section !== null && sectionTitle) {
    crumbs.push({ label: `Afdeling ${section}` });
  }
  crumbs.push({ label: display });

  const diff = isNew ? undefined : getArticleDiff(nummer);
  const cleanBody = isNew ? (
    <ArticleBody article={{ paragraphs: resolved.spec.paragraphs, footnotes: [] }} />
  ) : (
    <ArticleBody article={resolved.article} />
  );

  return (
    <article>
      <RegisterTab
        href={`/artikel/${nummer}`}
        label={display.replace(/^Artikel/, "Art.")}
        title={title}
      />
      <Breadcrumbs crumbs={crumbs} />
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">{display}</p>
        <h1 className="mt-1 text-2xl font-bold text-balance">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          Hoofdstuk {chapter} — {chapterTitle}
          {sectionTitle ? ` · Afdeling ${section} — ${sectionTitle}` : ""}
        </p>
        {isNew && (
          <p className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
            Ingevoegd door de digitale omnibus inzake AI (PE-CONS 30/26); nog niet bekendgemaakt
            in het Publicatieblad.
          </p>
        )}
      </header>
      {diff && !isNew ? (
        <Suspense fallback={cleanBody}>
          <AmendedArticleView
            clean={cleanBody}
            diff={
              <DiffArticleBody
                paragraphs={resolved.article.paragraphs}
                diffs={diff}
                idPrefix="w-"
              />
            }
            changedAnchors={diff
              .filter((d) => d.status !== "unchanged")
              .map((d) => `w-${d.anchor}`)}
            {...changedTargetPrevNext("article", nummer)}
          />
        </Suspense>
      ) : (
        cleanBody
      )}
      <RelatedRecitals recitals={getRecitalsForArticle(nummer)} />
      <PrevNextNav {...articlePrevNext(nummer)} />
    </article>
  );
}
