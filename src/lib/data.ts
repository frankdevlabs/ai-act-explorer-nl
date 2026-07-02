import articlesJson from "../../data/generated/articles.json";
import recitalsJson from "../../data/generated/recitals.json";
import annexesJson from "../../data/generated/annexes.json";
import tocJson from "../../data/generated/toc.json";
import type { Annex, Article, Recital, Toc } from "./types";

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
