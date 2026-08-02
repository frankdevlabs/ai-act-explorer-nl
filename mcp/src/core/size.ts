/**
 * Result-size guardrails for the one tool on each explorer server that can
 * return an unbounded amount of text: the context pack, which composes N full
 * articles plus their recitals (and, on dora, L2 routing and coverage). Two
 * client ceilings apply: claude.ai / Desktop truncate a tool result around 150k
 * characters, and Claude Code's default MAX_MCP_OUTPUT_TOKENS is 25k tokens (it
 * warns at 10k). Crossing either silently yields a *truncated* pack, which is
 * worse than an error: a review built on half a pack still looks complete. So
 * the tool refuses and says by how much, rather than trimming.
 *
 * The default ceiling is the strict (Claude Code) one; a claude.ai-only
 * deployment can raise it toward 150k via MCP_MAX_RESULT_CHARS.
 *
 * The Dutch message templates live here so both explorers word a refusal
 * identically; the corpus facts they quote (which regulation, which articles,
 * how much of the pack is recitals) are parameters. The caller decides how to
 * wrap the verdict — core never builds a ToolResult.
 */
import { fmt } from "./text.js";

export interface PackLimits {
  /** More articles than this → refused before any text is assembled. */
  maxArticles: number;
  /** Assembled pack over this → refused. */
  maxChars: number;
  /** Over this → returned, prefixed with the size banner. */
  warnChars: number;
  /** Estimate only; the guard enforces characters, which are exact. */
  charsPerToken: number;
}

export const DEFAULT_PACK_LIMITS: PackLimits = {
  maxArticles: 20,
  maxChars: 85_000, // 25k tokens x 3.4 — also well under 150k
  warnChars: 34_000, // ~10k tokens — Claude Code's warn threshold
  charsPerToken: 3.4, // estimate for these Dutch corpora
};

/**
 * Limits with the MCP_MAX_RESULT_CHARS override applied. Call once at module
 * scope, not per request: the env is read at startup on both servers, and a
 * per-request read would make the tool description and the guard disagree.
 */
export function packLimitsFromEnv(defaults: PackLimits = DEFAULT_PACK_LIMITS): PackLimits {
  return {
    ...defaults,
    maxChars: Number(process.env.MCP_MAX_RESULT_CHARS) || defaults.maxChars,
  };
}

export const estTokens = (chars: number, limits: PackLimits): number =>
  Math.round(chars / limits.charsPerToken);

/** The count cap, refused before any text is assembled. */
export function tooManyArticlesMessage(
  requested: number,
  limits: PackLimits,
  /** e.g. "Verordening (EU) 2022/2554"; omit on a single-instrument corpus. */
  corpusLabel?: string,
): string {
  const batches = Math.ceil(requested / limits.maxArticles);
  const from = corpusLabel ? ` uit ${corpusLabel}` : "";
  return (
    `Contextpakket geweigerd: ${requested} artikelen gevraagd${from}, ` +
    `maximaal ${limits.maxArticles} per aanroep. Splits de aanvraag in ${batches} aanroepen van ten hoogste ` +
    `${limits.maxArticles} artikelen. Let op: ook onder dat aantal geldt een omvangsplafond — vraag alleen ` +
    "de bepalingen die u nodig heeft."
  );
}

/** Corpus facts the refusal quotes back to the caller. */
export interface PackFacts {
  /** Number of article sections in the assembled pack. */
  sections: number;
  /** Per-article sizes as [label, chars]; rendered largest first. */
  sizes: Array<[string | number, number]>;
  /** Recitals shared across the pack (deduplicated). */
  sharedRecitals: number;
  /** Characters those shared recitals account for. */
  sharedRecitalChars: number;
  /** e.g. "Verordening (EU) 2022/2554"; omit on a single-instrument corpus. */
  corpusLabel?: string;
  /** What a single over-budget article should be fetched with instead. */
  singleArticleHint: string;
}

export type PackVerdict =
  | { kind: "ok" }
  | { kind: "warn"; banner: string }
  | { kind: "refused"; message: string };

/**
 * Size ceiling, measured only after assembly: the per-article cost is dominated
 * by recitals, which are deduplicated across the pack, so it cannot be
 * predicted from the article count alone. Refuse rather than trim — and say
 * which articles are expensive, so the caller can re-split deliberately instead
 * of bisecting.
 */
export function checkPackSize(md: string, limits: PackLimits, facts: PackFacts): PackVerdict {
  if (md.length > limits.maxChars) {
    const breakdown = [...facts.sizes]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => `artikel ${label}: ~${Math.round(n / 1000)}k`)
      .join(", ");
    // Advice, deliberately conservative: the shared recital block does not
    // shrink in proportion to the article count (recitals are deduplicated
    // and several articles cite the same ones), so the linear estimate is
    // an over-estimate — take one off it.
    const linear = Math.floor(facts.sections * (limits.maxChars / md.length));
    const advice =
      facts.sections === 1
        ? `Dit ene artikel past al niet onder het plafond — gebruik get_article (${facts.singleArticleHint}) ` +
          "of verhoog MCP_MAX_RESULT_CHARS."
        : `Vraag ongeveer ${Math.min(Math.max(linear - 1, 1), facts.sections - 1)} artikel(en) per aanroep, ` +
          "of minder wanneer u de grootste artikelen combineert. Voor één bepaling is get_article goedkoper.";
    const from = facts.corpusLabel ? ` uit ${facts.corpusLabel}` : "";
    return {
      kind: "refused",
      message:
        `Contextpakket geweigerd: het pakket voor ${facts.sections} artikel(en)${from} ` +
        `is ${fmt(md.length)} tekens (~${fmt(estTokens(md.length, limits))} tokens), boven het plafond van ` +
        `${fmt(limits.maxChars)} tekens (~${fmt(estTokens(limits.maxChars, limits))} tokens). Het pakket wordt geweigerd ` +
        "en niet afgekapt: een afgekapt pakket ziet er volledig uit.\n\n" +
        `Opbouw — artikelen: ${breakdown}; gedeelde overwegingen (${facts.sharedRecitals}): ~${Math.round(facts.sharedRecitalChars / 1000)}k tekens ` +
        "(overwegingen zijn de grootste post en worden binnen het pakket ontdubbeld).\n\n" +
        `${advice}\n\n` +
        "Plafonds: claude.ai kapt een toolresultaat af rond 150.000 tekens; Claude Code hanteert standaard 25.000 tokens " +
        "(MAX_MCP_OUTPUT_TOKENS). Een implementatie die alleen claude.ai bedient kan dit plafond verhogen via MCP_MAX_RESULT_CHARS.",
    };
  }

  // Warning band. The caller puts the banner first in the result on purpose: if
  // a client truncates anyway, the size notice is in the part that survives.
  if (md.length > limits.warnChars) {
    return {
      kind: "warn",
      banner:
        `> **Omvang:** dit pakket is ${fmt(md.length)} tekens (~${fmt(estTokens(md.length, limits))} tokens) ` +
        `en overschrijdt daarmee de waarschuwingsgrens van Claude Code (~${fmt(estTokens(limits.warnChars, limits))} tokens). ` +
        `Het plafond ligt op ${fmt(limits.maxChars)} tekens; vraag bij een volgende aanroep minder artikelen tegelijk.`,
    };
  }

  return { kind: "ok" };
}
