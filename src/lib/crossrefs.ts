/**
 * Detect internal cross-references ("artikel 6, lid 2, punt c)", "bijlage III,
 * punt 2", "hoofdstuk V") in a plain-text string and return them as char-offset
 * RefSpans. Pure text analysis: hrefs are *candidates* — the parser post-pass
 * validates page targets against the parsed corpus and strips fragments whose
 * anchor does not exist (or is not unique) on the target page.
 *
 * Span granularity: a single-target reference gets one span over the whole
 * phrase ("artikel 98, lid 2"). Enumerations and ranges emit one span per
 * number token, the first extended left to include the keyword ("artikelen 53"
 * → /artikel/53, "55" → /artikel/55). Range interiors ("91 tot en met 94")
 * only link the endpoints — the other numbers do not occur in the text.
 *
 * Exclusions (checked before emitting): trailing VWEU/VEU ("artikel 16 VWEU",
 * "artikel 4, lid 2, VEU") and "van/bij <other instrument>" ("van Verordening
 * (EU) 2016/679", "van die verordening", "van het Handvest"). Self-forms stay
 * linkable: "van deze verordening", "van de onderhavige verordening", "van
 * Verordening (EU) 2024/1689". With linkBareRefs=false (amendment articles
 * 102–110, which quote text of other acts) only the explicit self-forms link.
 */
import type { RefSpan } from "./types";

export interface RefContext {
  selfType: "artikel" | "overweging" | "bijlage";
  selfRef: string;
  /** When false, only refs followed by an explicit self-instrument form link. */
  linkBareRefs?: boolean;
}

const ROMAN = /[IVX]+(?![A-Za-z])/y;
const KEYWORD = /\b([Aa]rtikel(?:en)?|[Bb]ijlagen?|[Hh]oofdstuk(?:ken)?|[Oo]verweging(?:en)?)[  ]/g;

// "van deze verordening" / "van Verordening (EU) 2024/1689" → explicitly this act
const SELF_INSTRUMENT =
  /,?[  ]*(?:van|bij)[  ]+(?:(?:de[  ]+)?onderhavige[  ]+verordening|deze[  ]+verordening|Verordening[  ]+\(EU\)[  ]+2024\/1689)/y;
// "van/bij <some other instrument>" → reference into another act, skip
const OTHER_INSTRUMENT =
  /,?[  ]*(?:van|bij)[  ]+(?:(?:de|het|die|dat|een)[  ]+)?(?:[A-ZÉ][\w-]*[  ]+)?[\w-]*(?:[Vv]erordening(?:en)?|[Rr]ichtlijn(?:en)?|[Bb]esluit(?:en)?|[Aa]anbeveling(?:en)?|[Vv]erdrag(?:en)?|[Hh]andvest|[Oo]vereenkomst(?:en)?|[Aa]kkoord|[Pp]rotocol)\b/y;
const TREATY = /,?[  ]*VW?EU\b/y;

const ORDINAL =
  /(?:eerste|tweede|derde|vierde|vijfde|zesde|zevende|achtste|negende|tiende|laatste)/;

const ARTIKEL_NUM = /\d+(?![\d/])(?!\.\d)(?:[  ]+(?:bis|ter|quater|quinquies)\b)?/y;
const PLAIN_NUM = /\d+(?![\d/])(?!\.\d)/y;
// ", en artikel …" / " of de artikelen …" — a conjunction chaining to another
// reference phrase, whose trailing instrument qualifier distributes back
const CONJ = /,?[  ]*(?:en|of)[  ]+(?:onverminderd[  ]+)?(?:de[  ]+|het[  ]+)?/y;

