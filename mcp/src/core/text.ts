/**
 * Dutch-language formatting helpers shared by the explorer MCP servers.
 * Language-specific, deliberately: every explorer in this family serves the
 * Dutch text. Corpus-agnostic all the same — nothing here knows an instrument.
 */

/** Thousands separators without depending on the runtime's ICU build. */
export const fmt = (n: number, sep = ".") => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** "1 vraag" / "3 vragen"; Dutch plurals are irregular enough to spell out. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The shape of the `HelpContent` union the assessment layers use: a paragraph,
 * or a list of paragraphs and bullet lists. Structural, so each repo's own
 * `HelpContent` type is assignable without core importing it.
 */
export type HelpContentLike = string | (string | { bullets: string[] })[];

/** HelpContent (paragraph | paragraphs/bullet lists) → markdown lines. */
export function helpLines(help: HelpContentLike | undefined): string[] {
  if (!help) return [];
  const blocks = typeof help === "string" ? [help] : help;
  return blocks.flatMap((b) => (typeof b === "string" ? [b] : b.bullets.map((li) => `- ${li}`)));
}
