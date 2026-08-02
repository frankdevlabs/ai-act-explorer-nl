/**
 * Gate on the AI-register exports (card #176). Runs after verify-assessment.ts
 * in `npm run verify`.
 *
 * Three things it holds:
 * - every deep link the Markdown dossier emits is absolute and resolves
 *   against data/generated/ — same checker as the questionnaire's own refs
 *   (scripts/lib/corpus-index.ts), so one href grammar governs both;
 * - the CSV column set is stable and survives free text containing commas,
 *   semicolons, quotes and newlines (spreadsheet round-trip);
 * - a system with no answers exports without throwing and claims nothing.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, registerHeaderRow } from "../src/lib/assessment/engine";
import type { Questionnaire, StoredSystem } from "../src/lib/assessment/types";
import {
  decisiveAnswers,
  includesFinance,
  registerDossierFilename,
  registerDossierMarkdown,
  registerDossierSlug,
  registerFlatCsv,
  type RegisterEntry,
} from "../src/lib/register/export";
import { SITE_ORIGIN } from "../src/lib/site";
import { loadCorpus, makeCheckRef } from "./lib/corpus-index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const questionnaire: Questionnaire = JSON.parse(
  readFileSync(join(root, "data/questionnaire/assessment-v1.json"), "utf-8"),
);
const checkRef = makeCheckRef(loadCorpus(root));

/** Frozen export timestamp: the dossier must be byte-stable for fixtures. */
const NOW = Date.parse("2026-08-02T10:00:00Z");

// ------------------------------------------------- fixtures

/** VB-001 — kredietscoringsmodule, deployer, financiële entiteit, hoog risico. */
const vb001: Record<string, string> = {
  "1.1": "Kredietscoringsmodule leningaanvragen",
  "1.12": "ja",
  "2.1": "ja",
  "2.2": "ja",
  "2.3": "ja",
  "2.4": "ja",
  "3.1": "nee",
  "3.2": "nee",
  "4.1": "nee",
  "4.2": "ja",
  "4.3": "nee",
  "4.4": "nee",
  "4.5": "nee",
  "4.6": "nee",
  "4.7": "nee",
  "4.8": "nee",
  "5.1": "nee",
  "5.2": "nee",
  "5.3": "nee",
  "5.4": "nee",
  "5.5": "nee",
  "5.6": "nee",
  "5.7": "nee",
  "5.8": "nee",
  "5.9": "nee",
  "5.10": "nee",
  "6.1": "nee",
  "7.1": "nee",
  "7.2": "nee",
  "7.3": "nee",
  "7.4": "nee",
  "7.5a": "nee",
  "7.5b": "ja",
  "7.5c": "nee",
  "7.5d": "nee",
  "7.6": "nee",
  "7.7": "nee",
  "7.8": "nee",
  "8.1": "ja",
  "9.1": "ja",
  "9.2": "ja",
  "9.3": "ja",
  "9.4": "ja",
  "9.5": "ja",
  "9.6": "ja",
  "9.7": "ja",
  "9.8": "ja",
  "9.9": "ja",
  "9.10": "ja",
  "9.11": "ja",
  "9.12": "nvt",
  "10.1": "nee",
  "10.2": "ja",
  "10.3": "ja",
  "10.6": "ja",
  "10.7": "ja",
  "10.8": "ja",
  "10.9": "ja",
  "10.10": "ja",
  "10.11": "ja",
  "10.4": "nee",
  "10.5": "ja",
  "10.12": "ja",
  "13.1": "nee",
  "13.2": "nee",
  "13.3": "nee",
  "13.4": "nee",
  "14.1": "ja",
  "14.2": "ja",
  "14.3": "ja",
  "15.1": "ja",
  "15.2": "ja",
  "15.3": "ja",
  "15.4": "ja",
  "15.5": "ja",
  "15.6": "ja",
  "15.7": "nee",
  "15.8": "ja",
  "16.1": "ja",
  "16.2": "ja",
  "16.3": "ja",
  "16.4": "ja",
  "17.1": "ja",
  "17.2": "ja",
  "17.3": "ja",
  "17.4": "ja",
  "18.1": "hoog",
  "18.2": "go-voorwaarden",
  "18.3": "Kwartaalmonitoring bias",
  "18.4": "09-2026 / 09-2027",
  "18.5": "Dossier #123",
};

/**
 * Free text with every separator the CSV and the Markdown table care about:
 * a newline, a comma, a semicolon, a quote and a pipe.
 */
