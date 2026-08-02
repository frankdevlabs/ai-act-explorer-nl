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
import {
  includesFinance,
  registerDossierFilename,
  registerDossierMarkdown,
  registerFlatCsv,
  type RegisterEntry,
} from "@/lib/register/export";

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

  const rows: RegisterEntry[] = useMemo(
    () => systems.map((s) => ({ system: s, evaluation: evaluate(questionnaire, s.answers) })),
    [systems, questionnaire],
  );

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

  const downloadDossier = (entry: RegisterEntry) =>
    downloadFile(
      registerDossierFilename(entry.system),
      "text/markdown;charset=utf-8",
      registerDossierMarkdown(questionnaire, entry, Date.now()),
    );

  // One file per system; Chrome throttles bursts of downloads, so stagger them.
  const downloadAllDossiers = () => {
    const now = Date.now();
    rows.forEach((entry, i) => {
      setTimeout(() => {
        downloadFile(
          registerDossierFilename(entry.system),
          "text/markdown;charset=utf-8",
          registerDossierMarkdown(questionnaire, entry, now),
        );
      }, i * 150);
    });
  };

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
            {rows.map((entry) => (
              <tr key={entry.system.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/assessment/resultaat?sys=${entry.system.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {entry.system.name}
                  </Link>
                </td>
                <td className="px-3 py-2">{entry.evaluation.registerRow.risicoklasse || "—"}</td>
                <td className="px-3 py-2">{entry.evaluation.registerRow.rollen || "—"}</td>
                <td className="px-3 py-2">{entry.evaluation.registerRow.besluit || "—"}</td>
                <td className="px-3 py-2 text-muted">{entry.evaluation.registerRow.openacties}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <RowCopy
                      getText={() =>
                        toTsv([
                          registerValueRow(
                            questionnaire,
                            entry.evaluation.registerRow,
                            includesFinance(entry.system),
                          ),
                        ])
                      }
                    />
                    <button
                      type="button"
                      title="Download het dossier van deze toepassing (Markdown)"
                      onClick={() => downloadDossier(entry)}
                      className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      <Download className="size-3.5" /> Dossier (.md)
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={() =>
            downloadFile(
              "ai-register.csv",
              "text/csv;charset=utf-8",
              registerFlatCsv(questionnaire, rows),
            )
          }
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
        >
          <Download className="size-3.5" /> Alle rijen (CSV)
        </button>
        <button
          type="button"
          onClick={downloadAllDossiers}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
        >
          <Download className="size-3.5" /> Alle dossiers ({rows.length} × .md)
        </button>
      </div>
      <p className="text-xs text-muted">
        Het dossier is een deelbaar Markdown-document per toepassing: classificatie, de
        toepasselijke verplichtingen met een link naar het artikel/lid dat elke verplichting
        draagt, de openstaande acties en de antwoorden waarop de classificatie berust.
      </p>
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
