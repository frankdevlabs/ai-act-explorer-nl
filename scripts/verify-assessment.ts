/**
 * Assertions over the assessment questionnaire (curated editorial layer,
 * epic 7). Runs after verify-recital-map.ts in `npm run verify`.
 *
 * Three groups:
 * - structure: unique ids, answer-domain consistency of options/effects,
 *   register wiring (question.register ↔ registerColumns);
 * - integrity: every ref href resolves to an existing article/annex/recital
 *   and fragment anchor; conditions only reference flags/questions defined
 *   earlier in document order (the engine is a single forward pass);
 * - behaviour: the two worked examples from the source workbook (VB-001
 *   kredietscoring, VB-002 GPAI-assistent) evaluate to the expected outcome.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AmendmentsGenerated, Annex, Article, ContentNode, Recital } from "../src/lib/types";
import type { QCondition, Question, Questionnaire } from "../src/lib/assessment/types";
import { computeVisibility, evaluate, registerValueRow, toTsv } from "../src/lib/assessment/engine";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const questionnaire = load<Questionnaire>("data/questionnaire/assessment-v1.json");
const articles = load<Article[]>("data/generated/articles.json");
const annexes = load<Annex[]>("data/generated/annexes.json");
const recitals = load<Recital[]>("data/generated/recitals.json");
const amendments = load<AmendmentsGenerated>("data/generated/amendments.json");

// Derived flags the engine computes between modules (not set by effects).
const DERIVED_FLAGS = new Set(["hoogrisico"]);

// ------------------------------------------------- structure

const moduleIds = questionnaire.modules.map((m) => m.id);
assert.equal(new Set(moduleIds).size, moduleIds.length, "module ids unique");
assert.equal(questionnaire.modules.length, 25, "25 modules");

const allQuestions: { moduleId: string; q: Question }[] = questionnaire.modules.flatMap((m) =>
  m.questions.map((q) => ({ moduleId: m.id, q })),
);
const questionIds = allQuestions.map(({ q }) => q.id);
assert.equal(new Set(questionIds).size, questionIds.length, "question ids unique");

/**
 * Retired question ids. Answers persist in users' localStorage keyed by id;
 * reusing a retired id with different semantics would silently pre-answer the
 * new question with a stale value. Add every removed id here, never remove.
 */
const RETIRED_IDS = new Set<string>([
  // Coarse provider-obligation rows (one question ≈ one article), replaced by
  // the per-element modules m11/m19–m23 in the 2026-07 expansion. 11.17
  // (gemachtigde) is NOT retired: it moves to the value-chain module with
  // unchanged semantics.
  "11.1",
  "11.2",
  "11.3",
  "11.4",
  "11.5",
  "11.6",
  "11.7",
  "11.8",
  "11.9",
  "11.10",
  "11.11",
  "11.12",
  "11.13",
  "11.14",
  "11.15",
  "11.16",
  // Coarse systemic-risk row, split into 12.8–12.12 per element of art. 55(1).
  "12.6",
]);
for (const id of questionIds) {
  assert.ok(!RETIRED_IDS.has(id), `question id ${id} is retired and may not be reused`);
}

function answerDomain(q: Question): string[] | null {
  if (q.answerType === "janee") return ["ja", "nee"];
  if (q.answerType === "janeenvt") return ["ja", "nee", "nvt"];
  if (q.answerType === "choice") return (q.options ?? []).map((o) => o.value);
  return null; // free text
}

for (const { q } of allQuestions) {
  if (q.answerType === "choice") {
    assert.ok((q.options?.length ?? 0) >= 2, `${q.id}: choice has ≥2 options`);
  } else {
    assert.ok(!q.options, `${q.id}: options only on choice questions`);
  }
  const domain = answerDomain(q);
  for (const e of q.effects ?? []) {
    const when = Array.isArray(e.when) ? e.when : [e.when];
    assert.ok(domain !== null, `${q.id}: effects require a closed answer domain`);
    for (const w of when) assert.ok(domain!.includes(w), `${q.id}: effect value "${w}" in domain`);
  }
  if (q.prohibition) assert.equal(q.answerType, "janee", `${q.id}: prohibition is ja/nee`);
  if (q.obligation)
    assert.equal(q.answerType, "janeenvt", `${q.id}: obligation is ja/nee/n.v.t.`);
}

