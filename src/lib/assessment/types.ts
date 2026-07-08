/**
 * AI Act assessment (epic 7) — data model for the curated questionnaire in
 * data/questionnaire/assessment-v1.json. The questionnaire is editorial
 * content (like the recital map): it paraphrases obligations and deep-links
 * into the legal corpus, but never replaces it. Verified by
 * scripts/verify-assessment.ts (ref integrity + routing sanity + fixtures).
 */

/** Deep link into the corpus, e.g. { label: "Art. 6, lid 3", href: "/artikel/6#lid-3" }. */
export interface QRef {
  label: string;
  href: string;
}

/** One help block: a paragraph or a bullet list. */
export type HelpBlock = string | { bullets: string[] };
/** Editorial guidance: a plain paragraph or a sequence of paragraphs/lists. */
export type HelpContent = string | HelpBlock[];

/**
 * Visibility/derivation condition. `flag` tests a derived flag (set by
 * QEffect or by the engine); `answer` tests a raw answer value.
 */
export interface QCondition {
  all?: QCondition[];
  any?: QCondition[];
  not?: QCondition;
  flag?: string;
  answer?: { q: string; is: string | string[] };
}

/** Answer-triggered flag assignment: when the answer is (one of) `when`, set `setFlag`. */
export interface QEffect {
  when: string | string[];
  setFlag: string;
}

export type AnswerType = "janee" | "janeenvt" | "choice" | "text";

export interface Question {
  /**
   * Stable id ("5.1", "11.20"). The numeric prefix is historical (source
   * workbook numbering) and need not match the displayed module number.
   * Ids of stored answers persist in users' localStorage: never reuse a
   * retired id with different semantics (see RETIRED_IDS in the verify
   * script).
   */
  id: string;
  text: string;
  /** Editorial guidance shown under the question. */
  help?: HelpContent;
  refs?: QRef[];
  answerType: AnswerType;
  options?: { value: string; label: string }[];
  effects?: QEffect[];
  showIf?: QCondition;
  /**
   * Omnibus (PE-CONS 30/26) annotation: date the underlying provision starts
   * to apply and/or what the omnibus changes. Rendered as a dated badge.
   */
  omnibus?: { appliesFrom?: string; note: string };
  /** Compliance-checklist question: "nee" becomes an open action. */
  obligation?: boolean;
  /** Art. 5 question: "ja" marks the practice as prohibited (STOP). */
  prohibition?: boolean;
  /** Register column fed directly by this answer. */
  register?: string;
}

export interface Module {
  /** "m1".."m18" */
  id: string;
  nr: number;
  title: string;
  intro?: HelpContent;
  refs?: QRef[];
  showIf?: QCondition;
  /** Only relevant for financial entities (DORA/Wft toggle). */
  financeOnly?: boolean;
  /** Omnibus annotation at module level (e.g. high-risk application dates). */
  omnibus?: { appliesFrom?: string; note: string };
  questions: Question[];
}

/** Register column: value comes from a question ("q:1.1") or a derived key ("d:risicoklasse"). */
export interface RegisterColumn {
  id: string;
  label: string;
  source: string;
  financeOnly?: boolean;
}

export interface Questionnaire {
  meta: {
    version: number;
    title: string;
    updated: string;
    basis: string;
    disclaimer: string;
  };
  modules: Module[];
  registerColumns: RegisterColumn[];
}

// ---------------------------------------------------------------------------
// Engine output

export type RiskClass =
  | "geen-ai"
  | "verboden"
  | "hoogrisico"
  | "transparantierisico"
  | "minimaal";

export interface ObligationStatus {
  questionId: string;
  moduleId: string;
  text: string;
  status: "voldaan" | "actie" | "nvt" | "open";
  refs?: QRef[];
}

export interface TimelineEntry {
  date: string; // ISO or "van kracht"
  label: string;
  omnibus?: boolean;
}

export interface Evaluation {
  answered: number;
  total: number;
  kwalificatie: string;
  rollen: string[];
  riskClass: RiskClass;
  /** Art. 5 hits (question ids). */
  stops: string[];
  annex3Categorieen: string[];
  annex1: boolean;
  escape: { ingeroepen: boolean; mogelijk: boolean; geblokkeerdDoorProfilering: boolean };
  friaVereist: boolean;
  transparantieLeden: string[];
  obligations: ObligationStatus[];
  openActions: ObligationStatus[];
  timeline: TimelineEntry[];
  registerRow: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Stored state (localStorage)

export interface StoredSystem {
  id: string;
  /** Display name; falls back to answer 1.1. */
  name: string;
  answers: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface AssessmentState {
  v: 1;
  systems: StoredSystem[];
}
