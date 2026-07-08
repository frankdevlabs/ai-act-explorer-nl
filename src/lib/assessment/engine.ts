import type {
  Evaluation,
  Module,
  ObligationStatus,
  QCondition,
  Question,
  Questionnaire,
  RiskClass,
  TimelineEntry,
} from "./types";

/**
 * Pure assessment engine: answers in, evaluation out. No UI or storage
 * coupling; exercised directly by scripts/verify-assessment.ts fixtures.
 *
 * Flag derivation is a single forward pass over modules in document order:
 * conditions may only reference flags set by *earlier* questions (the verify
 * script asserts this), plus the derived flags computed between modules
 * (hoogrisico). Effects of questions that are currently hidden are ignored,
 * so stale answers from abandoned branches cannot leak into the outcome.
 */

export interface VisibilityContext {
  flags: Set<string>;
  visibleModules: Set<string>;
  visibleQuestions: Set<string>;
}

/** Annex III category labels keyed by module-7 question id. */
const ANNEX3_LABELS: Record<string, string> = {
  "7.1": "1 — Biometrie",
  "7.2": "2 — Kritieke infrastructuur",
  "7.3": "3 — Onderwijs en beroepsopleiding",
  "7.4": "4 — Werkgelegenheid en personeelsbeheer",
  "7.5a": "5(a) — Essentiële publieke diensten",
  "7.5b": "5(b) — Kredietwaardigheid",
  "7.5c": "5(c) — Levens-/ziektekostenverzekering",
  "7.5d": "5(d) — Noodhulp",
  "7.6": "6 — Rechtshandhaving",
  "7.7": "7 — Migratie, asiel en grensbeheer",
  "7.8": "8 — Rechtsbedeling en democratische processen",
};

const RISK_LABELS: Record<RiskClass, string> = {
  "geen-ai": "Geen AI-systeem",
  verboden: "Verboden praktijk (art. 5)",
  hoogrisico: "Hoog risico",
  transparantierisico: "Transparantierisico (art. 50)",
  minimaal: "Minimaal/beperkt risico",
};

export function riskLabel(risk: RiskClass): string {
  return RISK_LABELS[risk];
}

function evalCondition(
  cond: QCondition,
  flags: Set<string>,
  answers: Record<string, string>,
): boolean {
  if (cond.all) return cond.all.every((c) => evalCondition(c, flags, answers));
  if (cond.any) return cond.any.some((c) => evalCondition(c, flags, answers));
  if (cond.not) return !evalCondition(cond.not, flags, answers);
  if (cond.flag) return flags.has(cond.flag);
  if (cond.answer) {
    const v = answers[cond.answer.q];
    const want = cond.answer.is;
    return Array.isArray(want) ? want.includes(v) : v === want;
  }
  return true;
}

/** The escape of art. 6(3) actually neutralises the Annex III hit. */
function escapeApplies(flags: Set<string>): boolean {
  return (
    flags.has("escape_ingeroepen") &&
    flags.has("escape_conditie") &&
    flags.has("escape_geen_risico") &&
    !flags.has("profilering")
  );
}

/** Derived flags recomputed between modules so later showIf can use them. */
function deriveFlags(flags: Set<string>): void {
  const hoogrisico =
    flags.has("annex1_hoogrisico") || (flags.has("annex3_kandidaat") && !escapeApplies(flags));
  if (hoogrisico) flags.add("hoogrisico");
  else flags.delete("hoogrisico");
}

/** Forward pass: flags + visibility for every module/question. */
export function computeVisibility(
  questionnaire: Questionnaire,
  answers: Record<string, string>,
): VisibilityContext {
  const flags = new Set<string>();
  const visibleModules = new Set<string>();
  const visibleQuestions = new Set<string>();
  for (const mod of questionnaire.modules) {
    deriveFlags(flags);
    const moduleVisible = !mod.showIf || evalCondition(mod.showIf, flags, answers);
    if (moduleVisible) visibleModules.add(mod.id);
    for (const q of mod.questions) {
      deriveFlags(flags);
      const visible = moduleVisible && (!q.showIf || evalCondition(q.showIf, flags, answers));
      if (!visible) continue;
      visibleQuestions.add(q.id);
      const answer = answers[q.id];
      if (answer === undefined || answer === "") continue;
      for (const effect of q.effects ?? []) {
        const match = Array.isArray(effect.when)
          ? effect.when.includes(answer)
          : effect.when === answer;
        if (match) flags.add(effect.setFlag);
      }
    }
  }
  deriveFlags(flags);
  return { flags, visibleModules, visibleQuestions };
}

function answerLabel(q: Question, value: string | undefined): string {
  if (value === undefined || value === "") return "";
  if (q.answerType === "choice") {
    return q.options?.find((o) => o.value === value)?.label ?? value;
  }
  if (value === "ja") return "Ja";
  if (value === "nee") return "Nee";
  if (value === "nvt") return "N.v.t.";
  return value;
}