const vrijetekst: Record<string, string> = {
  "1.1": 'Chatbot "Klantvraag", pilot',
  "1.2": "regel1\nregel2, met komma; en punt-komma",
  "1.12": "nee",
  "2.1": "ja",
  "2.2": "ja",
  "2.3": "ja",
  "2.4": "ja",
  "18.5": 'zie \\share|dossier "AI"',
};

/** Art. 5 hit: the STOP block must lead the dossier. */
const stopAnswers: Record<string, string> = { "2.4": "ja", "5.1": "ja" };

function system(id: string, name: string, answers: Record<string, string>): StoredSystem {
  return {
    id,
    name,
    answers,
    createdAt: Date.parse("2026-06-01T09:00:00Z"),
    updatedAt: Date.parse("2026-07-15T14:30:00Z"),
  };
}

function entry(s: StoredSystem): RegisterEntry {
  return { system: s, evaluation: evaluate(questionnaire, s.answers) };
}

const sysVb001 = system("11111111-2222-3333-4444-555555555555", "Kredietscoringsmodule leningaanvragen", vb001);
const sysLeeg = system("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "Nieuwe toepassing", {});
const sysVrij = system("99999999-8888-7777-6666-555555555555", 'Chatbot "Klantvraag", pilot', vrijetekst);
const sysStop = system("00000000-1111-2222-3333-444444444444", "Emotieherkenning werkvloer", stopAnswers);

const entries = [entry(sysVb001), entry(sysLeeg), entry(sysVrij), entry(sysStop)];
const [eVb001, eLeeg, eVrij, eStop] = entries;

// ------------------------------------------------- CSV

// History: 33 columns since the 2026-07 register expansion. The export is the
// lawyer's hand-off artefact — a silently added or dropped column changes the
// document. Re-pin only after auditing data/questionnaire/assessment-v1.json.
assert.equal(questionnaire.registerColumns.length, 33, "33 registerkolommen");

{
  const csv = registerFlatCsv(questionnaire, entries);
  const lines = csv.split("\r\n");
  assert.equal(
    lines.length,
    entries.length + 1,
    "csv: kopregel + één regel per systeem (geen lekkende newline)",
  );

  // A CSV parser good enough for the fixture: quoted fields may contain
  // separators and doubled quotes. Round-trip = what a spreadsheet reader does.
  const parseRow = (line: string): string[] => {
    const out: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        out.push(field);
        field = "";
      } else field += c;
    }
    assert.ok(!quoted, "csv: aanhalingsteken niet gesloten");
    out.push(field);
    return out;
  };

  // financeOnly union: one financial entity in the set widens every row.
  assert.ok(entries.some((e) => includesFinance(e.system)), "fixture: één financiële entiteit");
  const header = registerHeaderRow(questionnaire, true);
  assert.deepEqual(parseRow(lines[0]), header, "csv: kopregel = alle kolomlabels");
  assert.equal(header.length, 33, "csv: 33 kolommen bij financiële entiteit");
  assert.equal(
    registerHeaderRow(questionnaire, false).length,
    32,
    "csv: 32 kolommen zonder sectorkolom",
  );
  for (let i = 1; i < lines.length; i++) {
    assert.equal(
      parseRow(lines[i]).length,
      questionnaire.registerColumns.length,
      `csv: rij ${i} dekt alle kolommen`,
    );
  }

  // The free-text row: separators survive inside one cell, the newline does not
  // leak into a second row.
  const naamIdx = questionnaire.registerColumns.findIndex((c) => c.id === "naam");
  const beschrijvingIdx = questionnaire.registerColumns.findIndex((c) => c.id === "beschrijving");
  const vrijRow = lines
    .slice(1)
    .map(parseRow)
    .find((r) => r[naamIdx] === 'Chatbot "Klantvraag", pilot');
  assert.ok(vrijRow, "csv: vrijetekstrij teruggevonden na round-trip");
  assert.equal(
    vrijRow![beschrijvingIdx],
    "regel1 regel2, met komma; en punt-komma",
    "csv: komma/punt-komma intact, newline genormaliseerd naar spatie",
  );
  assert.ok(!csv.includes("regel1\nregel2"), "csv: geen rauwe newline in een veld");
  assert.ok(csv.includes('""Klantvraag""'), "csv: aanhalingstekens verdubbeld");

  // No answers at all still yields a full-width row (32: no finance entity in
  // this one-system export) that claims no classification.
  const leegRow = parseRow(registerFlatCsv(questionnaire, [eLeeg]).split("\r\n")[1]);
  assert.equal(leegRow.length, 32, "csv: leeg systeem levert een volledige rij");
  const kolomIdx = (id: string) => questionnaire.registerColumns.findIndex((c) => c.id === id);
  assert.equal(leegRow[kolomIdx("risicoklasse")], "", "csv: leeg systeem claimt geen risicoklasse");
  assert.equal(leegRow[kolomIdx("kwalificatie")], "", "csv: leeg systeem claimt geen kwalificatie");
  assert.equal(leegRow[kolomIdx("naam")], "", "csv: leeg systeem heeft geen naamantwoord");

  // No systems: header only, still parseable.
  const leegCsv = registerFlatCsv(questionnaire, []);
  assert.equal(leegCsv.split("\r\n").length, 1, "csv: leeg register = alleen de kopregel");
  assert.deepEqual(
    parseRow(leegCsv),
    registerHeaderRow(questionnaire, false),
    "csv: leeg register laat de sectorkolommen weg",
  );
}

