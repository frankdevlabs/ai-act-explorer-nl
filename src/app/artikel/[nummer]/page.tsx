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
import { actLabel, statusText } from "@/lib/amendment-meta";
import {
  articlePrevNext,
  changedTargetPrevNext,
  getAmendingAct,
  getAmendments,
  getArticleDiff,
  getArticleOrder,
  getRecitalsForArticle,
  isNewArticle,
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
  const article = resolved.article;
  const inserted = isNewArticle(nummer) ? `, ingevoegd bij ${actLabel(getAmendingAct())}` : "";
  return {
    title: `Artikel ${article.displayNumber} — ${article.title}`,
    description: `Artikel ${article.displayNumber} van de AI-verordening (EU) 2024/1689${inserted}: ${article.title}`,
  };
}

export default async function ArtikelPage({ params }: Props) {
  const { nummer } = await params;
  const resolved = resolveArticle(nummer);
  if (!resolved) notFound();
  const { article } = resolved;
  const act = getAmendingAct();
  const inserted = isNewArticle(nummer);

  const display = `Artikel ${article.displayNumber}`;
  const crumbs: Crumb[] = [
    { label: `Hoofdstuk ${article.chapter}`, href: `/#hoofdstuk-${article.chapter.toLowerCase()}` },
  ];
  if (article.section !== null && article.sectionTitle) {
    crumbs.push({ label: `Afdeling ${article.section}` });
  }
  crumbs.push({ label: display });

  const diff = inserted ? undefined : getArticleDiff(nummer);
  const titleChange = getAmendments().titleChanges[nummer];
  const cleanBody = (
    <ArticleBody
      article={article}
      repealedNote={statusText.repealed(act)}
      repealedHref={`/artikel/${nummer}?diff=1`}
    />
  );

  return (
    <article>
      <RegisterTab
        href={`/artikel/${nummer}`}
        label={display.replace(/^Artikel/, "Art.")}
        title={article.title}
      />
      <Breadcrumbs crumbs={crumbs} />
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">{display}</p>
        <h1 className="mt-1 text-2xl font-bold text-balance">{article.title}</h1>
        <p className="mt-2 text-sm text-muted">
          Hoofdstuk {article.chapter} — {article.chapterTitle}
          {article.sectionTitle ? ` · Afdeling ${article.section} — ${article.sectionTitle}` : ""}
        </p>
        {inserted && (
          <p className="mt-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
            {statusText.insertedArticle(act)}
          </p>
        )}
        {diff && (
          <p className="mt-2 text-sm text-muted">
            {statusText.amended(act)}{" "}
            <a href={`/artikel/${nummer}?diff=1`} className="text-accent hover:underline">
              Bekijk de wijzigingen
            </a>
          </p>
        )}
      </header>
      {diff ? (
        <Suspense fallback={cleanBody}>
          <AmendedArticleView
            clean={cleanBody}
            diff={
              <>
                {titleChange && (
                  <p className="mb-4 text-sm" data-diff-status="modified">
                    <span className="text-muted">Titel: </span>
                    <del className="rounded-sm bg-red-100 px-0.5 dark:bg-red-950">{titleChange.previous}</del>{" "}
                    <ins className="rounded-sm bg-emerald-100 px-0.5 no-underline dark:bg-emerald-950">
                      {titleChange.title}
                    </ins>
                  </p>
                )}
                <DiffArticleBody paragraphs={article.paragraphs} diffs={diff} idPrefix="w-" />
              </>
            }
            legend={statusText.diffLegend(act)}
            changedAnchors={diff.filter((d) => d.status !== "unchanged").map((d) => `w-${d.anchor}`)}
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
