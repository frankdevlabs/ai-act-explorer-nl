/**
 * Parser for an amending act as published in the OJ (EUR-Lex "L-serie" HTML,
 * e.g. CELEX 32026R1744). Reads the act's own metadata (number, adoption and
 * publication date, entry into force from its final article) and Article 1's
 * amending instructions: one oj-table row per numbered instruction ("1)"),
 * composite instructions ("artikel 2 wordt als volgt gewijzigd:") holding
 * lettered sub-instruction rows, leaf instructions followed by the quoted new
 * text. Nothing here is transcribed: every string is read from the HTML.
 */
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { cleanText } from "./consolidated";

export interface OjInstruction {
  seq: number;
  sub?: string;
  /** Verbatim intro of this (sub-)instruction: "lid 2 wordt vervangen door:". */
  intro: string;
  /** Verbatim intro of the parent instruction of a sub-instruction. */
  parentIntro?: string;
  /** Quoted new text blocks (one per p/div/table after the intro), plain text. */
  quoted: string[];
}

export interface OjAct {
  celex: string;
  /** "Verordening (EU) 2026/1744" */
  document: string;
  /** Title after the number line, verbatim ("tot wijziging van … (Digitale omnibus inzake AI)"). */
  title: string;
  eli: string;
  /** "PB L, 2026/1744, 24.7.2026" */
  ojRef: string;
  adopted: string;
  published: string;
  inForce: string;
  /** Days after publication per the final article ("derde dag" → 3). */
  inForceDays: number;
  /** Leaf instructions in document order. */
  instructions: OjInstruction[];
  /** Numbered top-level instructions in Article 1. */
  topLevelCount: number;
}

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];
const ORDINAL_DAYS: Record<string, number> = { derde: 3, twintigste: 20, eerste: 1, tiende: 10 };

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "8 juli 2026" → "2026-07-08" */
function dutchDate(text: string): string {
  const m = text.match(/(\d{1,2}) (januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december) (\d{4})/);
  if (!m) throw new Error(`oj-instructions: no Dutch date in "${text}"`);
  return iso(Number(m[3]), MONTHS.indexOf(m[2]) + 1, Number(m[1]));
}

/** "24.7.2026" → "2026-07-24" */
function dottedDate(text: string): string {
  const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) throw new Error(`oj-instructions: no d.m.yyyy date in "${text}"`);
  return iso(Number(m[3]), Number(m[2]), Number(m[1]));
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** An instruction sentence: "… wordt/worden … vervangen/ingevoegd/toegevoegd/geschrapt/gewijzigd" + ":" or ";". */
const INSTRUCTION = /\b(wordt|worden)\b.*\b(vervangen|ingevoegd|toegevoegd|geschrapt|gewijzigd)\b[^.]*[:;]$/i;

