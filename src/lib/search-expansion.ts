/**
 * Curated query-expansion groups (statutory vocabulary only). Terms in one
 * group are treated as interchangeable at query time: a query term pulls in
 * its group members as extra OR-terms, and a document matching any member
 * counts as covering the original term (see searchDocs coverage re-rank).
 *
 * Invariants, enforced by scripts/verify-search.ts:
 *  - every term is its own normalizeTerm fixpoint (lowercase, no diacritics,
 *    no stopwords, >= 2 chars);
 *  - no term appears in two groups;
 *  - every term matches at least one corpus doc under precision options.
 * Single tokens only — multi-word entries would be re-tokenized by MiniSearch.
 */
export const SYNONYM_GROUPS: string[][] = [
  ["kredietwaardigheid", "kredietscore", "krediet"],
  ["biometrie", "biometrisch", "biometrische"],
  ["emotieherkenning", "emotie", "emoties"],
  ["conformiteitsbeoordeling", "conformiteit"],
  ["rechtshandhaving", "politie"],
  ["onderwijs", "opleiding", "beroepsonderwijs"],
  ["migratie", "asiel", "grenstoezicht"],
  ["deepfake", "deepfakes"],
  ["werknemer", "werkgever", "arbeid"],
  ["uitkering", "uitkeringen", "bijstand"],
  ["strafbare", "strafbaar", "misdrijven"],
  ["profilering", "profileren"],
  ["werving", "sollicitatie"],
];

/** term → the other members of its group. */
export const SYNONYMS: Map<string, string[]> = new Map(
  SYNONYM_GROUPS.flatMap((group) =>
    group.map((term) => [term, group.filter((t) => t !== term)] as const),
  ),
);
