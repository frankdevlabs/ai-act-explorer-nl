import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleBody } from "@/components/content/ArticleBody";
import { Breadcrumbs, type Crumb } from "@/components/layout/Breadcrumbs";
import { PrevNextNav } from "@/components/layout/PrevNextNav";
import { articlePrevNext, getArticle, getArticles } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return getArticles().map((a) => ({ nummer: String(a.number) }));
}

type Props = { params: Promise<{ nummer: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { nummer } = await params;
  const article = getArticle(Number(nummer));
  if (!article) return {};
  return {
    title: `Artikel ${article.number} — ${article.title}`,
    description: `Artikel ${article.number} van de AI-verordening (EU) 2024/1689: ${article.title}`,
  };
}

export default async function ArtikelPage({ params }: Props) {
  const { nummer } = await params;
  const article = getArticle(Number(nummer));
  if (!article) notFound();

  const crumbs: Crumb[] = [
    { label: `Hoofdstuk ${article.chapter}`, href: `/#hoofdstuk-${article.chapter.toLowerCase()}` },
  ];
  if (article.section !== null && article.sectionTitle) {
    crumbs.push({ label: `Afdeling ${article.section}` });
  }
  crumbs.push({ label: `Artikel ${article.number}` });

  return (
    <article>
      <Breadcrumbs crumbs={crumbs} />
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">
          Artikel {article.number}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-balance">{article.title}</h1>
        <p className="mt-2 text-sm text-muted">
          Hoofdstuk {article.chapter} — {article.chapterTitle}
          {article.sectionTitle ? ` · Afdeling ${article.section} — ${article.sectionTitle}` : ""}
        </p>
      </header>
      <ArticleBody article={article} />
      <PrevNextNav {...articlePrevNext(article.number)} />
    </article>
  );
}
