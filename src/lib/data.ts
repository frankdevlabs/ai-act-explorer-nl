import articlesJson from "../../data/generated/articles.json";
import recitalsJson from "../../data/generated/recitals.json";
import annexesJson from "../../data/generated/annexes.json";
import tocJson from "../../data/generated/toc.json";
import amendmentsJson from "../../data/generated/amendments.json";
import amendmentDiffsJson from "../../data/generated/amendment-diffs.json";
import recitalMapJson from "../../data/generated/recital-map.json";
import type {
  AmendingActMeta,
  AmendmentDiffs,
  AmendmentsGenerated,
  Annex,
  Article,
  ParagraphDiff,
  Recital,
  RecitalMapGenerated,
  Toc,
} from "./types";
import { flattenNodes, lidLabel } from "./flatten";

const articles = articlesJson as Article[];
const recitals = recitalsJson as Recital[];
const annexes = annexesJson as Annex[];
const toc = tocJson as Toc;
const amendments = amendmentsJson as unknown as AmendmentsGenerated;
const amendmentDiffs = amendmentDiffsJson as unknown as AmendmentDiffs;
const recitalMap = recitalMapJson as unknown as RecitalMapGenerated;

export function getToc(): Toc {
  return toc;
}

export function getArticles(): Article[] {
  return articles;
}

/** Article by route slug: "5", "4bis". */
export function getArticle(slug: string): Article | undefined {
  return articles.find((a) => a.slug === slug);
}

export function getRecitals(): Recital[] {
  return recitals;
}

export function getRecital(nummer: number): Recital | undefined {
  return recitals.find((r) => r.number === nummer);
}

export function getAnnexes(): Annex[] {
  return annexes;
}

export function getAnnex(roman: string): Annex | undefined {
  return annexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
}

// ---------------------------------------------------------------------------
// Change layer of the in-force amending act (Vo 2026/1744, digitale omnibus)

export function getAmendments(): AmendmentsGenerated {
  return amendments;
}

export function getAmendingAct(): AmendingActMeta {
  return amendments.meta;
}

export function getAmendmentDiffs(): AmendmentDiffs {
  return amendmentDiffs;
}

export function getArticleDiff(nummer: string): ParagraphDiff[] | undefined {
  return amendmentDiffs.articles[nummer];
}

export function getAnnexDiff(roman: string): ParagraphDiff[] | undefined {
  return amendmentDiffs.annexes[roman.toLowerCase()];
}

/** Article slugs whose text or title the amending act changed. */
export function getAmendedArticleNumbers(): Set<string> {
  return new Set([...Object.keys(amendmentDiffs.articles), ...Object.keys(amendments.titleChanges)]);
}

/** Article slugs the amending act inserted ("4bis", …). */
export function getInsertedArticleSlugs(): string[] {
  return amendments.newArticles.map((a) => a.slug);
}

export function isNewArticle(slug: string): boolean {
  return amendments.newArticles.some((a) => a.slug === slug);
}

export function getAmendedAnnexRomans(): Set<string> {
  return new Set(Object.keys(amendmentDiffs.annexes));
}

export type ResolvedArticle = { kind: "base"; article: Article };

/** Resolve a route param (article slug). */
export function resolveArticle(nummer: string): ResolvedArticle | undefined {
  const article = getArticle(nummer);
  return article && { kind: "base", article };
}

/** All article slugs in document order (4 < 4 bis < 5). */
const articleOrder: { slug: string; label: string; title: string }[] = articles.map((a) => ({
  slug: a.slug,
  label: `Artikel ${a.displayNumber}`,
  title: a.title,
}));

export function getArticleOrder(): { slug: string; label: string; title: string }[] {
  return articleOrder;
}

/** All annex romans (lowercase) in order. */
const annexOrder: string[] = annexes.map((a) => a.roman.toLowerCase());

export function getAnnexOrder(): string[] {
  return annexOrder;
}

/** Previous/next amended target (article or annex with a computed diff) in
 *  document order, for stepping through the changes. */
export function changedTargetPrevNext(
  kind: "article" | "annex",
  slug: string,
): { prevChanged?: { href: string; label: string }; nextChanged?: { href: string; label: string } } {
  const targets = amendments.orderedTargets.filter((t) =>
    t.kind === "article" ? !!amendmentDiffs.articles[t.slug] : !!amendmentDiffs.annexes[t.slug],
  );
  const idx = targets.findIndex((t) => t.kind === kind && t.slug === slug.toLowerCase());
  const link = (t?: { kind: "article" | "annex"; slug: string }) => {
    if (!t) return undefined;
    return t.kind === "article"
      ? {
          href: `/artikel/${t.slug}?diff=1`,
          label: articleOrder.find((e) => e.slug === t.slug)?.label ?? `Artikel ${t.slug}`,
        }
      : { href: `/bijlage/${t.slug}?diff=1`, label: `Bijlage ${t.slug.toUpperCase()}` };
  };
  return {
    prevChanged: link(idx > 0 ? targets[idx - 1] : undefined),
    nextChanged: link(idx >= 0 ? targets[idx + 1] : undefined),
  };
}