const columnIds = new Set(questionnaire.registerColumns.map((c) => c.id));
assert.equal(
  columnIds.size,
  questionnaire.registerColumns.length,
  "register column ids unique",
);
const DERIVED_SOURCES = new Set([
  "kwalificatie",
  "rollen",
  "verboden",
  "annex1",
  "annex3",
  "escape",
  "risicoklasse",
  "fria",
  "transparantie",
  "databank",
  "ce",
  "openacties",
]);
for (const col of questionnaire.registerColumns) {
  if (col.source.startsWith("q:")) {
    assert.ok(questionIds.includes(col.source.slice(2)), `column ${col.id}: question exists`);
  } else if (col.source.startsWith("d:")) {
    assert.ok(DERIVED_SOURCES.has(col.source.slice(2)), `column ${col.id}: derived key known`);
  } else {
    assert.fail(`column ${col.id}: source must be q: or d:`);
  }
}
for (const { q } of allQuestions) {
  if (q.register) assert.ok(columnIds.has(q.register), `${q.id}: register column "${q.register}" exists`);
}

// Every register column must be documented in COLUMN_DOC on the /register
// page (nothing enforces this at runtime; missing entries render blank).
{
  const registerPage = readFileSync(join(root, "src/app/register/page.tsx"), "utf-8");
  const docBlock = registerPage.match(/const COLUMN_DOC[^=]*= \{([\s\S]*?)\n\};/);
  assert.ok(docBlock, "COLUMN_DOC gevonden in register/page.tsx");
  const documented = new Set(
    [...docBlock![1].matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]),
  );
  for (const col of questionnaire.registerColumns) {
    assert.ok(documented.has(col.id), `COLUMN_DOC documenteert kolom "${col.id}"`);
  }
}

// ------------------------------------------------- ref integrity

function collectAnchors(nodes: ContentNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "list") {
      for (const item of node.items) {
        if (item.anchor) into.add(item.anchor);
        collectAnchors(item.content, into);
      }
    }
  }
}

function articleAnchors(paragraphs: { anchor: string; content: ContentNode[] }[]): Set<string> {
  const anchors = new Set<string>();
  for (const p of paragraphs) {
    anchors.add(p.anchor);
    collectAnchors(p.content, anchors);
  }
  return anchors;
}

const annexRomans = new Set([
  ...annexes.map((a) => a.roman.toLowerCase()),
  ...amendments.newAnnexes.map((a) => a.roman.toLowerCase()),
]);
const recitalNumbers = new Set(recitals.map((r) => r.number));
/** Curated internal info pages the questionnaire may link to (exact match, no fragments). */
const internalPages = new Set([
  "/gpai-praktijkcode",
  "/conformiteitsbeoordeling",
  "/transparantie-art50",
]);

function checkRef(owner: string, href: string): void {
  const [pathWithQuery, fragment] = href.split("#");
  const path = pathWithQuery.split("?")[0];
  const art = path.match(/^\/artikel\/(\d+)$/);
  if (art) {
    const a = articles.find((x) => x.number === Number(art[1]));
    assert.ok(a, `${owner}: artikel ${art[1]} bestaat`);
    if (fragment)
      assert.ok(articleAnchors(a!.paragraphs).has(fragment), `${owner}: anchor ${href}`);
    return;
  }
  const newArt = path.match(/^\/artikel\/(\d+(?:bis|ter|quater|quinquies))$/);
  if (newArt) {
    const spec = amendments.newArticles.find((n) => n.slug === newArt[1]);
    assert.ok(spec, `${owner}: omnibus-artikel ${newArt[1]} bestaat`);
    if (fragment)
      assert.ok(articleAnchors(spec!.paragraphs).has(fragment), `${owner}: anchor ${href}`);
    return;
  }
  const anx = path.match(/^\/bijlage\/([a-z]+)$/);
  if (anx) {
    assert.ok(annexRomans.has(anx[1]), `${owner}: bijlage ${anx[1]} bestaat`);
    assert.ok(!fragment, `${owner}: geen fragmenten op bijlagen (${href})`);
    return;
  }
  const rct = path.match(/^\/overweging\/(\d+)$/);
  if (rct) {
    assert.ok(recitalNumbers.has(Number(rct[1])), `${owner}: overweging ${rct[1]} bestaat`);
    return;
  }
  if (internalPages.has(path)) {
    assert.ok(!fragment, `${owner}: geen fragmenten op interne pagina's (${href})`);
    return;
  }
  assert.fail(`${owner}: onbekend ref-pad ${href}`);
}

