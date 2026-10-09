/**
 * AI-register exports (card #176), pure and fixture-tested by
 * scripts/verify-register-export.ts:
 *
 * 1. A Markdown dossier per registered AI system — classification, the
 *    obligation checklist per module with an absolute deep link to the
 *    artikel/lid that carries each obligation, the open actions, the
 *    applicable dates and the answers that drove the classification. Meant to
 *    be handed to a business owner or attached to a file, so every legal
 *    reference is an absolute URL (src/lib/site.ts): a relative href is dead
 *    outside the app.
 *
 * 2. One flat CSV over all systems — exactly the register rows the /register
 *    table shows, for spreadsheet use.
 *
 * No React, no localStorage, no data.ts: the caller passes questionnaire and
 * evaluations in, which is what makes this testable from scripts/.
 */
import {
  answerLabel,
  computeVisibility,
  registerHeaderRow,
  registerValueRow,
  toCsv,
} from "../assessment/engine";
import type {
  Evaluation,
  Module,
  ObligationStatus,
  Question,
  Questionnaire,
  QRef,
  StoredSystem,
} from "../assessment/types";
import { SITE_ORIGIN } from "../site";

/** One row of the register: the stored answers plus their evaluation. */
export interface RegisterEntry {
  system: StoredSystem;
  evaluation: Evaluation;
}

/** Whether the finance-only register columns apply (answer 1.12). */
export function includesFinance(system: StoredSystem): boolean {
  return system.answers["1.12"] === "ja";
}

const STATUS_LABEL: Record<ObligationStatus["status"], string> = {
  voldaan: "Voldaan",
  actie: "Actie nodig",
  nvt: "N.v.t.",
  open: "Onbeantwoord",
};

/**
 * Markdown table cell: newlines would end the row, pipes would split it.
 * Free-text answers carry both (the register rows in a table are raw here,
 * unlike the CSV path, which sanitises in registerValueRow).
 */
function cell(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").replace(/\|/g, "\\|");
}

/** Absolute link — the dossier is read outside the app. */
function url(ref: QRef): string {
  return `${SITE_ORIGIN}${ref.href}`;
}

function basis(refs: QRef[] | undefined): string {
  if (!refs || refs.length === 0) return "—";
  return refs.map((r) => `[${cell(r.label)}](${url(r)})`).join(" · ");
}

function moduleOf(questionnaire: Questionnaire, moduleId: string): Module | undefined {
  return questionnaire.modules.find((m) => m.id === moduleId);
}

/**
 * The answers the forward pass actually consumed: visible, answered questions
 * that set a flag or trigger an art. 5 stop. That is the classification's
 * audit trail (~10-25 rows) rather than a reprint of all 205 questions.
 */
export function decisiveAnswers(
  questionnaire: Questionnaire,
  system: StoredSystem,
): { question: Question; moduleNr: number; answer: string }[] {
  const ctx = computeVisibility(questionnaire, system.answers);
  const out: { question: Question; moduleNr: number; answer: string }[] = [];
  for (const m of questionnaire.modules) {
    for (const q of m.questions) {
      if (!q.effects?.length && !q.prohibition) continue;
      if (!ctx.visibleQuestions.has(q.id)) continue;
      const value = system.answers[q.id];
      if (value === undefined || value === "") continue;
      out.push({ question: q, moduleNr: m.nr, answer: answerLabel(q, value) });
    }
  }
  return out;
}

