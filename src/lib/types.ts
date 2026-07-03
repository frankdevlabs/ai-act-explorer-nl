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
  | { type: "list"; items: ListItem[] }
  | { type: "table"; rows: string[][] };

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

// ---------------------------------------------------------------------------
// Digitale-omnibus amendment layer (PE-CONS 30/26, 2025/0359 COD).
// Source: data/source/amendments/pe-cons-30-26.json (curated transcription —
// see AGENTS.md carve-out); generated: data/generated/amendments.json and
// amendment-diffs.json via scripts/parse-amendments.ts.

export type AmendmentOperation = "replace" | "insert" | "add" | "delete";

export interface AmendmentScope {
  /** Existing anchor in the base article/annex: "lid-2", "lid-2-g", "punt-14",
   *  or pseudo-scope "lid-2-aanhef" (chapeau text before the first list). */
  anchor?: string;
  wholeArticle?: boolean;
  /** True when the instruction replaces the article title. */
  title?: boolean;
  /** Instruction wording, e.g. "lid 2, punt g), wordt vervangen". */
  description: string;
}

export interface NewArticleSpec {
  /** Route slug: "4bis", "75quater" (lowercase, no hyphen). */
  slug: string;
  /** Display form: "4 bis". */
  displayNumber: string;
  title: string;
  /** Base article number this article is inserted after. */
  insertAfter: number;
  paragraphs: ArticleParagraph[];
}

export interface NewAnnexSpec {
  roman: string; // "XIV"
  title: string;
  insertAfter: string; // "XIII"
  content: ContentNode[];
}

export interface Amendment {
  /** Instruction number within Article 1 of the amending act; sub for "2)a)". */
  seq: number;
  sub?: string;
  target: { article?: string; annex?: string }; // article: "2" | "4bis"; annex: "XIV"
  operation: AmendmentOperation;
  scope: AmendmentScope;
  /** Replacement content for a scoped change (lid body, point content, aanhef,
   *  or — with scope.title — a single text node holding the new title). */
  newContent?: ContentNode[];
  /** Whole-article replaces and lid inserts: full paragraphs in new order.
   *  Anchors may be omitted in the source; the parser derives them. */
  newParagraphs?: ArticleParagraph[];
  /** Point-level inserts: new list items placed after scope.anchor. */
  newItems?: ListItem[];
  /** Present when the instruction inserts a whole new article. */
  newArticle?: NewArticleSpec;
  /** Present when the instruction adds a whole new annex. */
  newAnnex?: NewAnnexSpec;
  /** Free-text remark, e.g. staggered application dates. */
  note?: string;
}

export interface AmendmentsSource {
  meta: {
    document: string;
    date: string;
    /** False while transcription is in progress; verify-amendments skips
     *  exact-count assertions until flipped. */
    complete: boolean;
  };
  amendments: Amendment[];
}

export interface AmendmentsGenerated extends AmendmentsSource {
  /** Amendment ids ("2", "2a") grouped by base-article number / new-article slug. */
  byArticle: Record<string, string[]>;
  /** Amendment ids grouped by annex roman. */
  byAnnex: Record<string, string[]>;
  /** All affected targets in document order, for cross-target navigation. */
  orderedTargets: { kind: "article" | "annex"; slug: string }[];
  newArticles: NewArticleSpec[];
  newAnnexes: NewAnnexSpec[];
  /** Article-title replacements, keyed by article number. */
  titleChanges: Record<string, { title: string; seq: number }>;
}

/** Refs offsets index into this segment's `text` (spans crossing a segment
 *  boundary are clipped into per-segment fragments). Never set on `del`.
 *  `br` marks a segment that starts a new display line: the parser splits
 *  segments at block boundaries (flattenWithBreaks) so the diff view can
 *  restore paragraph/list structure that flattening collapsed. */
export type DiffSegment = { op: "eq" | "ins" | "del"; text: string; refs?: RefSpan[]; br?: true };

export interface ParagraphDiff {
  anchor: string;
  status: "modified" | "inserted" | "deleted" | "unchanged";
  /** Display number for inserted leden that fall outside numeric numbering
   *  ("5 bis"); base paragraphs render their own number. */
  displayNumber?: string;
  /** Word-level segments for modified/inserted/deleted paragraphs. */
  segments?: DiffSegment[];
  /** Structured replacement content (drives the clean "nieuwe tekst" view). */
  newContent?: ContentNode[];
  /** Instruction seq numbers responsible for this paragraph's status. */
  seq: number[];
}

/** Per affected target: the full paragraph list in new-document order.
 *  Article keys are numbers-as-strings ("2"); annex keys lowercase roman ("iii").
 *  Annex content is treated as one pseudo-paragraph anchored "inhoud". */
export interface AmendmentDiffs {
  articles: Record<string, ParagraphDiff[]>;
  annexes: Record<string, ParagraphDiff[]>;
}
