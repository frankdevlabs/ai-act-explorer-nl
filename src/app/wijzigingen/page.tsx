import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { getAmendmentDiffs, getAmendments, getAnnex, getArticle, getNewArticle } from "@/lib/data";
import { flattenNodes } from "@/lib/flatten";
import type { Amendment } from "@/lib/types";

export const metadata: Metadata = {
  title: "Wijzigingen (digitale omnibus)",
  description:
    "Alle wijzigingen van de AI-verordening (EU) 2024/1689 door de digitale omnibus inzake AI (PE-CONS 30/26), per artikel en bijlage.",
};

const OP_LABEL: Record<Amendment["operation"], string> = {
  replace: "vervangen",
  insert: "ingevoegd",
  add: "toegevoegd",
  delete: "geschrapt",
};

function excerpt(am: Amendment): string {
  const flat = am.newContent
    ? flattenNodes(am.newContent)
    : am.newParagraphs
      ? flattenNodes(am.newParagraphs.flatMap((p) => p.content))
      : am.newItems
        ? flattenNodes([{ type: "list", items: am.newItems }])
        : am.newArticle
          ? am.newArticle.title
          : am.newAnnex
            ? am.newAnnex.title
            : "";
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}

export default function WijzigingenPage() {
  const amendments = getAmendments();
  const diffs = getAmendmentDiffs();

  const anchorFor = (am: Amendment, kind: "article" | "annex", slug: string): string => {
    const list = kind === "article" ? diffs.articles[slug] : diffs.annexes[slug];
    const hit = list?.find((p) => p.seq.includes(am.seq));
    return hit ? `?diff=1#w-${hit.anchor}` : "?diff=1";
  };

  const targets = amendments.orderedTargets;

  return (
    <div>
      <Breadcrumbs crumbs={[{ label: "Wijzigingen" }]} />
      <h1 className="mb-2 text-2xl font-bold">Wijzigingen — digitale omnibus inzake AI</h1>
      <p className="mb-6 text-sm text-muted">
        Overzicht van alle wijzigingen van Verordening (EU) 2024/1689 door PE-CONS 30/26
        (2025/0359 COD, aangenomen 18 juni 2026; nog niet bekendgemaakt in het Publicatieblad).
        Open een artikel met “Toon wijzigingen” voor de wijzigingen in de lopende tekst.
      </p>
      <div className="space-y-8">
        {targets.map((t) => {
          const ids = (t.kind === "article" ? amendments.byArticle : amendments.byAnnex)[t.slug] ?? [];
          const items = amendments.amendments.filter((a) =>
            ids.includes(`${a.seq}${a.sub ?? ""}`),
          );
          if (!items.length) return null;
          const newArticle = t.kind === "article" ? getNewArticle(t.slug) : undefined;
          const base =
            t.kind === "article" && !newArticle ? getArticle(Number(t.slug)) : undefined;
          const annex = t.kind === "annex" ? getAnnex(t.slug) : undefined;
          const heading = newArticle
            ? `Artikel ${newArticle.displayNumber} — ${newArticle.title}`
            : base
              ? `Artikel ${base.number} — ${amendments.titleChanges[t.slug]?.title ?? base.title}`
              : annex
                ? `Bijlage ${annex.roman} — ${annex.title}`
                : t.slug;
          const href = newArticle
            ? `/artikel/${newArticle.slug}`
            : t.kind === "article"
              ? `/artikel/${t.slug}`
              : `/bijlage/${t.slug}`;
          return (
            <section key={`${t.kind}-${t.slug}`}>
              <h2 className="mb-2 font-semibold">
                <Link href={href} className="hover:text-accent">
                  {heading}
                </Link>
              </h2>
              <ul className="space-y-2 border-l border-line pl-4">
                {items.map((am) => {
                  const id = `${am.seq}${am.sub ? `)${am.sub}` : ""}`;
                  const linkHref =
                    newArticle || am.newAnnex
                      ? href
                      : `${href}${anchorFor(am, t.kind, t.slug)}`;
                  return (
                    <li key={`${am.seq}-${am.sub ?? ""}`} className="text-sm">
                      <Link href={linkHref} className="group block rounded py-0.5">
                        <span className="text-muted">
                          {id}) <span className="font-medium text-foreground">{OP_LABEL[am.operation]}</span>{" "}
                          — {am.scope.description}
                        </span>
                        {excerpt(am) && (
                          <span className="mt-0.5 block text-muted/80 group-hover:text-foreground">
                            {excerpt(am)}
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