function questionById(questionnaire: Questionnaire, id: string): Question | undefined {
  for (const m of questionnaire.modules) {
    const q = m.questions.find((x) => x.id === id);
    if (q) return q;
  }
  return undefined;
}

function obligationStatuses(
  questionnaire: Questionnaire,
  answers: Record<string, string>,
  ctx: VisibilityContext,
): ObligationStatus[] {
  const out: ObligationStatus[] = [];
  for (const mod of questionnaire.modules) {
    for (const q of mod.questions) {
      if (!q.obligation || !ctx.visibleQuestions.has(q.id)) continue;
      const v = answers[q.id];
      const status: ObligationStatus["status"] =
        v === "ja" ? "voldaan" : v === "nee" ? "actie" : v === "nvt" ? "nvt" : "open";
      out.push({ questionId: q.id, moduleId: mod.id, text: q.text, status, refs: q.refs });
    }
  }
  return out;
}

function buildTimeline(flags: Set<string>, stops: string[], transparantieLeden: string[]): TimelineEntry[] {
  const t: TimelineEntry[] = [];
  if (!flags.has("ai_systeem")) return t;
  t.push({ date: "2025-02-02", label: "Verboden praktijken (art. 5) en AI-geletterdheid (art. 4): van kracht." });
  if (stops.includes("5.9") || stops.includes("5.10")) {
    t.push({
      date: "2026-12-02",
      label: "Nieuwe verboden van art. 5, lid 1, punten b bis/b ter (intiem beeldmateriaal zonder toestemming; CSAM): van toepassing.",
      omnibus: true,
    });
  }
  if (flags.has("gpai_aanbieder")) {
    t.push({ date: "2025-08-02", label: "GPAI-verplichtingen (art. 53–55) voor nieuwe modellen: van kracht." });
    t.push({ date: "2027-08-02", label: "Vóór 2 augustus 2025 in de handel gebrachte GPAI-modellen moeten voldoen (art. 111, lid 3)." });
  }
  if (transparantieLeden.length > 0) {
    t.push({ date: "2026-08-02", label: "Transparantieverplichtingen art. 50: van toepassing (algemene toepassingsdatum)." });
    if (transparantieLeden.includes("lid 2")) {
      t.push({
        date: "2026-12-02",
        label: "Uiterste datum markeringsplicht art. 50, lid 2, voor vóór 2 augustus 2026 in de handel gebrachte generatieve systemen (art. 111, lid 4).",
        omnibus: true,
      });
    }
  }
  if (flags.has("hoogrisico")) {
    if (flags.has("annex3_kandidaat")) {
      t.push({
        date: "2027-12-02",
        label: "Hoogrisicoverplichtingen bijlage III (hfdst. III, afdelingen 1–3, incl. art. 26/27): van toepassing (was 2 augustus 2026).",
        omnibus: true,
      });
    }
    if (flags.has("annex1_hoogrisico")) {
      t.push({
        date: "2028-08-02",
        label: "Hoogrisicoverplichtingen bijlage I: van toepassing (was 2 augustus 2027).",
        omnibus: true,
      });
    }
  }
  return t.sort((a, b) => a.date.localeCompare(b.date));
}