// ------------------------------------------------- Markdown: deep links

/**
 * The nine obligation questions that carry no `refs` — and whose modules carry
 * none either, so no fallback exists. They are the AVG (m15), DORA (m16) and
 * "overige raakvlakken" (m17) touchpoints: deliberately not AI Act provisions,
 * so there is nothing in this corpus to link to. Every *other* obligation must
 * emit at least one resolving deep link. Shrink this set, never grow it
 * without an editorial decision recorded in the questionnaire.
 */
const OBLIGATIONS_ZONDER_REFS = new Set([
  "15.2",
  "15.4",
  "15.5",
  "15.6",
  "15.8",
  "16.2",
  "17.2",
  "17.3",
  "17.4",
]);

{
  const withoutRefs = questionnaire.modules
    .flatMap((m) => m.questions)
    .filter((q) => q.obligation && !(q.refs ?? []).length)
    .map((q) => q.id);
  assert.deepEqual(
    withoutRefs.sort(),
    [...OBLIGATIONS_ZONDER_REFS].sort(),
    "verplichtingen zonder wettelijke basis zijn exact de gepinde uitzonderingen",
  );
}

for (const e of entries) {
  const md = registerDossierMarkdown(questionnaire, e, NOW);
  const owner = `dossier ${e.system.name}`;

  // Every link in the document is absolute and resolves in the corpus.
  const urls = [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  for (const u of urls) {
    assert.ok(u.startsWith(SITE_ORIGIN), `${owner}: relatieve link ${u}`);
    const rest = u.slice(SITE_ORIGIN.length);
    if (rest === "/register") continue; // the app's own register page
    checkRef(owner, rest);
  }

  // Every listed obligation outside the pinned exception set carries a link.
  for (const o of e.evaluation.obligations) {
    if (OBLIGATIONS_ZONDER_REFS.has(o.questionId)) continue;
    const refs = o.refs ?? [];
    assert.ok(refs.length > 0, `${owner}: verplichting ${o.questionId} zonder wettelijke basis`);
    for (const ref of refs) {
      assert.ok(
        md.includes(`](${SITE_ORIGIN}${ref.href})`),
        `${owner}: verplichting ${o.questionId} mist deeplink ${ref.href}`,
      );
    }
  }

  // Markdown tables: no row may be split by a raw newline or an unescaped pipe.
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split(/(?<!\\)\|/).length - 1;
    assert.ok(cells >= 2, `${owner}: tabelregel met te weinig kolommen: ${line}`);
  }

  // Determinism: same input, same bytes.
  assert.equal(
    md,
    registerDossierMarkdown(questionnaire, e, NOW),
    `${owner}: export is deterministisch`,
  );
}

// ------------------------------------------------- Markdown: content

