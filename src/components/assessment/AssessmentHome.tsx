"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Download, Plus, Trash2, Upload } from "lucide-react";
import { getQuestionnaire } from "@/lib/assessment/data";
import { evaluate, riskLabel } from "@/lib/assessment/engine";
import {
  createSystem,
  deleteSystem,
  exportStateJson,
  importStateJson,
  useAssessments,
} from "@/lib/assessment/store";

function downloadFile(name: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // revoke async: a synchronous revoke can abort the pending blob download
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function AssessmentHome() {
  const systems = useAssessments();
  const router = useRouter();
  const [name, setName] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const questionnaire = getQuestionnaire();

  const start = () => {
    const system = createSystem(name);
    router.push(`/assessment/vragenlijst?sys=${system.id}`);
  };

  const onImport = async (file: File) => {
    const n = importStateJson(await file.text());
    setImportMsg(n < 0 ? "Ongeldig bestand." : `${n} beoordeling(en) geïmporteerd.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-muted">
            Naam van de AI-toepassing
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder="Bijv. Kredietscoringsmodule leningaanvragen"
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={start}
          className="flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white dark:text-background"
        >
          <Plus className="size-4" /> Nieuwe beoordeling
        </button>
      </div>

      {systems.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Toepassing</th>
                <th className="px-3 py-2 font-medium">Risicoklasse</th>
                <th className="px-3 py-2 font-medium">Voortgang</th>
                <th className="px-3 py-2 font-medium">Laatst gewijzigd</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => {
                const e = evaluate(questionnaire, s.answers);
                return (
                  <tr key={s.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/assessment/vragenlijst?sys=${s.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{riskLabel(e.riskClass)}</td>
                    <td className="px-3 py-2 text-muted">
                      {e.answered}/{e.total}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {new Date(s.updatedAt).toLocaleDateString("nl-NL")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-2">
                        <Link
                          href={`/assessment/resultaat?sys=${s.id}`}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <ClipboardList className="size-3.5" /> Resultaat
                        </Link>
                        <button
                          type="button"
                          aria-label={`Verwijder ${s.name}`}
                          onClick={() => {
                            if (window.confirm(`Beoordeling "${s.name}" verwijderen?`))
                              deleteSystem(s.id);
                          }}
                          className="text-muted hover:text-red-600"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() =>
            downloadFile("ai-assessments.json", "application/json", exportStateJson())
          }
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
        >
          <Download className="size-3.5" /> Back-up (JSON)
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-muted hover:text-foreground"
        >
          <Upload className="size-3.5" /> Importeer back-up
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImport(f);
            e.target.value = "";
          }}
        />
        {importMsg && <span className="text-muted">{importMsg}</span>}
      </div>
    </div>
  );
}