for (const m of questionnaire.modules) {
  for (const ref of m.refs ?? []) checkRef(`module ${m.id}`, ref.href);
  for (const q of m.questions) for (const ref of q.refs ?? []) checkRef(q.id, ref.href);
}

// ------------------------------------------------- condition ordering

function conditionDeps(cond: QCondition): { flags: string[]; answers: string[] } {
  const flags: string[] = [];
  const answers: string[] = [];
  const walk = (c: QCondition) => {
    if (c.flag) flags.push(c.flag);
    if (c.answer) answers.push(c.answer.q);
    for (const sub of c.all ?? []) walk(sub);
    for (const sub of c.any ?? []) walk(sub);
    if (c.not) walk(c.not);
  };
  walk(cond);
  return { flags, answers };
}

{
  const availableFlags = new Set<string>(DERIVED_FLAGS);
  const seenQuestions = new Set<string>();
  for (const m of questionnaire.modules) {
    if (m.showIf) {
      const deps = conditionDeps(m.showIf);
      for (const f of deps.flags) assert.ok(availableFlags.has(f), `module ${m.id}: flag "${f}" set earlier`);
      for (const qid of deps.answers) assert.ok(seenQuestions.has(qid), `module ${m.id}: answer "${qid}" earlier`);
    }
    for (const q of m.questions) {
      if (q.showIf) {
        const deps = conditionDeps(q.showIf);
        for (const f of deps.flags) assert.ok(availableFlags.has(f), `${q.id}: flag "${f}" set earlier`);
        for (const qid of deps.answers) assert.ok(seenQuestions.has(qid), `${q.id}: answer "${qid}" earlier`);
      }
      seenQuestions.add(q.id);
      for (const e of q.effects ?? []) availableFlags.add(e.setFlag);
    }
  }
}

// ------------------------------------------------- behaviour fixtures

// VB-001 — ingekochte kredietscoringsmodule, deployer, financiële entiteit.
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

{
  const e = evaluate(questionnaire, vb001);
  assert.equal(e.kwalificatie, "AI-systeem", "VB-001 kwalificatie");
  assert.deepEqual(e.rollen, ["Gebruiksverantwoordelijke (deployer)"], "VB-001 rol");
  assert.equal(e.riskClass, "hoogrisico", "VB-001 hoog risico");
  assert.ok(
    e.annex3Categorieen.some((c) => c.includes("Kredietwaardigheid")),
    "VB-001 annex III 5(b)",
  );
  assert.equal(e.escape.geblokkeerdDoorProfilering, true, "VB-001 escape geblokkeerd");
  assert.equal(e.friaVereist, true, "VB-001 FRIA vereist");
  assert.deepEqual(
    e.openActions.map((o) => o.questionId),
    ["10.4"],
    "VB-001 open actie: FRIA-melding",
  );
  assert.equal(e.registerRow.risicoklasse, "Hoog risico", "VB-001 registerrij risicoklasse");
  assert.equal(e.registerRow.fria_status, "Vereist — uitgevoerd", "VB-001 registerrij FRIA");
  assert.equal(e.registerRow.escape, "Uitgesloten (profilering)", "VB-001 registerrij escape");
  assert.ok(
    e.timeline.some((t) => t.date === "2027-12-02" && t.omnibus),
    "VB-001 tijdlijn bevat omnibus-datum bijlage III",
  );
  const ctx = computeVisibility(questionnaire, vb001);
  assert.ok(ctx.visibleModules.has("m9"), "VB-001 module 9 zichtbaar");
  assert.ok(ctx.visibleModules.has("m16"), "VB-001 DORA-module zichtbaar");
  assert.ok(!ctx.visibleQuestions.has("8.2"), "VB-001 escape-condities verborgen na profilering");
  assert.ok(!ctx.visibleQuestions.has("9.13"), "VB-001 post-RBI-vraag verborgen zonder rechtshandhaving");
  assert.ok(!ctx.visibleQuestions.has("4.9"), "VB-001 derde-landvraag verborgen zonder aanbiedersrol");
  assert.ok(ctx.visibleQuestions.has("10.6"), "VB-001 FRIA-elementvragen zichtbaar na uitgevoerde FRIA");
  assert.ok(!ctx.visibleModules.has("m11"), "VB-001 aanbiedermodule verborgen zonder aanbiedersrol");
  assert.ok(!ctx.visibleModules.has("m22"), "VB-001 conformiteitsmodule verborgen zonder aanbiedersrol");
  const row = registerValueRow(questionnaire, e.registerRow, true);
  assert.equal(row.length, questionnaire.registerColumns.length, "VB-001 rij dekt alle kolommen");
  assert.ok(!toTsv([row]).includes("\n"), "VB-001 TSV is één regel");
}

