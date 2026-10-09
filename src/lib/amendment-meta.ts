/**
 * Wording for the in-force amending act's status, shared by the site and the
 * MCP server. Every fact comes from AmendingActMeta, which parse-amendments.ts
 * reads from the act's OJ text — nothing here is a hard-coded date or number.
 */
import type { AmendingActMeta } from "./types";

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** "2026-07-27" → "27 juli 2026" */
export function dutchDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-07-27" → "27.7.2026" (EUR-Lex style) */
export function dottedDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

/** "Verordening (EU) 2026/1744 (digitale omnibus inzake AI)" */
export const actLabel = (m: AmendingActMeta) => `${m.document} (${m.shortTitle})`;

/** "Vo. (EU) 2026/1744" */
export const actShort = (m: AmendingActMeta) => m.document.replace(/^Verordening/, "Vo.");

/** "in werking sinds 27 juli 2026" */
export const inForceSince = (m: AmendingActMeta) => `in werking sinds ${dutchDate(m.inForce)}`;

/** Entry into force is not application: the act staggers dates through art. 113. */
export const APPLICATION_CAVEAT = "In werking ≠ van toepassing — zie artikel 113.";

export const statusText = {
  insertedArticle: (m: AmendingActMeta) => `Ingevoegd bij ${actLabel(m)}; ${inForceSince(m)}.`,
  addedAnnex: (m: AmendingActMeta) => `Toegevoegd bij ${actLabel(m)}; ${inForceSince(m)}.`,
  amended: (m: AmendingActMeta) => `Gewijzigd bij ${actLabel(m)}; ${inForceSince(m)}.`,
  repealed: (m: AmendingActMeta) => `Geschrapt bij ${actShort(m)}`,
  diffLegend: (m: AmendingActMeta) => `t.o.v. de tekst vóór ${dutchDate(m.inForce)} (${actShort(m)})`,
  /** "Bron: … PB L, 2026/1744, 24.7.2026 …" */
  publication: (m: AmendingActMeta) =>
    `${m.document} van ${dutchDate(m.adopted)} (${m.ojRef}), ${inForceSince(m)}`,
};
