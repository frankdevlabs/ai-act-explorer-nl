import articlesJson from "../../data/generated/articles.json";
import recitalsJson from "../../data/generated/recitals.json";
import annexesJson from "../../data/generated/annexes.json";
import tocJson from "../../data/generated/toc.json";
import amendmentsJson from "../../data/generated/amendments.json";
import amendmentDiffsJson from "../../data/generated/amendment-diffs.json";
import type {
  AmendmentDiffs,
  AmendmentsGenerated,
  Annex,
  Article,
  NewArticleSpec,
  ParagraphDiff,
  Recital,
  Toc,
} from "./types";
import { flattenNodes } from "./flatten";

const articles = articlesJson as Article[];
const recitals = recitalsJson as Recital[];
const annexes = annexesJson as Annex[];
const toc = tocJson as Toc;
const amendments = amendmentsJson as unknown as AmendmentsGenerated;
const amendmentDiffs = amendmentDiffsJson as unknown as AmendmentDiffs;

export function getToc(): Toc {
  return toc;
}

export function getArticles(): Article[] {
  return articles;
}

export function getArticle(nummer: number): Article | undefined {
  return articles.find((a) => a.number === nummer);
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
  const base = annexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
  if (base) return base;
  const added = amendments.newAnnexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
  if (!added) return undefined;
  return {
    roman: added.roman,
    ordinal: annexes.length + 1 + amendments.newAnnexes.indexOf(added),
    title: added.title,
    content: added.content,
    footnotes: [],
  };
}

// ---------------------------------------------------------------------------
// Amendment layer (digitale omnibus, PE-CONS 30/26)

export function getAmendments(): AmendmentsGenerated {
  return amendments;
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

/** Base articles whose text or title the omnibus changes (numbers as strings). */
export function getAmendedArticleNumbers(): Set<string> {
  return new Set([...Object.keys(amendmentDiffs.articles), ...Object.keys(amendments.titleChanges)]);
}

export function getAmendedAnnexRomans(): Set<string> {
  return new Set(Object.keys(amendmentDiffs.annexes));
}

export function getNewArticle(slug: string): NewArticleSpec | undefined {
  return amendments.newArticles.find((a) => a.slug === slug);
}

export type ResolvedArticle =
  | { kind: "base"; article: Article }
  | {
      kind: "new";
      spec: NewArticleSpec;
      chapter: string;
      chapterTitle: string;
      section: number | null;
      sectionTitle: string | null;
    };

/** Resolve a route param: numeric = base article, slug = omnibus new article
 *  (chapter/section metadata inherited from its insertAfter neighbor). */
export function resolveArticle(nummer: string): ResolvedArticle | undefined {
  if (/^\d+$/.test(nummer)) {
    const article = getArticle(Number(nummer));
    return article && { kind: "base", article };
  }
  const spec = getNewArticle(nummer);
  if (!spec) return undefined;
  const neighbor = getArticle(spec.insertAfter);
  if (!neighbor) return undefined;
  return {
    kind: "new",
    spec,
    chapter: neighbor.chapter,
    chapterTitle: neighbor.chapterTitle,
    section: neighbor.section,
    sectionTitle: neighbor.sectionTitle,
  };
}

const SUFFIX_RANK: Record<string, number> = { bis: 1, ter: 2, quater: 3, quinquies: 4 };

function slugRank(slug: string): number {
  return SUFFIX_RANK[slug.replace(/^\d+/, "")] ?? 0;
}

/** All article slugs in document order: base articles with omnibus insertions
 *  spliced after their insertAfter neighbor (bis < ter < quater < quinquies). */
const articleOrder: { slug: string; label: string; title: string }[] = articles.flatMap((a) => [
  { slug: String(a.number), label: `Artikel ${a.number}`, title: a.title },
  ...amendments.newArticles
    .filter((n) => n.insertAfter === a.number)
    .sort((x, y) => slugRank(x.slug) - slugRank(y.slug))
    .map((n) => ({ slug: n.slug, label: `Artikel ${n.displayNumber}`, title: n.title })),
]);

export function getArticleOrder(): { slug: string; label: string; title: string }[] {
  return articleOrder;
}

/** All annex romans (lowercase) in order, omnibus additions appended after
 *  their insertAfter neighbor. */
const annexOrder: string[] = annexes.flatMap((a) => [
  a.roman.toLowerCase(),
  ...amendments.newAnnexes
    .filter((n) => n.insertAfter.toLowerCase() === a.roman.toLowerCase())
    .map((n) => n.roman.toLowerCase()),
]);

function clip(text: string, max = 200): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
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
  const art = page.match(/^\/artikel\/(\d+)$/);
  if (art) {
    const a = getArticle(Number(art[1]));
    if (!a) return undefined;
    // deep links preview the targeted lid rather than the article opening
    const para = fragment
      ? a.paragraphs.find((p) => p.anchor === fragment || fragment.startsWith(`${p.anchor}-`))
      : undefined;
    const lid = para?.number != null ? `, lid ${para.number}` : "";
    return {
      title: `Artikel ${a.number}${lid} — ${a.title}`,
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