// VB-002 — generatieve AI-assistent (GPAI-systeem), deployer, geen hoog risico.
const vb002: Record<string, string> = {
  "1.1": "Generatieve AI-assistent kantoorwerk",
  "1.12": "ja",
  "2.1": "ja",
  "2.2": "ja",
  "2.3": "ja",
  "2.4": "ja",
  "3.1": "nee",
  "3.2": "ja",
  "3.3": "nee",
  "3.4": "onbekend",
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
  "7.5b": "nee",
  "7.5c": "nee",
  "7.5d": "nee",
  "7.6": "nee",
  "7.7": "nee",
  "7.8": "nee",
  "25.1": "GPT-4o (OpenAI), via API",
  "25.2": "ja",
  "25.3": "nee",
  "25.4": "ja",
  "25.5": "ja",
  "25.6": "nee",
  "13.1": "ja",
  "13.2": "ja",
  "13.3": "nee",
  "13.4": "nee",
  "13.6": "ja",
  "13.7": "ja",
  "13.5": "ja",
  "14.1": "ja",
  "14.2": "ja",
  "14.3": "ja",
  "15.1": "ja",
  "15.2": "ja",
  "15.3": "nee",
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
  "18.1": "midden",
  "18.2": "go",
  "18.4": "03-2026 / 03-2027",
  "18.5": "Gebruiksbeleid v2.1",
};

{
  const e = evaluate(questionnaire, vb002);
  assert.equal(e.kwalificatie, "GPAI-systeem", "VB-002 kwalificatie");
  assert.equal(e.riskClass, "transparantierisico", "VB-002 transparantierisico");
  assert.deepEqual(e.transparantieLeden, ["lid 1", "lid 2"], "VB-002 art. 50-leden");
  assert.equal(e.friaVereist, false, "VB-002 geen FRIA");
  assert.equal(e.openActions.length, 0, "VB-002 geen open acties");
  assert.equal(e.registerRow.transparantie, "lid 1, lid 2", "VB-002 registerrij transparantie");
  assert.equal(e.registerRow.escape, "N.v.t.", "VB-002 registerrij escape");
  const ctx = computeVisibility(questionnaire, vb002);
  assert.ok(!ctx.visibleModules.has("m9"), "VB-002 module 9 verborgen");
  assert.ok(!ctx.visibleModules.has("m8"), "VB-002 module 8 verborgen");
  assert.ok(!ctx.visibleModules.has("m12"), "VB-002 module 12 verborgen");
  assert.ok(ctx.visibleModules.has("m25"), "VB-002 downstream-GPAI-module zichtbaar");
  assert.ok(ctx.visibleQuestions.has("25.5"), "VB-002 systeemrisicotoets zichtbaar bij 'onbekend'");
  assert.ok(ctx.visibleQuestions.has("13.6"), "VB-002 lid 1-verplichting zichtbaar");
  assert.ok(!ctx.visibleQuestions.has("13.9"), "VB-002 lid 4-verplichting verborgen");
  assert.equal(e.registerRow.gpai_upstream, "GPT-4o (OpenAI), via API", "VB-002 registerrij GPAI-model");
  assert.equal(e.registerRow.gpai_docs, "Ja", "VB-002 registerrij GPAI-documentatie");
  assert.ok(
    e.timeline.some((t) => t.date === "2026-12-02"),
    "VB-002 tijdlijn bevat art. 111(4)-overgangsdatum",
  );
}