function slug(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Sticky-regex cursor over the input text. */
class Cursor {
  constructor(
    public readonly s: string,
    public i: number,
  ) {}
  /** Try `re` (must be sticky) at the current position; advance on match. */
  eat(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i = re.lastIndex;
    return m;
  }
}

interface NumToken {
  start: number;
  end: number;
  value: string;
}

/**
 * Parse "N", "N, N en/of N" or "N tot en met M" (or roman equivalents).
 * Returns one token per number that occurs in the text.
 */
function eatNumberList(c: Cursor, numRe: RegExp): NumToken[] {
  const tokens: NumToken[] = [];
  const first = c.eat(numRe);
  if (!first) return tokens;
  tokens.push({ start: first.index, end: c.i, value: first[0] });
  // range: only the endpoints exist as text
  const range = c.eat(/[  ]+tot[  ]+en[  ]+met[  ]+/y);
  if (range) {
    const last = c.eat(numRe);
    if (last) {
      tokens.push({ start: last.index, end: c.i, value: last[0] });
    } else {
      c.i = range.index; // "tot en met" not followed by a number: back off
    }
    return tokens;
  }
  // enumeration: ", N" repeated, closed by "en/of N"
  for (;;) {
    const save = c.i;
    if (!c.eat(/,[  ]*/y)) break;
    const n = c.eat(numRe);
    if (!n) {
      c.i = save;
      break;
    }
    tokens.push({ start: n.index, end: c.i, value: n[0] });
  }
  const save = c.i;
  if (c.eat(/,?[  ]+(?:en|of)[  ]+/y)) {
    const n = c.eat(numRe);
    if (n) tokens.push({ start: n.index, end: c.i, value: n[0] });
    else c.i = save;
  }
  return tokens;
}

interface SubRefs {
  /** lid numbers, in text order */
  lids: NumToken[];
  /** punt tokens ("c)", "12"), in text order; anchored under the single lid if any */
  punten: NumToken[];
  /** end of the last consumed sub-ref component */
  end: number;
}

/** Parse the ", lid N / leden … / punt x) / punten … / eerste alinea" tail. */
function eatSubRefs(c: Cursor): SubRefs {
  const out: SubRefs = { lids: [], punten: [], end: c.i };
  const PUNT_TOKEN = /(?:[a-z]{1,2}\)|\d+(?:\.\d+)*\)?)/y;
  for (;;) {
    const save = c.i;
    if (c.eat(/,[  ]*(?:en[  ]+)?lid[  ]+/y)) {
      const n = c.eat(/\d+/y);
      if (!n) {
        c.i = save;
        break;
      }
      out.lids.push({ start: n.index, end: c.i, value: n[0] });
    } else if (c.eat(/,[  ]*(?:en[  ]+)?leden[  ]+/y)) {
      const ns = eatNumberList(c, /\d+/y);
      if (ns.length === 0) {
        c.i = save;
        break;
      }
      out.lids.push(...ns);
    } else if (c.eat(/,[  ]*(?:en[  ]+)?punt[  ]+/y)) {
      const t = c.eat(PUNT_TOKEN);
      if (!t) {
        c.i = save;
        break;
      }
      out.punten.push({ start: t.index, end: c.i, value: t[0] });
    } else if (c.eat(/,[  ]*(?:en[  ]+)?punten[  ]+/y)) {
      const ts = eatNumberList(c, PUNT_TOKEN);
      if (ts.length === 0) {
        c.i = save;
        break;
      }
      out.punten.push(...ts);
    } else if (c.eat(new RegExp(`,[  ]*${ORDINAL.source}[  ]+alinea`, "y"))) {
      // alinea has no anchor; consumed so the exclusion lookahead runs after it
    } else if (c.eat(/,[  ]*(?:en[  ]+)?[a-z]{1,2}\)(?:[  ]+en[  ]+[a-z]{1,2}\))*/y)) {
      // nested sub-points after a numeric punt ("punt 2, d) en e)") — no anchor
    } else if (c.eat(/,[  ]*[ivx]+\)/y)) {
      // roman sub-sub-point ("punt h), iii)") — no anchor
    } else {
      break;
    }
    out.end = c.i;
  }
  return out;
}

