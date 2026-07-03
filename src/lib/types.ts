/**
 * Internal cross-reference: text.slice(start, end) reads as a reference to
 * another part of the regulation ("artikel 6, lid 2"), href is the internal
 * route it resolves to. Offsets index into the owning node's `text`.
 */
export interface RefSpan {
  start: number;
  end: number;
  href: string;
}

export type ContentNode =
  | { type: "text"; text: string; refs?: RefSpan[] }
  | { type: "heading"; text: string }
  | { type: "list"; items: ListItem[] };

export interface ListItem {
  marker: string;
  content: ContentNode[];
  anchor?: string;
}

export interface Footnote {
  id: string;
  label: string;
  text: string;
}

export interface ArticleParagraph {
  /** Lid number; null for articles whose body has no numbered paragraphs */
  number: number | null;
  anchor: string;
  content: ContentNode[];
}

export interface Article {
  number: number;
  title: string;
  chapter: string;
  chapterTitle: string;
  section: number | null;
  sectionTitle: string | null;
  paragraphs: ArticleParagraph[];
  footnotes: Footnote[];
}

export interface RecitalParagraph {
  text: string;
  refs?: RefSpan[];
}

export interface Recital {
  number: number;
  paragraphs: RecitalParagraph[];
}

export interface Annex {
  roman: string;
  ordinal: number;
  title: string;
  content: ContentNode[];
  footnotes: Footnote[];
}

export interface TocEntry {
  number: number;
  title: string;
}

export interface TocSection {
  number: number;
  title: string;
  articles: TocEntry[];
}

export interface TocChapter {
  roman: string;
  title: string;
  sections: TocSection[];
  articles: TocEntry[];
}

export interface Toc {
  chapters: TocChapter[];
  annexes: { roman: string; title: string }[];
  recitalCount: number;
}

export interface SearchDoc {
  id: string;
  type: "artikel" | "overweging" | "bijlage";
  ref: string;
  heading: string;
  url: string;
  text: string;
}
