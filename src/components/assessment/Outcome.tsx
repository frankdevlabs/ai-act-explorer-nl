"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Copy } from "lucide-react";
import { getQuestionnaire } from "@/lib/assessment/data";
import {
  evaluate,
  registerHeaderRow,
  registerValueRow,
  toTsv,
} from "@/lib/assessment/engine";
import { useAssessments } from "@/lib/assessment/store";
import type { ObligationStatus } from "@/lib/assessment/types";
import { formatDate, Panel, RefRow, RiskBadge, type Previews } from "./shared";

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const STATUS_STYLE: Record<ObligationStatus["status"], string> = {
  voldaan: "border-green-600/50 text-green-700 dark:text-green-400",
  actie: "border-red-600/50 text-red-700 dark:text-red-400",
  nvt: "border-line text-muted",
  open: "border-orange-600/50 text-orange-700 dark:text-orange-400",
};

const STATUS_LABEL: Record<ObligationStatus["status"], string> = {
  voldaan: "Voldaan",
  actie: "Actie nodig",
  nvt: "N.v.t.",
  open: "Onbeantwoord",
};

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-muted hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      {copied ? "Gekopieerd" : label}
    </button>
  );
}

export function Outcome({ previews }: { previews: Previews }) {
  const mounted = useMounted();
  const params = useSearchParams();
  const systems = useAssessments();
  const questionnaire = getQuestionnaire();
  const system = systems.find((s) => s.id === (params.get("sys") ?? ""));
  const answers = useMemo(() => system?.answers ?? {}, [system]);
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

  const includeFinance = answers["1.12"] === "ja";
  const columns = questionnaire.registerColumns.filter((c) => includeFinance || !c.financeOnly);
  const tsvRow = () =>
    toTsv([registerValueRow(questionnaire, evaluation.registerRow, includeFinance)]);
  const tsvWithHeader = () =>
    toTsv([
      registerHeaderRow(questionnaire, includeFinance),
      registerValueRow(questionnaire, evaluation.registerRow, includeFinance),
    ]);

  const byModule = new Map<string, ObligationStatus[]>();
  for (const o of evaluation.obligations) {
    (byModule.get(o.moduleId) ?? byModule.set(o.moduleId, []).get(o.moduleId)!).push(o);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{system.name}</h1>
          <p className="text-xs text-muted">
            {evaluation.answered} van {evaluation.total} vragen beantwoord
            {evaluation.answered < evaluation.total && " — resultaat is voorlopig"}
          </p>
        </div>
        <RiskBadge risk={evaluation.riskClass} />
      </div>

      {evaluation.stops.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-600/60 bg-red-600/5 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Verboden praktijk gesignaleerd (vraag {evaluation.stops.join(", ")}): niet inzetten,
            bestaand gebruik staken en direct escaleren naar Legal &amp; Compliance.
          </span>
        </div>
      )}

      <Panel title="Classificatie">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Kwalificatie</dt>
            <dd>{evaluation.kwalificatie || "Nog niet bepaald"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Rol(len)</dt>
            <dd>{evaluation.rollen.join(", ") || "Nog niet bepaald"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Bijlage III-categorie(ën)</dt>
            <dd>{evaluation.annex3Categorieen.join("; ") || "Geen"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Bijlage I (productveiligheid)</dt>
            <dd>{evaluation.annex1 ? "Ja" : "Nee"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Uitzondering art. 6, lid 3</dt>
            <dd>{evaluation.registerRow.escape}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">FRIA (art. 27)</dt>
            <dd>{evaluation.registerRow.fria_status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Transparantie art. 50</dt>
            <dd>{evaluation.registerRow.transparantie}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Openstaande acties</dt>
            <dd>{evaluation.registerRow.openacties}</dd>
          </div>
        </dl>
      </Panel>

      {evaluation.timeline.length > 0 && (
        <Panel title="Toepasselijke data">
          <ul className="space-y-2 text-sm">
            {evaluation.timeline.map((t) => (
              <li key={`${t.date}-${t.label}`} className="flex gap-3">
                <span className="w-36 shrink-0 font-mono text-xs text-muted">
                  {formatDate(t.date)}
                </span>
                <span className="min-w-0 break-words">
                  {t.label}
                  {t.omnibus && (
                    <span className="ml-2 rounded border border-accent/40 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      omnibus
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Data uit de digitale omnibus (PE-CONS 30/26) gelden pas na formele vaststelling en
            bekendmaking.{" "}
            <Link href="/wijzigingen" className="text-accent hover:underline">
              Bekijk de omnibus-wijzigingen
            </Link>
            .
          </p>
        </Panel>
      )}

      {evaluation.obligations.length > 0 && (
        <Panel title="Verplichtingen-checklist">
          <div className="space-y-4">
            {questionnaire.modules
              .filter((m) => byModule.has(m.id))
              .map((m) => (
                <div key={m.id}>
                  <h3 className="mb-2 text-xs font-semibold text-muted">
                    Module {m.nr} — {m.title}
                  </h3>
                  <ul className="space-y-2">
                    {byModule.get(m.id)!.map((o) => (
                      <li key={o.questionId} className="flex items-start gap-3 text-sm">
                        <span
                          className={`mt-0.5 w-28 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-medium ${STATUS_STYLE[o.status]}`}
                        >
                          {STATUS_LABEL[o.status]}
                        </span>
                        <span className="min-w-0 break-words">
                          <span className="mr-2 font-mono text-xs text-muted">{o.questionId}</span>
                          {o.text}
                          <RefRow refs={o.refs} previews={previews} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </Panel>
      )}

      <Panel title="Registerrij">
        <p className="mb-3 text-xs text-muted">
          Kopieer deze rij en plak hem in het{" "}
          <Link href="/register" className="text-accent hover:underline">
            AI-registersjabloon
          </Link>{" "}
          (Google Sheets/Excel: plakken op de eerstvolgende lege rij).
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <CopyButton label="Kopieer registerrij (TSV)" getText={tsvRow} />
          <CopyButton label="Kopieer met kopregel" getText={tsvWithHeader} />
        </div>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-xs">
            <tbody>
              {columns.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0">
                  <th className="w-56 bg-surface px-3 py-1.5 text-left font-medium text-muted">
                    {c.label}
                  </th>
                  <td className="px-3 py-1.5">{evaluation.registerRow[c.id] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex items-center justify-between">
        <Link
          href={`/assessment/vragenlijst?sys=${system.id}`}
          className="flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Terug naar de vragenlijst
        </Link>
        <Link href="/register" className="text-sm text-accent hover:underline">
          Naar het AI-register →
        </Link>
      </div>
    </div>
  );
}