export function evaluate(
  questionnaire: Questionnaire,
  answers: Record<string, string>,
): Evaluation {
  const ctx = computeVisibility(questionnaire, answers);
  const { flags } = ctx;

  const stops: string[] = [];
  for (const m of questionnaire.modules) {
    for (const q of m.questions) {
      if (q.prohibition && ctx.visibleQuestions.has(q.id) && answers[q.id] === "ja") {
        stops.push(q.id);
      }
    }
  }

  const geenAi = flags.has("geen_ai") && !flags.has("ai_systeem");
  const kwalificatie = geenAi
    ? "Geen AI-systeem"
    : flags.has("gpai_model")
      ? "GPAI-model"
      : flags.has("gpai_systeem")
        ? "GPAI-systeem"
        : flags.has("ai_systeem")
          ? "AI-systeem"
          : "";

  const rollen: string[] = [];
  if (flags.has("rol_aanbieder")) rollen.push("Aanbieder");
  if (flags.has("rol_deployer")) rollen.push("Gebruiksverantwoordelijke (deployer)");
  if (flags.has("rol_importeur")) rollen.push("Importeur");
  if (flags.has("rol_distributeur")) rollen.push("Distributeur");
  if (flags.has("rol_gemachtigde")) rollen.push("Gemachtigde");

  const transparantieLeden: string[] = [];
  if (flags.has("transparantie_lid1")) transparantieLeden.push("lid 1");
  if (flags.has("transparantie_lid2")) transparantieLeden.push("lid 2");
  if (flags.has("transparantie_lid3")) transparantieLeden.push("lid 3");
  if (flags.has("transparantie_lid4")) transparantieLeden.push("lid 4");

  const riskClass: RiskClass = geenAi
    ? "geen-ai"
    : stops.length > 0
      ? "verboden"
      : flags.has("hoogrisico")
        ? "hoogrisico"
        : transparantieLeden.length > 0
          ? "transparantierisico"
          : "minimaal";

  const annex3Categorieen = Object.keys(ANNEX3_LABELS)
    .filter((id) => ctx.visibleQuestions.has(id) && answers[id] === "ja")
    .map((id) => ANNEX3_LABELS[id]);

  const escape = {
    ingeroepen: flags.has("escape_ingeroepen"),
    mogelijk: flags.has("escape_conditie") && flags.has("escape_geen_risico") && !flags.has("profilering"),
    geblokkeerdDoorProfilering: flags.has("annex3_kandidaat") && flags.has("profilering"),
  };

  const obligations = obligationStatuses(questionnaire, answers, ctx);
  const openActions = obligations.filter((o) => o.status === "actie");
  const timeline = buildTimeline(flags, stops, transparantieLeden);

  // ---- register row -------------------------------------------------------
  const derived: Record<string, string> = {
    kwalificatie,
    rollen: rollen.join(", "),
    verboden: stops.length > 0 ? `Ja — vraag ${stops.join(", ")}` : "Nee",
    annex1: flags.has("annex1_hoogrisico") ? "Ja" : "Nee",
    annex3: annex3Categorieen.length > 0 ? annex3Categorieen.join("; ") : "Geen",
    escape: !flags.has("annex3_kandidaat")
      ? "N.v.t."
      : escape.geblokkeerdDoorProfilering
        ? "Uitgesloten (profilering)"
        : escape.ingeroepen
          ? "Ingeroepen"
          : "Niet ingeroepen",
    risicoklasse: kwalificatie === "" && riskClass === "minimaal" ? "" : RISK_LABELS[riskClass],
    fria: !flags.has("hoogrisico")
      ? "N.v.t."
      : flags.has("fria_vereist")
        ? `Vereist${answers["10.3"] === "ja" ? " — uitgevoerd" : answers["10.3"] === "nee" ? " — actie open" : ""}`
        : "Niet vereist",
    transparantie: transparantieLeden.length > 0 ? transparantieLeden.join(", ") : "N.v.t.",
    databank: answerLabel(
      questionById(questionnaire, "22.8") as Question,
      answers["22.8"],
    ) || answerLabel(questionById(questionnaire, "9.2") as Question, answers["9.2"]) || (flags.has("hoogrisico") ? "" : "N.v.t."),
    ce: answerLabel(questionById(questionnaire, "22.7") as Question, answers["22.7"]) ||
      answerLabel(questionById(questionnaire, "9.1") as Question, answers["9.1"]) ||
      (flags.has("hoogrisico") ? "" : "N.v.t."),
    openacties:
      openActions.length > 0
        ? `${openActions.length} (${openActions.map((o) => o.questionId).join(", ")})`
        : "Geen",
  };

  const registerRow: Record<string, string> = {};
  for (const col of questionnaire.registerColumns) {
    if (col.source.startsWith("q:")) {
      const qid = col.source.slice(2);
      const q = questionById(questionnaire, qid);
      registerRow[col.id] = q && ctx.visibleQuestions.has(qid) ? answerLabel(q, answers[qid]) : "";
    } else if (col.source.startsWith("d:")) {
      registerRow[col.id] = derived[col.source.slice(2)] ?? "";
    }
  }

  const total = questionnaire.modules
    .flatMap((m: Module) => m.questions)
    .filter((q) => ctx.visibleQuestions.has(q.id)).length;
  const answered = Object.entries(answers).filter(
    ([id, v]) => v !== "" && ctx.visibleQuestions.has(id),
  ).length;

  return {
    answered,
    total,
    kwalificatie,
    rollen,
    riskClass,
    stops,
    annex3Categorieen,
    annex1: flags.has("annex1_hoogrisico"),
    escape,
    friaVereist: flags.has("fria_vereist"),
    transparantieLeden,
    obligations,
    openActions,
    timeline,
    registerRow,
  };
}

// ---------------------------------------------------------------------------
// Register export helpers (pure; used by UI and verify script)

function sanitizeCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function registerHeaderRow(questionnaire: Questionnaire, includeFinance: boolean): string[] {
  return questionnaire.registerColumns
    .filter((c) => includeFinance || !c.financeOnly)
    .map((c) => c.label);
}

export function registerValueRow(
  questionnaire: Questionnaire,
  row: Record<string, string>,
  includeFinance: boolean,
): string[] {
  return questionnaire.registerColumns
    .filter((c) => includeFinance || !c.financeOnly)
    .map((c) => sanitizeCell(row[c.id] ?? ""));
}

export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

export function toCsv(rows: string[][]): string {
  const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
