"use client";

import type { ReactNode } from "react";
import { RefLink } from "@/components/content/RefLink";
import type { RefPreview } from "@/lib/data";
import type { QRef, RiskClass } from "@/lib/assessment/types";
import { riskLabel } from "@/lib/assessment/engine";

export type Previews = Record<string, RefPreview>;

const MONTHS = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function RefRow({ refs, previews }: { refs?: QRef[]; previews: Previews }) {
  if (!refs || refs.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      {refs.map((ref, i) => (
        <span key={ref.href}>
          {i > 0 && " · "}
          <RefLink
            href={ref.href}
            title={previews[ref.href]?.title}
            snippet={previews[ref.href]?.snippet}
          >
            {ref.label}
          </RefLink>
        </span>
      ))}
    </p>
  );
}

export function OmnibusBadge({
  appliesFrom,
  note,
}: {
  appliesFrom?: string;
  note: string;
}) {
  return (
    <div className="mt-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-xs">
      <span className="font-semibold text-accent">
        Omnibus{appliesFrom ? ` — vanaf ${formatDate(appliesFrom)}` : ""}
      </span>{" "}
      <span className="text-muted">{note}</span>
    </div>
  );
}

const RISK_STYLE: Record<RiskClass, string> = {
  "geen-ai": "border-line bg-surface text-muted",
  verboden: "border-red-600/50 bg-red-600/10 text-red-700 dark:text-red-400",
  hoogrisico: "border-orange-600/50 bg-orange-600/10 text-orange-700 dark:text-orange-400",
  transparantierisico: "border-accent/50 bg-accent/10 text-accent",
  minimaal: "border-green-600/50 bg-green-600/10 text-green-700 dark:text-green-400",
};

export function RiskBadge({ risk }: { risk: RiskClass }) {
  return (
    <span
      className={`inline-block rounded-full border px-3 py-0.5 text-sm font-medium ${RISK_STYLE[risk]}`}
    >
      {riskLabel(risk)}
    </span>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      {title && <h2 className="mb-3 text-sm font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  );
}
