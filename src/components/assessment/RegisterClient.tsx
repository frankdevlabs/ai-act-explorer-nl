"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, Copy, Download } from "lucide-react";
import { getQuestionnaire } from "@/lib/assessment/data";
import {
  evaluate,
  registerHeaderRow,
  registerValueRow,
  toCsv,
  toTsv,
} from "@/lib/assessment/engine";
import { useAssessments } from "@/lib/assessment/store";

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function downloadFile(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // revoke async: a synchronous revoke can abort the pending blob download
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function RowCopy({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Kopieer als registerrij (TSV)"
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Gekopieerd" : "Kopieer rij"}
    </button>
  );
}

export function RegisterClient() {
  const mounted = useMounted();
  const systems = useAssessments();
  const questionnaire = getQuestionnaire();

  const rows = useMemo(
    () =>
      systems.map((s) => ({
        system: s,
        evaluation: evaluate(questionnaire, s.answers),
        includeFinance: s.answers["1.12"] === "ja",
      })),
    [systems, questionnaire],
  );
  const anyFinance = rows.some((r) => r.includeFinance);

  if (!mounted) return null;
  if (systems.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
        Nog geen beoordelingen in deze browser.{" "}
        <Link href="/assessment" className="text-accent hover:underline">
          Start een beoordeling
        </Link>{" "}
        om het register te vullen.
      </p>
    );
  }

  const allRows = () => [
    registerHeaderRow(questionnaire, anyFinance),
    ...rows.map((r) => registerValueRow(questionnaire, r.evaluation.registerRow, anyFinance)),
  ];

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Toepassing</th>
              <th className="px-3 py-2 font-medium">Risicoklasse</th>
              <th className="px-3 py-2 font-medium">Rol</th>
              <th className="px-3 py-2 font-medium">Besluit</th>
              <th className="px-3 py-2 font-medium">Open acties</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ system, evaluation, includeFinance }) => (
              <tr key={system.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/assessment/resultaat?sys=${system.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {system.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{evaluation.registerRow.risicoklasse || "—"}</td>
                <td className="px-3 py-2">{evaluation.registerRow.rollen || "—"}</td>
                <td className="px-3 py-2">{evaluation.registerRow.besluit || "—"}</td>
                <td className="px-3 py-2 text-muted">{evaluation.registerRow.openacties}</td>
                <td className="px-3 py-2 text-right">
                  <RowCopy
                    getText={() =>
                      toTsv([
                        registerValueRow(questionnaire, evaluation.registerRow, includeFinance),
                      ])
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={() => downloadFile("ai-register.csv", "text/csv;charset=utf-8", toCsv(allRows()))}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
        >
          <Download className="size-3.5" /> Alle rijen (CSV)
        </button>
      </div>
    </div>
  );
}

export function TemplateDownload() {
  const questionnaire = getQuestionnaire();
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <button
        type="button"
        onClick={() =>
          downloadFile(
            "ai-register-sjabloon.csv",
            "text/csv;charset=utf-8",
            toCsv([registerHeaderRow(questionnaire, true)]),
          )
        }
        className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
      >
        <Download className="size-3.5" /> Leeg sjabloon (CSV, alle kolommen)
      </button>
      <button
        type="button"
        onClick={() =>
          downloadFile(
            "ai-register-sjabloon-basis.csv",
            "text/csv;charset=utf-8",
            toCsv([registerHeaderRow(questionnaire, false)]),
          )
        }
        className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
      >
        <Download className="size-3.5" /> Leeg sjabloon (CSV, zonder sectorkolommen)
      </button>
    </div>
  );
}