/** Excluded / allowed lookahead at the end of a parsed phrase.
 *
 * An instrument qualifier after the last conjunct distributes over the whole
 * conjunction ("artikel 6, lid 4, en artikel 9, lid 2, punt g), van
 * Verordening (EU) 2016/679" excludes artikel 6 too), so a bare-looking
 * phrase followed by ", en <reference phrase>" defers to whatever qualifies
 * that next phrase. */
function allowedHere(c: Cursor, linkBareRefs: boolean, depth = 0): boolean {
  const at = (re: RegExp) => {
    re.lastIndex = c.i;
    return re.test(c.s);
  };
  if (at(SELF_INSTRUMENT)) return true;
  if (at(TREATY)) return false;
  if (at(OTHER_INSTRUMENT)) return false;
  if (depth < 4) {
    const look = new Cursor(c.s, c.i);
    if (look.eat(CONJ)) {
      const kw = look.eat(/(artikel(?:en)?|bijlagen?|hoofdstuk(?:ken)?|overweging(?:en)?)[  ]+/y);
      if (kw) {
        const kind = kw[1];
        let parsed = false;
        if (kind.startsWith("artikel")) {
          const ns = eatNumberList(look, ARTIKEL_NUM);
          if (ns.length > 0) {
            if (ns.length === 1) eatSubRefs(look);
            parsed = true;
          }
        } else if (kind.startsWith("bijlage") || kind.startsWith("hoofdstuk")) {
          const ns = eatNumberList(look, ROMAN);
          if (ns.length > 0) {
            if (kind.startsWith("bijlage") && ns.length === 1) eatSubRefs(look);
            parsed = true;
          }
        } else {
          parsed = eatNumberList(look, PLAIN_NUM).length > 0;
        }
        if (parsed) return allowedHere(look, linkBareRefs, depth + 1);
      }
    }
  }
  return linkBareRefs;
}

export function findRefs(text: string, ctx: RefContext): RefSpan[] {
  const linkBareRefs = ctx.linkBareRefs !== false;
  const spans: RefSpan[] = [];
  KEYWORD.lastIndex = 0;
  let kw: RegExpExecArray | null;
  while ((kw = KEYWORD.exec(text)) !== null) {
    const keyword = kw[1].toLowerCase();
    const c = new Cursor(text, kw.index + kw[1].length);
    if (!c.eat(/[  ]+/y)) continue;

    let produced: RefSpan[] | null = null;
    if (keyword === "artikel" || keyword === "artikelen") {
      produced = parseArtikel(c, kw.index, linkBareRefs);
    } else if (keyword === "bijlage" || keyword === "bijlagen") {
      produced = parseBijlage(c, kw.index, linkBareRefs);
    } else if (keyword === "hoofdstuk" || keyword === "hoofdstukken") {
      produced = parseHoofdstuk(c, kw.index, linkBareRefs);
    } else if (keyword === "overweging" || keyword === "overwegingen") {
      produced = parseOverweging(c, kw.index, linkBareRefs);
    }
    if (!produced) continue;

    // drop links that resolve to the current page without a deep-link fragment
    const selfHref =
      ctx.selfType === "artikel"
        ? `/artikel/${ctx.selfRef}`
        : ctx.selfType === "bijlage"
          ? `/bijlage/${ctx.selfRef.toLowerCase()}`
          : `/overweging/${ctx.selfRef}`;
    spans.push(...produced.filter((s) => s.href !== selfHref));
    KEYWORD.lastIndex = c.i;
  }
  return spans;
}

