"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { getQuestionnaire } from "@/lib/assessment/data";
import { computeVisibility, evaluate } from "@/lib/assessment/engine";
import { setAnswer, useAssessments } from "@/lib/assessment/store";
import type { Module, Question } from "@/lib/assessment/types";
import { OmnibusBadge, Panel, RefRow, type Previews } from "./shared";

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function AnswerInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  if (question.answerType === "text") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="mt-2 w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
      />
    );
  }
  const options =
    question.answerType === "choice"
      ? (question.options ?? [])
      : question.answerType === "janeenvt"
        ? [
            { value: "ja", label: "Ja" },
            { value: "nee", label: "Nee" },
            { value: "nvt", label: "N.v.t." },
          ]
        : [
            { value: "ja", label: "Ja" },
            { value: "nee", label: "Nee" },
          ];
  return (
    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={question.id}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(active ? "" : o.value)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              active
                ? "border-accent bg-accent/10 font-medium text-accent"
                : "border-line text-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ModuleStep({
  module,
  answers,
  visibleQuestions,
  systemId,
  previews,
}: {
  module: Module;
  answers: Record<string, string>;
  visibleQuestions: Set<string>;
  systemId: string;
  previews: Previews;
}) {
  const questions = module.questions.filter((q) => visibleQuestions.has(q.id));
  return (
    <div className="space-y-4">
      {module.intro && <p className="text-sm text-muted">{module.intro}</p>}
      {module.omnibus && (
        <OmnibusBadge appliesFrom={module.omnibus.appliesFrom} note={module.omnibus.note} />
      )}
      {module.refs && <RefRow refs={module.refs} previews={previews} />}
      {questions.map((q) => {
        const value = answers[q.id] ?? "";
        const stop = q.prohibition && value === "ja";
        return (
          <div
            key={q.id}
            className={`rounded-lg border p-4 ${
              stop ? "border-red-600/60 bg-red-600/5" : "border-line bg-surface"
            }`}
          >
            <p className="text-sm">
              <span className="mr-2 font-mono text-xs text-muted">{q.id}</span>
              {q.text}
            </p>
            {q.help && <p className="mt-1 text-xs leading-relaxed text-muted">{q.help}</p>}
            <RefRow refs={q.refs} previews={previews} />
            {q.omnibus && (
              <OmnibusBadge appliesFrom={q.omnibus.appliesFrom} note={q.omnibus.note} />
            )}
            <AnswerInput question={q} value={value} onChange={(v) => setAnswer(systemId, q.id, v)} />
            {stop && (
              <p className="mt-2 flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-400">
                <AlertTriangle className="size-4 shrink-0" />
                Verboden praktijk (art. 5): niet inzetten, bestaand gebruik staken en direct
                escaleren naar Legal &amp; Compliance.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Wizard({ previews }: { previews: Previews }) {
  const mounted = useMounted();
  const params = useSearchParams();
  const systems = useAssessments();
  const questionnaire = getQuestionnaire();
  const sysId = params.get("sys") ?? "";
  const system = systems.find((s) => s.id === sysId);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);

  const answers = useMemo(() => system?.answers ?? {}, [system]);
  const ctx = useMemo(() => computeVisibility(questionnaire, answers), [questionnaire, answers]);
  const evaluation = useMemo(() => evaluate(questionnaire, answers), [questionnaire, answers]);

  if (!mounted) return <div className="py-12 text-center text-sm text-muted">Laden…</div>;
  if (!system) {
    return (
      <div className="py-12 text-center text-sm text-muted">
        Beoordeling niet gevonden.{" "}
        <Link href="/assessment" className="text-accent hover:underline">
          Terug naar het overzicht
        </Link>
        .
      </div>
    );
  }

  const visibleModules = questionnaire.modules.filter((m) => ctx.visibleModules.has(m.id));
  const moduleDone = (m: Module) =>
    m.questions.filter((q) => ctx.visibleQuestions.has(q.id)).every((q) => (answers[q.id] ?? "") !== "");
  const active =
    visibleModules.find((m) => m.id === activeModuleId) ??
    visibleModules.find((m) => !moduleDone(m)) ??
    visibleModules[visibleModules.length - 1];
  const activeIdx = visibleModules.findIndex((m) => m.id === active.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{system.name}</h1>
          <p className="text-xs text-muted">
            {evaluation.answered} van {evaluation.total} vragen beantwoord
          </p>
        </div>
        <Link
          href={`/assessment/resultaat?sys=${system.id}`}
          className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-accent hover:border-accent"
        >
          Naar resultaat <ArrowRight className="size-4" />
        </Link>
      </div>

      {evaluation.stops.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-600/60 bg-red-600/5 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Eén of meer antwoorden wijzen op een verboden praktijk (vraag{" "}
            {evaluation.stops.join(", ")}). Rond de beoordeling af voor het dossier, maar zet de
            toepassing niet in.
          </span>
        </div>
      )}

      <nav className="flex flex-wrap gap-1.5" aria-label="Modules">
        {visibleModules.map((m) => {
          const done = moduleDone(m);
          const current = m.id === active.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setActiveModuleId(m.id)}
              title={m.title}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                current
                  ? "border-accent bg-accent/10 font-medium text-accent"
                  : "border-line text-muted hover:text-foreground"
              }`}
            >
              {done && <CheckCircle2 className="size-3 text-green-600 dark:text-green-400" />}
              {m.nr}
            </button>
          );
        })}
      </nav>

      <Panel title={`Module ${active.nr} — ${active.title}`}>
        <ModuleStep
          module={active}
          answers={answers}
          visibleQuestions={ctx.visibleQuestions}
          systemId={system.id}
          previews={previews}
        />
      </Panel>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={activeIdx <= 0}
          onClick={() => setActiveModuleId(visibleModules[activeIdx - 1].id)}
          className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-muted enabled:hover:text-foreground disabled:opacity-40"
        >
          <ArrowLeft className="size-4" /> Vorige
        </button>
        {activeIdx < visibleModules.length - 1 ? (
          <button
            type="button"
            onClick={() => setActiveModuleId(visibleModules[activeIdx + 1].id)}
            className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white dark:text-background"
          >
            Volgende <ArrowRight className="size-4" />
          </button>
        ) : (
          <Link
            href={`/assessment/resultaat?sys=${system.id}`}
            className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white dark:text-background"
          >
            Afronden — naar resultaat <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