// VB-003 — zelf ontwikkelde sollicitantenscreening, aanbieder, niet-financieel.
const vb003: Record<string, string> = {
  "1.1": "CV-screening en kandidaatranking",
  "1.12": "nee",
  "2.1": "ja",
  "2.2": "ja",
  "2.3": "ja",
  "2.4": "ja",
  "3.1": "nee",
  "3.2": "nee",
  "4.1": "ja",
  "4.2": "nee",
  "4.3": "nee",
  "4.4": "nee",
  "4.5": "nee",
  "4.6": "nee",
  "4.7": "nee",
  "4.8": "nee",
  "4.9": "nee",
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
  "7.4": "ja",
  "7.5a": "nee",
  "7.5b": "nee",
  "7.5c": "nee",
  "7.5d": "nee",
  "7.6": "nee",
  "7.7": "nee",
  "7.8": "nee",
  "8.1": "ja",
  "11.20": "ja",
  "11.22": "ja",
  "11.23": "ja",
  "11.24": "ja",
  "11.25": "ja",
  "11.26": "ja",
  "11.27": "ja",
  "11.29": "ja",
  "11.30": "ja",
  "11.31": "ja",
  "11.32": "ja",
  "11.33": "nvt",
  "19.1": "ja",
  "19.2": "ja",
  "19.3": "ja",
  "19.5": "ja",
  "19.6": "ja",
  "19.7": "ja",
  "19.8": "ja",
  "20.1": "ja",
  "20.2": "ja",
  "20.3": "ja",
  "20.4": "ja",
  "20.6": "ja",
  "20.7": "ja",
  "20.8": "ja",
  "21.1": "ja",
  "21.2": "ja",
  "21.3": "ja",
  "21.5": "ja",
  "21.6": "ja",
  "21.7": "nee",
  "21.8": "ja",
  "21.9": "ja",
  "21.11": "ja",
  "22.1": "ja",
  "22.2": "annex-vi",
  "22.3": "ja",
  "22.5": "ja",
  "22.6": "ja",
  "22.7": "ja",
  "22.8": "ja",
  "23.1": "ja",
  "23.2": "ja",
  "23.3": "ja",
  "23.4": "ja",
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
  "17.1": "ja",
  "17.2": "ja",
  "17.3": "ja",
  "17.4": "ja",
  "18.1": "hoog",
  "18.2": "go-voorwaarden",
  "18.3": "Herstel meldproces non-conformiteit",
  "18.4": "10-2026 / 10-2027",
  "18.5": "Dossier #124",
};

{
  const e = evaluate(questionnaire, vb003);
  assert.equal(e.kwalificatie, "AI-systeem", "VB-003 kwalificatie");
  assert.deepEqual(e.rollen, ["Aanbieder"], "VB-003 rol");
  assert.equal(e.riskClass, "hoogrisico", "VB-003 hoog risico");
  assert.ok(
    e.annex3Categorieen.some((c) => c.includes("Werkgelegenheid")),
    "VB-003 annex III 4",
  );
  assert.equal(e.escape.geblokkeerdDoorProfilering, true, "VB-003 escape geblokkeerd");
  assert.equal(e.friaVereist, false, "VB-003 geen FRIA (geen deployer)");
  assert.deepEqual(
    e.openActions.map((o) => o.questionId),
    ["21.7"],
    "VB-003 open actie: corrigerende maatregelen",
  );
  assert.equal(e.registerRow.ce, "Ja", "VB-003 registerrij CE uit 22.7");
  assert.equal(e.registerRow.databank, "Ja", "VB-003 registerrij databank uit 22.8");
  assert.equal(e.registerRow.rollen, "Aanbieder", "VB-003 registerrij rollen");
  const ctx = computeVisibility(questionnaire, vb003);
  for (const id of ["m11", "m19", "m20", "m21", "m22", "m23"]) {
    assert.ok(ctx.visibleModules.has(id), `VB-003 module ${id} zichtbaar`);
  }
  for (const id of ["m9", "m10", "m12", "m16"]) {
    assert.ok(!ctx.visibleModules.has(id), `VB-003 module ${id} verborgen`);
  }
  assert.ok(!ctx.visibleQuestions.has("11.21"), "VB-003 bijlage I-vraag verborgen");
  assert.ok(!ctx.visibleQuestions.has("21.10"), "VB-003 rolverschuivingsvraag verborgen");
  assert.ok(!ctx.visibleModules.has("m24"), "VB-003 waardeketenmodule verborgen (EU-aanbieder)");
  assert.ok(!ctx.visibleQuestions.has("22.4"), "VB-003 certificaatvraag verborgen bij interne controle");
  assert.equal(e.registerRow.conf_route, "Interne controle (bijlage VI)", "VB-003 registerrij conformiteitsroute");
}