/** Filename stem: "<naam-slug>-<id-prefix>", unique per stored system. */
export function registerDossierSlug(system: StoredSystem): string {
  const slug = (system.name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const id = system.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  return `${slug || "toepassing"}-${id || "0"}`;
}

/** ISO date (UTC) of an epoch millisecond value; the dossier is a document. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The dossier for one system. `nowMs` is injected rather than read from the
 * clock so fixtures are byte-stable.
 */
export function registerDossierMarkdown(
  questionnaire: Questionnaire,
  entry: RegisterEntry,
  nowMs: number,
): string {
  const { system, evaluation } = entry;
  const row = evaluation.registerRow;
  const lines: string[] = [
    `# AI-registerdossier — ${system.name || "Naamloze toepassing"}`,
    "",
    `| | |`,
    `| --- | --- |`,
    `| Systeem-id | \`${cell(system.id)}\` |`,
    `| Aangemaakt | ${isoDate(system.createdAt)} |`,
    `| Laatst bijgewerkt | ${isoDate(system.updatedAt)} |`,
    `| Geëxporteerd op | ${isoDate(nowMs)} |`,
    `| Voortgang beoordeling | ${evaluation.answered} van ${evaluation.total} zichtbare vragen beantwoord |`,
    `| Basis | ${cell(questionnaire.meta.basis)} |`,
    `| Vragenlijst | ${cell(questionnaire.meta.title)} (v${questionnaire.meta.version}, ${questionnaire.meta.updated}) |`,
    "",
  ];

  if (evaluation.stops.length > 0) {
    lines.push(
      `> **STOP — verboden praktijk (art. 5) gesignaleerd bij vraag ${evaluation.stops.join(", ")}.**`,
      "> Niet inzetten, bestaand gebruik staken en direct escaleren naar Legal & Compliance.",
      "",
    );
  }

  lines.push(
    "## Classificatie",
    "",
    "| Veld | Waarde |",
    "| --- | --- |",
    `| Kwalificatie | ${cell(evaluation.kwalificatie || "Nog niet bepaald")} |`,
    `| Rol(len) | ${cell(evaluation.rollen.join(", ") || "Nog niet bepaald")} |`,
    // engine.ts blanks risicoklasse deliberately while nothing is qualified yet
    `| Risicoklasse | ${cell(row.risicoklasse || "Nog niet bepaald")} |`,
    `| Bijlage III-categorie(ën) | ${cell(evaluation.annex3Categorieen.join("; ") || "Geen")} |`,
    `| Bijlage I (productveiligheid) | ${evaluation.annex1 ? "Ja" : "Nee"} |`,
    `| Uitzondering art. 6, lid 3 | ${cell(row.escape ?? "")} |`,
    `| FRIA (art. 27) | ${cell(row.fria_status ?? "")} |`,
    `| Transparantie art. 50 | ${cell(row.transparantie ?? "")} |`,
    `| Openstaande acties | ${cell(row.openacties ?? "")} |`,
    "",
  );

  // ---- obligations, per module, in document order ---------------------------
  lines.push("## Toepasselijke verplichtingen", "");
  if (evaluation.obligations.length === 0) {
    lines.push(
      "_Nog geen verplichtingen bepaald — beantwoord eerst de classificatievragen._",
      "",
    );
  } else {
    for (const mod of questionnaire.modules) {
      const items = evaluation.obligations.filter((o) => o.moduleId === mod.id);
      if (items.length === 0) continue;
      lines.push(
        `### Module ${mod.nr} — ${cell(mod.title)}`,
        "",
        "| Vraag | Status | Basis |",
        "| --- | --- | --- |",
      );
      for (const o of items) {
        lines.push(
          `| **${o.questionId}** ${cell(o.text)} | ${STATUS_LABEL[o.status]} | ${basis(o.refs)} |`,
        );
      }
      lines.push("");
    }
  }

  // ---- open actions ---------------------------------------------------------
  lines.push("## Openstaande acties", "");
  if (evaluation.openActions.length === 0) {
    lines.push("_Geen openstaande acties._", "");
  } else {
    for (const o of evaluation.openActions) {
      const mod = moduleOf(questionnaire, o.moduleId);
      const where = mod ? ` _(module ${mod.nr} — ${cell(mod.title)})_` : "";
      lines.push(`- [ ] **${o.questionId}** ${cell(o.text)}${where} — ${basis(o.refs)}`);
    }
    lines.push("");
  }

  // ---- timeline -------------------------------------------------------------
  if (evaluation.timeline.length > 0) {
    lines.push("## Toepasselijke data", "");
    for (const t of evaluation.timeline) {
      lines.push(`- **${t.date}** — ${cell(t.label)}${t.omnibus ? " _(omnibus)_" : ""}`);
    }
    lines.push(
      "",
      "Data uit de digitale omnibus (PE-CONS 30/26) gelden pas na formele vaststelling en bekendmaking.",
      "",
    );
  }

  // ---- audit trail ----------------------------------------------------------
  const decisive = decisiveAnswers(questionnaire, system);
  lines.push("## Bepalende antwoorden", "");
  if (decisive.length === 0) {
    lines.push("_Nog geen antwoorden die de classificatie bepalen._", "");
  } else {
    lines.push("| Vraag | Antwoord | Basis |", "| --- | --- | --- |");
    for (const d of decisive) {
      lines.push(
        `| **${d.question.id}** ${cell(d.question.text)} | ${cell(d.answer)} | ${basis(d.question.refs)} |`,
      );
    }
    lines.push("");
  }

  // ---- register row ---------------------------------------------------------
  const finance = includesFinance(system);
  lines.push("## Registerrij", "", "| Kolom | Waarde |", "| --- | --- |");
  for (const col of questionnaire.registerColumns) {
    if (col.financeOnly && !finance) continue;
    lines.push(`| ${cell(col.label)} | ${cell(row[col.id] ?? "") || "—"} |`);
  }
  lines.push(
    "",
    "---",
    "",
    cell(questionnaire.meta.disclaimer),
    "",
    `Bron: ${SITE_ORIGIN}/register`,
  );
  return lines.join("\n");
}

/** All systems as one flat CSV — the /register table, spreadsheet-ready. */
export function registerFlatCsv(
  questionnaire: Questionnaire,
  entries: RegisterEntry[],
): string {
  const anyFinance = entries.some((e) => includesFinance(e.system));
  return toCsv([
    registerHeaderRow(questionnaire, anyFinance),
    ...entries.map((e) => registerValueRow(questionnaire, e.evaluation.registerRow, anyFinance)),
  ]);
}

/** Download filename of one dossier. */
export function registerDossierFilename(system: StoredSystem): string {
  return `ai-registerdossier-${registerDossierSlug(system)}.md`;
}