export function isNewAnnex(roman: string): boolean {
  return amendments.newAnnexes.some((n) => n.roman.toLowerCase() === roman.toLowerCase());
}

export function clip(text: string, max = 200): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
}

// ---------------------------------------------------------------------------
// Recital↔article map (curated editorial layer)

/** Recitals mapped to an article (base number or omnibus slug), with a short
 *  snippet of the recital's opening text. */
export function getRecitalsForArticle(slug: string): { number: number; snippet: string }[] {
  return (recitalMap.byArticle[slug] ?? []).flatMap((n) => {
    const r = getRecital(n);
    return r ? [{ number: n, snippet: clip(r.paragraphs[0]?.text ?? "", 100) }] : [];
  });
}

/** Articles a recital motivates, in document order, with display label and title. */
export function getArticlesForRecital(n: number): { slug: string; label: string; title: string }[] {
  return (recitalMap.byRecital[String(n)] ?? []).flatMap((slug) => {
    const entry = articleOrder.find((e) => e.slug === slug);
    return entry ? [entry] : [];
  });
}

export interface RefPreview {
  title: string;
  snippet: string;
}

/** Build-time hover preview for an internal cross-reference href. */
export function getPreview(href: string): RefPreview | undefined {
  const [page, fragment] = href.split("#");
  if (page === "/" && fragment?.startsWith("hoofdstuk-")) {
    const roman = fragment.slice("hoofdstuk-".length);
    const ch = toc.chapters.find((c) => c.roman.toLowerCase() === roman);
    if (!ch) return undefined;
    const nums = [...ch.articles, ...ch.sections.flatMap((s) => s.articles)].map((a) => a.number);
    return {
      title: `Hoofdstuk ${ch.roman} — ${ch.title}`,
      snippet:
        nums.length > 1
          ? `Artikelen ${Math.min(...nums)} tot en met ${Math.max(...nums)}`
          : nums.length === 1
            ? `Artikel ${nums[0]}`
            : "",
    };
  }
  const art = page.match(/^\/artikel\/([a-z0-9]+)$/);
  const a = art ? getArticle(art[1]) : undefined;
  if (a) {
    // deep links preview the targeted lid rather than the article opening
    const para = fragment
      ? a.paragraphs.find((p) => p.anchor === fragment || fragment.startsWith(`${p.anchor}-`))
      : undefined;
    const label = para ? lidLabel(para) : null;
    return {
      title: `Artikel ${a.displayNumber}${label ? `, lid ${label}` : ""} — ${a.title}`,
      snippet: clip(flattenNodes((para ?? a.paragraphs[0]).content)),
    };
  }
  const anx = page.match(/^\/bijlage\/([a-z]+)$/);
  if (anx) {
    const a = getAnnex(anx[1]);
    if (!a) return undefined;
    return { title: `Bijlage ${a.roman} — ${a.title}`, snippet: clip(flattenNodes(a.content)) };
  }
  const rct = page.match(/^\/overweging\/(\d+)$/);
  if (rct) {
    const r = getRecital(Number(rct[1]));
    if (!r) return undefined;
    return { title: `Overweging ${r.number}`, snippet: clip(r.paragraphs[0]?.text ?? "") };
  }
  return undefined;
}

export interface PrevNextLink {
  href: string;
  label: string;
  title?: string;
}

export function articlePrevNext(nummer: number | string): {
  prev?: PrevNextLink;
  next?: PrevNextLink;
} {
  const idx = articleOrder.findIndex((e) => e.slug === String(nummer));
  const link = (e?: { slug: string; label: string; title: string }): PrevNextLink | undefined =>
    e && { href: `/artikel/${e.slug}`, label: e.label, title: e.title };
  return {
    prev: link(idx > 0 ? articleOrder[idx - 1] : undefined),
    next: link(idx >= 0 ? articleOrder[idx + 1] : undefined),
  };
}

export function recitalPrevNext(nummer: number): { prev?: PrevNextLink; next?: PrevNextLink } {
  const link = (r?: Recital): PrevNextLink | undefined =>
    r && { href: `/overweging/${r.number}`, label: `Overweging ${r.number}` };
  return {
    prev: link(getRecital(nummer - 1)),
    next: link(getRecital(nummer + 1)),
  };
}

export function annexPrevNext(roman: string): { prev?: PrevNextLink; next?: PrevNextLink } {
  const idx = annexOrder.indexOf(roman.toLowerCase());
  const link = (r?: string): PrevNextLink | undefined => {
    const a = r ? getAnnex(r) : undefined;
    return (
      a && { href: `/bijlage/${a.roman.toLowerCase()}`, label: `Bijlage ${a.roman}`, title: a.title }
    );
  };
  return {
    prev: link(idx > 0 ? annexOrder[idx - 1] : undefined),
    next: link(idx >= 0 ? annexOrder[idx + 1] : undefined),
  };
}