// "75 ter" → "75ter", matching NewArticleSpec.slug (omnibus-inserted articles)
function artikelSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseArtikel(c: Cursor, phraseStart: number, linkBareRefs: boolean): RefSpan[] | null {
  // optional Latin suffix: "artikel 75 ter" is its own article, not artikel 75
  const numbers = eatNumberList(c, ARTIKEL_NUM);
  if (numbers.length === 0) return null;
  const sub = numbers.length === 1 ? eatSubRefs(c) : { lids: [], punten: [], end: c.i };
  if (!allowedHere(c, linkBareRefs)) return null;

  if (numbers.length > 1) {
    // enumeration/range: one span per number token, first includes the keyword
    return numbers.map((n, i) => ({
      start: i === 0 ? phraseStart : n.start,
      end: n.end,
      href: `/artikel/${artikelSlug(n.value)}`,
    }));
  }

  const page = `/artikel/${artikelSlug(numbers[0].value)}`;
  const { lids, punten } = sub;
  if (lids.length === 0 && punten.length === 0) {
    return [{ start: phraseStart, end: numbers[0].end, href: page }];
  }
  if (lids.length === 1 && punten.length > 0) {
    // "artikel 60, lid 4, punten f) en g)" → lid-4-f, lid-4-g
    return punten.map((p, i) => ({
      start: i === 0 ? phraseStart : p.start,
      end: p.end,
      href: `${page}#lid-${lids[0].value}-${slug(p.value)}`,
    }));
  }
  if (lids.length > 0) {
    // one or more leden (punten after multiple leden stay unanchored)
    return lids.map((l, i) => ({
      start: i === 0 ? phraseStart : l.start,
      end: i === lids.length - 1 && punten.length === 0 ? sub.end : l.end,
      href: `${page}#lid-${l.value}`,
    }));
  }
  // punten directly on the article (flat articles use punt-N anchors)
  return punten.map((p, i) => ({
    start: i === 0 ? phraseStart : p.start,
    end: p.end,
    href: `${page}#punt-${slug(p.value)}`,
  }));
}

function parseBijlage(c: Cursor, phraseStart: number, linkBareRefs: boolean): RefSpan[] | null {
  const romans = eatNumberList(c, ROMAN);
  if (romans.length === 0) return null;
  let punten: NumToken[] = [];
  let end = c.i;
  if (romans.length === 1) {
    c.eat(/,[  ]*afdeling[  ]+[A-Z]\b/y); // annex section labels have no anchors
    const sub = eatSubRefs(c);
    punten = sub.punten;
    end = sub.end;
  }
  if (!allowedHere(c, linkBareRefs)) return null;

  if (romans.length > 1 || punten.length === 0) {
    return romans.map((r, i) => ({
      start: i === 0 ? phraseStart : r.start,
      end: i === 0 && romans.length === 1 ? end : r.end,
      href: `/bijlage/${r.value.toLowerCase()}`,
    }));
  }
  const page = `/bijlage/${romans[0].value.toLowerCase()}`;
  return punten.map((p, i) => ({
    start: i === 0 ? phraseStart : p.start,
    end: p.end,
    href: `${page}#punt-${slug(p.value)}`,
  }));
}

function parseHoofdstuk(c: Cursor, phraseStart: number, linkBareRefs: boolean): RefSpan[] | null {
  const romans = eatNumberList(c, ROMAN);
  if (romans.length === 0) return null;
  // chapter afdelingen have no homepage anchors; consume for the lookahead
  const afd = c.eat(/,[  ]*afdeling(?:en)?[  ]+\d+(?:[  ]+en[  ]+\d+)?/y);
  if (!allowedHere(c, linkBareRefs)) return null;
  const end = romans.length === 1 && afd ? c.i : undefined;
  return romans.map((r, i) => ({
    start: i === 0 ? phraseStart : r.start,
    end: i === 0 && end !== undefined ? end : r.end,
    href: `/#hoofdstuk-${r.value.toLowerCase()}`,
  }));
}

function parseOverweging(c: Cursor, phraseStart: number, linkBareRefs: boolean): RefSpan[] | null {
  const numbers = eatNumberList(c, PLAIN_NUM);
  if (numbers.length === 0) return null;
  if (!allowedHere(c, linkBareRefs)) return null;
  return numbers.map((n, i) => ({
    start: i === 0 ? phraseStart : n.start,
    end: n.end,
    href: `/overweging/${n.value}`,
  }));
}