export function parseAmendingAct(html: string, celex: string): OjAct {
  const $ = cheerio.load(html);

  const docTitles = $("p.oj-doc-ti").map((_, p) => cleanText($(p).text())).get();
  const num = docTitles[0]?.match(/^VERORDENING \(EU\) (\d{4})\/(\d+) /);
  if (!num) throw new Error(`oj-instructions: unexpected document title "${docTitles[0]}"`);
  const [year, number] = [num[1], num[2]];
  if (celex !== `3${year}R${number.padStart(4, "0")}`)
    throw new Error(`oj-instructions: CELEX ${celex} does not match Verordening (EU) ${year}/${number}`);
  if (cleanText($(".oj-hd-uniq").first().text()) !== `${year}/${number}`)
    throw new Error("oj-instructions: OJ header number does not match the title");
  const adopted = dutchDate(docTitles[1] ?? "");
  const publishedDotted = cleanText($(".oj-hd-date").first().text());
  const published = dottedDate(publishedDotted);
  const title = docTitles[2] ?? "";

  // entry into force: final article "treedt in werking op de <n>de dag na die van de bekendmaking"
  const articles = $("div.eli-subdivision[id^='art_']").filter((_, d) => !$(d).attr("id")!.includes("."));
  const finalText = cleanText($(articles.last()).text());
  const inForceMatch = finalText.match(/treedt in werking op de (\w+) dag na die van de bekendmaking/);
  if (!inForceMatch || !(inForceMatch[1] in ORDINAL_DAYS))
    throw new Error(`oj-instructions: entry-into-force clause not recognized: ${finalText.slice(0, 160)}`);
  const inForceDays = ORDINAL_DAYS[inForceMatch[1]];

  // ----------------------------------------------- Article 1 instruction tree
  const art1 = $("#art_1");
  if (!/Wijzigingen in Verordening \(EU\) 2024\/1689/.test(cleanText(art1.children(".eli-title").text())))
    throw new Error("oj-instructions: Article 1 is not the AI Act amendment article");

  const rowCells = (table: Element) => $(table).find("> tbody > tr > td, > tr > td").toArray();
  const markerOf = (table: Element) => cleanText($(rowCells(table)[0]).text());

  /** Plain text of a quoted block, footnote tags removed (the consolidated
   *  version renumbers the amending act's footnotes). */
  const quotedText = (el: Element) => {
    // the act's own footnote texts (p.oj-note) are not part of the new text
    if ($(el).hasClass("oj-note")) return "";
    const c = $(el).clone();
    c.find(".oj-note-tag, .oj-super").remove();
    return cleanText(c.text().replace(/\(\s*\)/g, "")); // "( )" left by a removed footnote tag
  };

  const instructions: OjInstruction[] = [];
  const top = art1.children("table").toArray();
  let expected = 1;
  for (const table of top) {
    const marker = markerOf(table);
    const m = marker.match(/^(\d+)\)$/);
    if (!m || Number(m[1]) !== expected)
      throw new Error(`oj-instructions: expected instruction ${expected}), found "${marker}"`);
    expected += 1;
    const seq = Number(m[1]);
    const body = rowCells(table)[1];
    const children = $(body).children().toArray();
    const intro = cleanText($(children[0]).text());
    if (children[0]?.tagName !== "p" || !INSTRUCTION.test(intro))
      throw new Error(`oj-instructions: instruction ${seq}) has no instruction sentence: "${intro}"`);
    const subTables = children.filter(
      (c) => c.tagName === "table" && /^[a-z]\)$/.test(markerOf(c as Element)),
    ) as Element[];
    // composite: lettered rows that are themselves instructions (quoted point
    // rows inside a leaf start with “ or carry no instruction sentence)
    const isComposite =
      subTables.length > 0 &&
      subTables.every((t) => INSTRUCTION.test(cleanText($(rowCells(t)[1]).children("p").first().text())));
    if (isComposite) {
      let letter = "a".charCodeAt(0);
      for (const t of subTables) {
        const sub = markerOf(t).slice(0, -1);
        if (sub !== String.fromCharCode(letter++))
          throw new Error(`oj-instructions: instruction ${seq}) sub-instructions out of order at ${sub})`);
        const subBody = rowCells(t)[1];
        const subChildren = $(subBody).children().toArray();
        instructions.push({
          seq,
          sub,
          intro: cleanText($(subChildren[0]).text()),
          parentIntro: intro,
          quoted: subChildren.slice(1).map((c) => quotedText(c as Element)).filter(Boolean),
        });
      }
      const stray = children.slice(1).filter((c) => !subTables.includes(c as Element));
      if (stray.some((c) => cleanText($(c).text()) !== ""))
        throw new Error(`oj-instructions: instruction ${seq}) mixes sub-instructions and text`);
    } else {
      instructions.push({
        seq,
        intro,
        quoted: children.slice(1).map((c) => quotedText(c as Element)).filter(Boolean),
      });
    }
  }

  return {
    celex,
    document: `Verordening (EU) ${year}/${number}`,
    title,
    eli: `http://data.europa.eu/eli/reg/${year}/${number}/oj`,
    ojRef: `PB L, ${year}/${number}, ${publishedDotted}`,
    adopted,
    published,
    inForce: addDays(published, inForceDays),
    inForceDays,
    instructions,
    topLevelCount: top.length,
  };
}
