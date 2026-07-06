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
assert.equal(questionnaire.modules.length, 18, "18 modules");

const allQuestions: { moduleId: string; q: Question }[] = questionnaire.modules.flatMap((m) =>
  m.questions.map((q) => ({ moduleId: m.id, q })),
);
const questionIds = allQuestions.map(({ q }) => q.id);
assert.equal(new Set(questionIds).size, questionIds.length, "question ids unique");

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
  "10.1": "nee",
  "10.2": "ja",
  "10.3": "ja",
  "10.4": "nee",
  "10.5": "ja",
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
  "13.1": "ja",
  "13.2": "ja",
  "13.3": "nee",
  "13.4": "nee",
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
  assert.ok(
    e.timeline.some((t) => t.date === "2026-12-02"),
    "VB-002 tijdlijn bevat art. 111(4)-overgangsdatum",
  );
}

// Geen AI: regeltoepassing zonder inferentie → alleen AVG-modules relevant.
{
  const e = evaluate(questionnaire, { "2.1": "ja", "2.2": "nee", "2.4": "nee", "2.6": "ja" });
  assert.equal(e.riskClass, "geen-ai", "regelgebaseerd systeem is geen AI");
  const ctx = computeVisibility(questionnaire, { "2.4": "nee", "2.6": "ja" });
  assert.ok(!ctx.visibleModules.has("m5"), "geen AI: module 5 verborgen");
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
