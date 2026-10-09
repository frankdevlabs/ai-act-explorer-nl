import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { APPLICATION_CAVEAT, dottedDate, statusText } from "@/lib/amendment-meta";
import {
  clip,
  getAmendingAct,
  getAmendmentDiffs,
  getAmendments,
  getAnnex,
  getArticle,
  isNewAnnex,
  isNewArticle,
} from "@/lib/data";
import { flattenNodes } from "@/lib/flatten";
import type { Amendment } from "@/lib/types";

export function generateMetadata(): Metadata {
  const act = getAmendingAct();
  return {
    title: "Wijzigingen (digitale omnibus)",
    description: `Alle wijzigingen van de AI-verordening (EU) 2024/1689 door ${act.document} (${act.shortTitle}), per artikel en bijlage.`,
  };
}

const OP_LABEL: Record<Amendment["operation"], string> = {
  replace: "vervangen",
  insert: "ingevoegd",
  add: "toegevoegd",
  delete: "geschrapt",
};

/** "37) a)" */
const instructionNumber = (am: Amendment) => `${am.seq})${am.sub ? ` ${am.sub})` : ""}`;

export default function WijzigingenPage() {
  const act = getAmendingAct();
  const amendments = getAmendments();
  const diffs = getAmendmentDiffs();

  /** Deep link + excerpt of the current text this instruction produced. */
  const linkFor = (am: Amendment, kind: "article" | "annex", slug: string) => {
    const page = kind === "article" ? `/artikel/${slug}` : `/bijlage/${slug}`;
    const inserted = kind === "article" ? isNewArticle(slug) : isNewAnnex(slug);
    if (inserted) {
      const title = kind === "article" ? getArticle(slug)?.title : getAnnex(slug)?.title;
      return { href: page, excerpt: title ?? "" };
    }
    const list = kind === "article" ? diffs.articles[slug] : diffs.annexes[slug];
    const hit = list?.find((p) => p.ids.includes(am.id));
    if (!hit) return { href: `${page}?diff=1`, excerpt: "" };
    const current =
      kind === "article"
        ? getArticle(slug)?.paragraphs.find((p) => p.anchor === hit.anchor && !p.repealed)
        : undefined;
    return {
      href: `${page}?diff=1#w-${hit.anchor}`,
      excerpt: current ? clip(flattenNodes(current.content), 160) : "",
    };
  };

  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Wijzigingen" }]} />
      <h1 className="mb-2 text-2xl font-bold">Wijzigingen — {act.shortTitle}</h1>
      <p className="mb-2 text-sm text-muted">
        Alle wijzigingen van Verordening (EU) 2024/1689 door {statusText.publication(act)}. De tekst
        op deze site is de geconsolideerde tekst per {dottedDate(act.inForce)}; open een artikel
        met “Toon wijzigingen” voor de wijzigingen ten opzichte van de tekst daarvóór.
      </p>
      <p className="mb-6 text-sm text-muted">
        {APPLICATION_CAVEAT}{" "}
        <a href={act.eli} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          {act.document} in het Publicatieblad
        </a>
      </p>
      <div className="space-y-8">
        {amendments.orderedTargets.map((t) => {
          const ids = (t.kind === "article" ? amendments.byArticle : amendments.byAnnex)[t.slug] ?? [];
          const items = amendments.amendments.filter((a) => ids.includes(a.id));
          if (!items.length) return null;
          const article = t.kind === "article" ? getArticle(t.slug) : undefined;
          const annex = t.kind === "annex" ? getAnnex(t.slug) : undefined;
          const heading = article
            ? `Artikel ${article.displayNumber} — ${article.title}`
            : annex
              ? `Bijlage ${annex.roman} — ${annex.title}`
              : t.slug;
          const href = t.kind === "article" ? `/artikel/${t.slug}` : `/bijlage/${t.slug}`;
          return (
            <section key={`${t.kind}-${t.slug}`}>
              <h2 className="mb-2 font-semibold">
                <Link href={href} className="hover:text-accent">
                  {heading}
                </Link>
              </h2>
              <ul className="space-y-2 border-l border-line pl-4">
                {items.map((am) => {
                  const { href: linkHref, excerpt } = linkFor(am, t.kind, t.slug);
                  return (
                    <li key={am.id} className="text-sm">
                      <Link href={linkHref} className="group block rounded py-0.5">
                        <span className="text-muted">
                          {instructionNumber(am)}{" "}
                          <span className="font-medium text-foreground">{OP_LABEL[am.operation]}</span> —{" "}
                          {am.parentIntro ? `${am.parentIntro} … ` : ""}
                          {am.intro}
                        </span>
                        {excerpt && (
                          <span className="mt-0.5 block text-muted/80 group-hover:text-foreground">
                            {excerpt}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