// VB-004 — geïmporteerd hoogrisicosysteem (werving), rol importeur.
const vb004: Record<string, string> = {
  "1.1": "Ingekochte assessment-suite (import VS)",
  "1.12": "nee",
  "2.1": "ja",
  "2.2": "ja",
  "2.3": "ja",
  "2.4": "ja",
  "3.1": "nee",
  "3.2": "nee",
  "4.1": "nee",
  "4.2": "nee",
  "4.3": "ja",
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
  "7.4": "ja",
  "7.5a": "nee",
  "7.5b": "nee",
  "7.5c": "nee",
  "7.5d": "nee",
  "7.6": "nee",
  "7.7": "nee",
  "7.8": "nee",
  "8.1": "ja",
  "24.3": "ja",
  "24.4": "ja",
  "24.5": "ja",
  "24.6": "ja",
  "24.7": "nee",
  "24.8": "ja",
  "13.1": "nee",
  "13.2": "nee",
  "13.3": "nee",
  "13.4": "nee",
  "14.1": "ja",
  "14.2": "ja",
  "14.3": "ja",
  "18.1": "hoog",
  "18.2": "go-voorwaarden",
};

{
  const e = evaluate(questionnaire, vb004);
  assert.deepEqual(e.rollen, ["Importeur"], "VB-004 rol importeur");
  assert.equal(e.riskClass, "hoogrisico", "VB-004 hoog risico");
  assert.deepEqual(
    e.openActions.map((o) => o.questionId),
    ["24.7"],
    "VB-004 open actie: bewaarplicht importeur",
  );
  const ctx = computeVisibility(questionnaire, vb004);
  assert.ok(ctx.visibleModules.has("m24"), "VB-004 waardeketenmodule zichtbaar");
  for (const id of ["m9", "m10", "m11", "m19", "m20", "m21", "m22", "m23", "m12", "m16"]) {
    assert.ok(!ctx.visibleModules.has(id), `VB-004 module ${id} verborgen`);
  }
  assert.ok(ctx.visibleQuestions.has("24.3"), "VB-004 importeursvragen zichtbaar");
  assert.ok(!ctx.visibleQuestions.has("24.1"), "VB-004 gemachtigdevragen verborgen");
  assert.ok(!ctx.visibleQuestions.has("24.9"), "VB-004 distributeursvragen verborgen");
  assert.ok(!ctx.visibleQuestions.has("11.17"), "VB-004 gemachtigde-aanwijzing verborgen");
}

// Geen AI: regeltoepassing zonder inferentie → alleen AVG-modules relevant.
{
  const e = evaluate(questionnaire, { "2.1": "ja", "2.2": "nee", "2.4": "nee", "2.6": "ja" });
  assert.equal(e.riskClass, "geen-ai", "regelgebaseerd systeem is geen AI");
  const ctx = computeVisibility(questionnaire, { "2.4": "nee", "2.6": "ja" });
  assert.ok(!ctx.visibleModules.has("m5"), "geen AI: module 5 verborgen");
  assert.ok(!ctx.visibleModules.has("m25"), "geen AI: downstream-GPAI-module verborgen");
  assert.ok(ctx.visibleModules.has("m15"), "geen AI: AVG-module blijft zichtbaar");
}

// Verboden praktijk overrulet alles.
{
  const e = evaluate(questionnaire, { "2.4": "ja", "5.6": "ja", "7.4": "ja" });
  assert.equal(e.riskClass, "verboden", "art. 5-hit → verboden");
  assert.deepEqual(e.stops, ["5.6"], "stop op 5.6");
}

const questionCount = allQuestions.length;
console.log(
  `verify-assessment: all assertions passed ` +
    `(${questionnaire.modules.length} modules, ${questionCount} vragen, ` +
    `${questionnaire.registerColumns.length} registerkolommen)`,
);
