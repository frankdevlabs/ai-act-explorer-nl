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
import { vb001, vb002, vb003, vb004 } from "./lib/assessment-fixtures";
import { loadCorpus, makeCheckRef } from "./lib/corpus-index";
import type {
  ObligationCatalogEntry,
  QCondition,
  Question,
  Questionnaire,
  RiskClass,
  RoleFlag,
} from "../src/lib/assessment/types";
import {
  computeVisibility,
  evaluate,
  obligationCatalog,
  registerValueRow,
  toTsv,
} from "../src/lib/assessment/engine";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));

const questionnaire = load<Questionnaire>("data/questionnaire/assessment-v1.json");

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

// The href grammar lives in scripts/lib/corpus-index.ts: verify-register-export
// validates the same deep links from the exported dossier.
const checkRef = makeCheckRef(loadCorpus(root));

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
//
// The answer blobs themselves live in scripts/lib/assessment-fixtures.ts:
// scripts/verify-mcp.ts replays the same four through the mirrored engine
// embedded in the MCP Apps panel, and this file cannot be imported (it asserts
// at import time). The assertions stay here.

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

// ------------------------------------------------- obligation catalog (MCP)

/**
 * `obligationCatalog` is the answer-independent view of the obligation-flagged
 * questions that the MCP tool `get_obligations` serves. It is three-valued:
 * a gate the filter does not decide keeps the obligation *in*, with the gate
 * spelled out in `conditions`. Only a hard `false` excludes. So these pins
 * measure two things: that the role axis really prunes (a deployer must not
 * see the provider modules) and that nothing falls out of the catalog
 * entirely.
 */
{
  const ROLES: RoleFlag[] = [
    "rol_aanbieder",
    "rol_deployer",
    "rol_importeur",
    "rol_distributeur",
    "rol_gemachtigde",
    "gpai_aanbieder",
  ];
  const RISKS: RiskClass[] = [
    "geen-ai",
    "verboden",
    "hoogrisico",
    "transparantierisico",
    "minimaal",
  ];

  const obligationIds = allQuestions.filter(({ q }) => q.obligation).map(({ q }) => q.id);
  const perModule = (entries: ObligationCatalogEntry[]) => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.moduleId] = (counts[e.moduleId] ?? 0) + 1;
    return counts;
  };

  // Unfiltered catalog = every obligation question, once, in document order.
  const full = obligationCatalog(questionnaire);
  assert.deepEqual(
    full.map((e) => e.questionId),
    obligationIds,
    "catalogus zonder filter = alle verplichtingsvragen in documentvolgorde",
  );
  // History: 123 at the 2026-07 expansion (m11 split into m11/m19–m23, m24
  // value chain, m12 systemic-risk split). Re-pin only after auditing which
  // questions gained or lost `obligation: true`.
  assert.equal(full.length, 123, "123 verplichtingsvragen in de catalogus");

  // Role axis. Per-module counts, because the totals are dominated by the
  // role-independent modules (m13–m17, m25) that every filter keeps.
  const deployer = obligationCatalog(questionnaire, {
    role: "rol_deployer",
    riskClass: "hoogrisico",
  });
  assert.equal(perModule(deployer).m9, 13, "deployer/hoogrisico: 13 art. 26-verplichtingen (m9)");
  assert.equal(perModule(deployer).m10, 10, "deployer/hoogrisico: 10 FRIA-verplichtingen (m10)");
  for (const id of ["m11", "m19", "m20", "m21", "m22", "m23"]) {
    assert.ok(!perModule(deployer)[id], `deployer/hoogrisico: aanbiedermodule ${id} uitgesloten`);
  }

  const aanbieder = obligationCatalog(questionnaire, {
    role: "rol_aanbieder",
    riskClass: "hoogrisico",
  });
  const aanbiederModules = perModule(aanbieder);
  const aanbiederTotal = ["m11", "m19", "m20", "m21", "m22", "m23"].reduce(
    (sum, id) => sum + (aanbiederModules[id] ?? 0),
    0,
  );
  // 13 + 8 + 8 + 11 + 6 + 5 — the six provider modules of the 2026-07 split.
  assert.equal(aanbiederTotal, 51, "aanbieder/hoogrisico: 51 aanbiedersverplichtingen");
  for (const id of ["m9", "m10"]) {
    assert.ok(!aanbiederModules[id], `aanbieder/hoogrisico: deployermodule ${id} uitgesloten`);
  }

  // m24 is one module for three value-chain roles; the role flag picks the
  // block. Importeur: 24.3–24.8 (6) plus 11.17, whose own gate
  // (aanbieder_derde_land) the filter cannot decide — so it stays, conditional.
  const importeur = obligationCatalog(questionnaire, {
    role: "rol_importeur",
    riskClass: "hoogrisico",
  });
  assert.equal(perModule(importeur).m24, 7, "importeur: 6 importeursverplichtingen + 11.17");
  assert.equal(
    importeur.filter((e) => e.moduleId === "m24" && !e.conditions.length).length,
    6,
    "importeur/hoogrisico: de 6 eigen m24-verplichtingen zijn onvoorwaardelijk",
  );
  assert.equal(perModule(obligationCatalog(questionnaire, { role: "rol_distributeur" })).m24, 6);
  assert.equal(perModule(obligationCatalog(questionnaire, { role: "rol_gemachtigde" })).m24, 3);

  // gpai_aanbieder is the second axis: it opens m12 (art. 53–55) and does not
  // touch the five rol_* modules.
  assert.equal(
    perModule(obligationCatalog(questionnaire, { role: "gpai_aanbieder" })).m12,
    12,
    "gpai-aanbieder: 12 GPAI-verplichtingen (m12)",
  );

  // Risk axis: no AI system → only the cross-cutting modules survive.
  const geenAi = obligationCatalog(questionnaire, { riskClass: "geen-ai" });
  assert.deepEqual(
    Object.keys(perModule(geenAi)).sort(),
    ["m15", "m16", "m17", "m8"],
    "geen-ai: alleen AVG/DORA/overige raakvlakken (+ de voorwaardelijke escape-vraag)",
  );

  // No orphans: every obligation question must be reachable from at least one
  // {role, riskClass} combination. This is the assertion that fires when a new
  // obligation lands behind a gate the role mapping does not cover.
  {
    const reachable = new Set<string>();
    for (const role of [undefined, ...ROLES]) {
      for (const riskClass of [undefined, ...RISKS]) {
        for (const e of obligationCatalog(questionnaire, { role, riskClass })) {
          reachable.add(e.questionId);
        }
      }
    }
    for (const id of obligationIds) {
      assert.ok(reachable.has(id), `verplichting ${id} is bereikbaar via een rol/risicoklasse`);
    }
  }

  // The catalog carries refs into MCP output, so they get the same integrity
  // check as the questionnaire's own refs.
  for (const e of full) {
    for (const ref of e.refs ?? []) checkRef(`catalogus ${e.questionId}`, ref.href);
    assert.ok(e.moduleTitle.length > 0, `catalogus ${e.questionId}: moduletitel aanwezig`);
  }
}

const questionCount = allQuestions.length;
console.log(
  `verify-assessment: all assertions passed ` +
    `(${questionnaire.modules.length} modules, ${questionCount} vragen, ` +
    `${questionnaire.registerColumns.length} registerkolommen)`,
);