{
  const md = registerDossierMarkdown(questionnaire, eVb001, NOW);
  assert.ok(md.startsWith("# AI-registerdossier — Kredietscoringsmodule"), "vb001: titel");
  assert.ok(md.includes("| Risicoklasse | Hoog risico |"), "vb001: risicoklasse in classificatie");
  assert.ok(
    md.includes("| Rol(len) | Gebruiksverantwoordelijke (deployer) |"),
    "vb001: rol in classificatie",
  );
  assert.ok(md.includes("| FRIA (art. 27) | Vereist — uitgevoerd |"), "vb001: FRIA-status");
  assert.ok(md.includes("- [ ] **10.4**"), "vb001: open actie als checkbox");
  assert.ok(md.includes("2027-12-02"), "vb001: omnibus-datum in de tijdlijn");
  assert.ok(md.includes("_(omnibus)_"), "vb001: omnibus-markering");
  assert.ok(md.includes("## Bepalende antwoorden"), "vb001: audittrail aanwezig");
  assert.ok(md.includes("| **7.5b**"), "vb001: bepalend antwoord bijlage III 5(b)");
  assert.ok(md.includes("## Registerrij"), "vb001: registerrij");
  const financeCol = questionnaire.registerColumns.find((c) => c.financeOnly)!;
  assert.ok(
    md.includes(`| ${financeCol.label} |`),
    "vb001: sectorkolom in de registerrij bij een financiële entiteit",
  );
  assert.ok(
    !registerDossierMarkdown(questionnaire, eVrij, NOW).includes(`| ${financeCol.label} |`),
    "niet-financieel: sectorkolom weggelaten uit de registerrij",
  );
  assert.ok(md.includes(questionnaire.meta.disclaimer), "vb001: disclaimer in de voettekst");

  // Every obligation the evaluation lists shows up with its id and its module.
  const modulesShown = new Set(
    [...md.matchAll(/^### Module (\d+) — /gm)].map((m) => Number(m[1])),
  );
  for (const o of eVb001.evaluation.obligations) {
    assert.ok(md.includes(`| **${o.questionId}** `), `vb001: verplichting ${o.questionId} in tabel`);
    const mod = questionnaire.modules.find((m) => m.id === o.moduleId)!;
    assert.ok(modulesShown.has(mod.nr), `vb001: modulekop ${mod.nr} aanwezig`);
  }
}

{
  // Empty system: exports, claims nothing, and is honest about it.
  const md = registerDossierMarkdown(questionnaire, eLeeg, NOW);
  assert.ok(md.includes("| Risicoklasse | Nog niet bepaald |"), "leeg: geen risicoklasse geclaimd");
  assert.ok(md.includes("| Kwalificatie | Nog niet bepaald |"), "leeg: geen kwalificatie geclaimd");
  assert.ok(md.includes("_Geen openstaande acties._"), "leeg: geen acties");
  assert.ok(
    md.includes("_Nog geen antwoorden die de classificatie bepalen._"),
    "leeg: lege audittrail",
  );
  assert.ok(!md.includes("STOP"), "leeg: geen STOP-blok");
  assert.equal(decisiveAnswers(questionnaire, sysLeeg).length, 0, "leeg: geen bepalende antwoorden");
  assert.equal(eLeeg.evaluation.registerRow.risicoklasse, "", "leeg: engine blankt de risicoklasse");
}

{
  // Free text: separators cannot break a table row.
  const md = registerDossierMarkdown(questionnaire, eVrij, NOW);
  assert.ok(
    md.includes("regel1 regel2, met komma; en punt-komma"),
    "vrijetekst: newline genormaliseerd in de markdown-tabel",
  );
  assert.ok(!md.includes("regel1\nregel2"), "vrijetekst: geen rauwe newline in een tabelcel");
  assert.ok(md.includes("\\|dossier"), "vrijetekst: pipe geëscaped");
}

{
  // Art. 5 hit: the STOP block leads, before the classification.
  const md = registerDossierMarkdown(questionnaire, eStop, NOW);
  const stopAt = md.indexOf("> **STOP");
  assert.ok(stopAt > 0, "stop: STOP-blok aanwezig");
  assert.ok(stopAt < md.indexOf("## Classificatie"), "stop: STOP-blok vóór de classificatie");
  assert.ok(md.includes("vraag 5.1"), "stop: verwijst naar de gesignaleerde vraag");
  assert.equal(eStop.evaluation.riskClass, "verboden", "stop: risicoklasse verboden");
}

// ------------------------------------------------- filenames

{
  const slugs = entries.map((e) => registerDossierSlug(e.system));
  assert.equal(new Set(slugs).size, slugs.length, "bestandsnamen: slugs zijn uniek");
  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bestandsnaam: slug "${slug}" is veilig`);
  }
  assert.equal(
    registerDossierFilename(sysVrij),
    "ai-registerdossier-chatbot-klantvraag-pilot-99999999.md",
    "bestandsnaam: leestekens uit de naam gestript",
  );
  assert.match(
    registerDossierSlug({ ...sysLeeg, name: "" }),
    /^toepassing-/,
    "bestandsnaam: naamloos systeem valt terug op 'toepassing'",
  );
}

console.log(
  `verify-register-export: all assertions passed ` +
    `(${entries.length} fixtures, ${questionnaire.registerColumns.length} CSV-kolommen, ` +
    `${OBLIGATIONS_ZONDER_REFS.size} verplichtingen zonder AI Act-basis)`,
);
