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
  /** `repealed`: EUR-Lex's deletion placeholder ("—————") where an amending
   *  act struck a provision; rendered muted, never indexed for search. */
  | { type: "text"; text: string; refs?: RefSpan[]; repealed?: true }
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
  /** Lid number; null for articles whose body has no numbered paragraphs and
   *  for inserted leden numbered "1 bis" (see displayNumber). */
  number: number | null;
  /** Display number of an inserted lid outside numeric numbering ("1 bis");
   *  its anchor is the compact form ("lid-1bis"). */
  displayNumber?: string;
  anchor: string;
  content: ContentNode[];
  /** A lid struck by an amending act: content is the "—————" placeholder. */
  repealed?: true;
}

export interface Article {
  /** Integer part of the article number (4 for "4 bis"); ordering only. */
  number: number;
  /** Route slug and lookup key: "4", "4bis", "75quater". */
  slug: string;
  /** Display form: "4", "4 bis". */
  displayNumber: string;
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
  slug: string;
  displayNumber: string;
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
// Change layer of the in-force amending act (Verordening (EU) 2026/1744,
// digitale omnibus inzake AI). Derived by scripts/parse-amendments.ts from
// EUR-Lex sources only (data/source/corpus.json): the previous consolidated
// version, the current one (the base corpus) and the act's OJ text.

export type AmendmentOperation = "replace" | "insert" | "add" | "delete";

export interface AmendmentTarget {
  kind: "article" | "annex";
  /** Article slug ("4bis") or lowercase annex roman ("xiv"). */
  slug: string;
  /** Paragraph anchors the instruction changed; "titel" = the article title. */
  anchors: string[];
  /** The instruction inserts the whole article/annex. */
  inserted?: true;
}

/** One leaf instruction of Article 1 of the amending act. */
export interface Amendment {
  /** "2a" — instruction 2), sub-instruction a). */
  id: string;
  seq: number;
  sub?: string;
  /** Verbatim instruction wording: "lid 2 wordt vervangen door:". */
  intro: string;
  /** Verbatim wording of the parent instruction ("artikel 2 wordt als volgt gewijzigd:"). */
  parentIntro?: string;
  operation: AmendmentOperation;
  targets: AmendmentTarget[];
}

export interface AmendingActMeta {
  celex: string;
  /** "Verordening (EU) 2026/1744" */
  document: string;
  /** "digitale omnibus inzake AI" */
  shortTitle: string;
  title: string;
  eli: string;
  /** "PB L, 2026/1744, 24.7.2026" */
  ojRef: string;
  /** ISO dates read from the act: adoption, OJ publication, entry into force. */
  adopted: string;
  published: string;
  inForce: string;
  /** Consolidated versions compared: before and after the act ("02024R1689-…"). */
  previous: string;
  current: string;
}

export interface AmendmentsGenerated {
  meta: AmendingActMeta;
  amendments: Amendment[];
  /** Instruction ids grouped by article slug / lowercase annex roman. */
  byArticle: Record<string, string[]>;
  byAnnex: Record<string, string[]>;
  /** All changed or inserted targets in document order. */
  orderedTargets: { kind: "article" | "annex"; slug: string }[];
  /** Articles and annexes the act inserted (their text is in the base corpus). */
  newArticles: { slug: string; displayNumber: string; title: string; insertAfter: number }[];
  newAnnexes: { roman: string; title: string; insertAfter: string }[];
  /** Replaced article titles, keyed by slug. */
  titleChanges: Record<string, { title: string; previous: string; ids: string[] }>;
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
  /** Instruction ids ("2a") responsible for this paragraph's status. */
  ids: string[];
}

/** Per affected target: the full paragraph list in new-document order.
 *  Article keys are numbers-as-strings ("2"); annex keys lowercase roman ("iii").
 *  Annex content is treated as one pseudo-paragraph anchored "inhoud". */
export interface AmendmentDiffs {
  articles: Record<string, ParagraphDiff[]>;
  annexes: Record<string, ParagraphDiff[]>;
}

// ---------------------------------------------------------------------------
// Recital↔article map (curated editorial layer, epic 5)

export interface RecitalMapEntry {
  /** Article slugs the recital motivates: base numbers ("5") or omnibus
   *  new-article slugs ("4bis"). Empty + reviewed = "none relevant". */
  articles: string[];
  /** False while drafted by the curation skill, true after human review. */
  reviewed: boolean;
  /** Dutch editorial aid; not rendered in v1. */
  note?: string;
}

export interface RecitalMapSource {
  meta: {
    version: number;
    /** False while curation is in progress; verify-recital-map skips
     *  exact-count assertions until flipped. */
    complete: boolean;
  };
  /** Keyed "1".."180" — every recital present, reviewed or not. */
  recitals: Record<string, RecitalMapEntry>;
}

export interface RecitalMapGenerated {
  meta: { version: number; complete: boolean; reviewedCount: number; pairCount: number };
  /** Recital number → article slugs in document order (empty entries omitted). */
  byRecital: Record<string, string[]>;
  /** Article slug → recital numbers ascending (inverse of byRecital). */
  byArticle: Record<string, number[]>;
}
