import articlesJson from "../../data/generated/articles.json";
import recitalsJson from "../../data/generated/recitals.json";
import annexesJson from "../../data/generated/annexes.json";
import tocJson from "../../data/generated/toc.json";
import type { Annex, Article, Recital, Toc } from "./types";
import { flattenNodes } from "./flatten";

const articles = articlesJson as Article[];
const recitals = recitalsJson as Recital[];
const annexes = annexesJson as Annex[];
const toc = tocJson as Toc;

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
  return annexes.find((a) => a.roman.toLowerCase() === roman.toLowerCase());
}

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

export function articlePrevNext(nummer: number): { prev?: PrevNextLink; next?: PrevNextLink } {
  const link = (a?: Article): PrevNextLink | undefined =>
    a && { href: `/artikel/${a.number}`, label: `Artikel ${a.number}`, title: a.title };
  return {
    prev: link(getArticle(nummer - 1)),
    next: link(getArticle(nummer + 1)),
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
  const idx = annexes.findIndex((a) => a.roman.toLowerCase() === roman.toLowerCase());
  const link = (a?: Annex): PrevNextLink | undefined =>
    a && { href: `/bijlage/${a.roman.toLowerCase()}`, label: `Bijlage ${a.roman}`, title: a.title };
  return {
    prev: link(idx > 0 ? annexes[idx - 1] : undefined),
    next: link(idx >= 0 ? annexes[idx + 1] : undefined),
  };
}
