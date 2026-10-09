import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AssessmentState, StoredSystem } from "../../src/lib/assessment/types.js";
import { BASE_URL, questionnaire } from "./data.js";

/**
 * Assessment state — the one writable surface on this server (roadmap 4.1).
 *
 * Everything else in mcp/ reads a static corpus. This module owns a single
 * JSON file outside the committed tree, holding exactly the blob the
 * legal-workbench drop-zone already carries (`inbox/FORMAT.md`, shape
 * `aiact-assessments`): `{ v: 1, systems: StoredSystem[] }`, byte-compatible
 * with the app's own Export JSON, so a blob can move between localStorage,
 * inbox/ and here without reshaping.
 *
 * Two env vars, both read per call (not cached) so a test harness or a
 * redeployment can repoint the file without a rebuild:
 *
 * - AIACT_ASSESSMENT_STATE — absolute path to the state file. **Unset = the
 *   whole feature is off**: server.ts does not register either tool, which is
 *   what keeps the deployed public read server a 10-tool read surface.
 * - MCP_TOKEN — the credential (the same var http.ts already checks as
 *   `Authorization: Bearer`). Over HTTP the transport rejects first; over
 *   stdio, possession of the env var *is* the credential. Unset ⇒ writes are
 *   refused, never silently accepted.
 */

export const STATE_ENV = "AIACT_ASSESSMENT_STATE";

export const statePath = (): string | undefined => process.env[STATE_ENV] || undefined;

/** Both tools exist only when a state file is configured. */
export const assessmentEnabled = (): boolean => Boolean(statePath());

/** The write gate. Deliberately not a token *comparison*: over HTTP http.ts has
 *  already compared the bearer header, and over stdio there is no header to
 *  compare — having the secret in the environment is the credential. */
export const writeAuthorized = (): boolean => Boolean(process.env.MCP_TOKEN);

const EMPTY: AssessmentState = { v: 1, systems: [] };

/** Missing file = empty state. A *malformed* file throws: silently resetting
 *  someone's stored assessment is the one failure mode worth being loud about. */
export function readState(): AssessmentState {
  const path = statePath();
  if (!path) throw new Error(`${STATE_ENV} is niet gezet.`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY };
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Statusbestand ${path} is geen geldige JSON: ${(e as Error).message}`);
  }
  const state = parsed as AssessmentState;
  if (state?.v !== 1 || !Array.isArray(state.systems)) {
    throw new Error(
      `Statusbestand ${path} heeft niet de vorm {"v":1,"systems":[…]} — handmatig gerepareerd of van een andere bron?`,
    );
  }
  return state;
}

/** tmp + rename: a process that dies mid-write leaves the old file intact. */
export function writeState(state: AssessmentState): void {
  const path = statePath();
  if (!path) throw new Error(`${STATE_ENV} is niet gezet.`);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/**
 * inbox/FORMAT.md §3: an optional bridge envelope may wrap the blob. `bridge`
 * + object `blob` ⇒ enveloped; top-level `v` ⇒ bare; both ⇒ malformed.
 */
export function unwrapEnvelope(input: unknown): { blob: unknown } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "De payload is geen JSON-object." };
  }
  const rec = input as Record<string, unknown>;
  const enveloped = "bridge" in rec && rec.blob !== null && typeof rec.blob === "object";
  const bare = "v" in rec;
  if (enveloped && bare) {
    return {
      error:
        'Malformed: de payload heeft zowel `bridge` als een top-level `v`. Een envelop heeft geen top-level `v`, een kale blob heeft geen `bridge` (inbox/FORMAT.md §3).',
    };
  }
  if (enveloped) {
    if (rec.bridge !== 1) {
      return {
        error: `Onbekende envelopversie bridge=${JSON.stringify(rec.bridge)}; alleen bridge=1 wordt gelezen (inbox/FORMAT.md §6).`,
      };
    }
    return { blob: rec.blob };
  }
  return { blob: rec };
}

// --- validation -------------------------------------------------------------

/** Question id → the values that question accepts ("" = answer cleared;
 *  undefined = free text). Built once at module load from the questionnaire. */
const ALLOWED: Map<string, Set<string> | null> = new Map(
  questionnaire.modules.flatMap((m) =>
    m.questions.map((q): [string, Set<string> | null] => {
      switch (q.answerType) {
        case "choice":
          return [q.id, new Set([...(q.options ?? []).map((o) => o.value), ""])];
        case "janee":
          return [q.id, new Set(["ja", "nee", ""])];
        case "janeenvt":
          return [q.id, new Set(["ja", "nee", "nvt", ""])];
        default:
          return [q.id, null]; // text: any string
      }
    }),
  ),
);

const MAX_REPORTED_ERRORS = 10;

export type Validation =
  | { ok: true; state: AssessmentState }
  | { ok: false; errors: string[]; more: number };

/**
 * Full-blob validation. Two deliberate strictnesses:
 *
 * - a record that fails the id/name/answers shape is *reported*, not dropped.
 *   The app's own import silently discards such records
 *   (src/lib/assessment/store.ts, importStateJson) — inbox/FORMAT.md §6 calls
 *   that "the sharpest failure mode of the whole bridge", and this path must
 *   not reproduce it;
 * - an answer id absent from the current questionnaire is rejected (card 4.1),
 *   where assess.mjs merely reports it as `unknownIds`. Every offending id is
 *   named so the caller can repair the export instead of guessing.
 */
export function validateBlob(input: unknown): Validation {
  const errors: string[] = [];
  const push = (msg: string) => {
    errors.push(msg);
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["De blob is geen JSON-object."], more: 0 };
  }
  const blob = input as Record<string, unknown>;
  // v is a hard stop (FORMAT.md §6): a v:2 blob is a rejected blob, not a newer one.
  if (blob.v !== 1) {
    return {
      ok: false,
      errors: [
        `Verkeerde blobversie: v=${JSON.stringify(blob.v)}, verwacht v=1. Er zijn geen migraties — een blob met een andere v wordt geweigerd, niet omgezet.`,
      ],
      more: 0,
    };
  }
  if (!Array.isArray(blob.systems)) {
    return {
      ok: false,
      errors: ['Ontbrekend of ongeldig veld `systems`: verwacht een array van toepassingen.'],
      more: 0,
    };
  }

  const systems: StoredSystem[] = [];
  const seenIds = new Set<string>();
  blob.systems.forEach((raw, i) => {
    const at = `systeem #${i}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      push(`${at}: geen object.`);
      return;
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec.id !== "string" || rec.id.trim() === "") {
      push(`${at}: veld \`id\` ontbreekt of is geen niet-lege string.`);
      return;
    }
    const label = `systeem ${rec.id}`;
    if (seenIds.has(rec.id)) {
      push(`${label}: komt twee keer voor in dezelfde blob — ids moeten uniek zijn.`);
      return;
    }
    seenIds.add(rec.id);
    if (typeof rec.name !== "string") push(`${label}: veld \`name\` ontbreekt of is geen string.`);
    if (!rec.answers || typeof rec.answers !== "object" || Array.isArray(rec.answers)) {
      push(`${label}: veld \`answers\` ontbreekt of is geen object.`);
      return;
    }
    for (const [qid, value] of Object.entries(rec.answers as Record<string, unknown>)) {
      if (typeof value !== "string") {
        push(`${label} · antwoord ${qid}: waarde is ${typeof value}, verwacht een string.`);
        continue;
      }
      if (!ALLOWED.has(qid)) {
        push(
          `${label} · antwoord ${qid}: onbekende vraag-id. Gebruik get_questionnaire voor de geldige ids.`,
        );
        continue;
      }
      const allowed = ALLOWED.get(qid);
      if (allowed && !allowed.has(value)) {
        push(
          `${label} · antwoord ${qid}: waarde ${JSON.stringify(value)} is geen geldige optie — verwacht ` +
            `${[...allowed].map((v) => (v === "" ? '"" (leeg = niet beantwoord)' : `"${v}"`)).join(" · ")}.`,
        );
      }
    }
    for (const stamp of ["createdAt", "updatedAt"] as const) {
      if (rec[stamp] !== undefined && typeof rec[stamp] !== "number") {
        push(`${label}: \`${stamp}\` is geen getal (epoch-ms). Laat het weg als het onbekend is.`);
      }
    }
    if (typeof rec.name === "string") systems.push(rec as unknown as StoredSystem);
  });

  if (errors.length) {
    return {
      ok: false,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      more: Math.max(0, errors.length - MAX_REPORTED_ERRORS),
    };
  }
  return { ok: true, state: { v: 1, systems } };
}

// --- merge ------------------------------------------------------------------

export interface MergeResult {
  merged: AssessmentState;
  added: string[];
  updated: string[];
  untouched: string[];
}

/**
 * Upsert by id, incoming wins — identical to importStateJson in
 * src/lib/assessment/store.ts, so a blob written through MCP and the same blob
 * imported in the browser land the same way. **Omission never deletes**
 * (inbox/FORMAT.md §8): a record absent from the submitted blob survives.
 */
export function mergeById(stored: AssessmentState, incoming: AssessmentState): MergeResult {
  const byId = new Map(stored.systems.map((s) => [s.id, s]));
  const added: string[] = [];
  const updated: string[] = [];
  for (const s of incoming.systems) {
    (byId.has(s.id) ? updated : added).push(s.id);
    byId.set(s.id, s);
  }
  const touched = new Set([...added, ...updated]);
  return {
    merged: { v: 1, systems: [...byId.values()] },
    added,
    updated,
    untouched: stored.systems.map((s) => s.id).filter((id) => !touched.has(id)),
  };
}

// --- rendering --------------------------------------------------------------

const iso = (ms: unknown): string =>
  typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "onbekend";

/** "1 toepassing" / "3 toepassingen" */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Markdown view of the stored state, with the exact blob appended in a fenced
 * JSON block so a caller can round-trip it byte-comparably (that is the point
 * of the read tool: pull, reason, put back). The block is dropped — with a
 * notice — when the state is too large for a single tool result.
 */
export function renderAssessment(
  state: AssessmentState,
  opts: { system?: string; maxChars: number },
): string {
  const wanted = opts.system?.trim().toLowerCase();
  const systems = wanted
    ? state.systems.filter(
        (s) => s.id.toLowerCase() === wanted || s.name.toLowerCase().includes(wanted),
      )
    : state.systems;

  const head = [
    `# Assessmentstatus — ${plural(systems.length, "toepassing", "toepassingen")}` +
      (wanted ? ` (filter: ${opts.system})` : ""),
    "",
    `Opgeslagen blob (vorm \`aiact-assessments\`, v${state.v}) in het statusbestand van deze server; ` +
      "identiek aan de Export JSON van de zelfbeoordeling.",
    "",
    `> Antwoorden, geen conclusies: risicoklasse, rollen en verplichtingenstatus worden opnieuw berekend en staan niet in de blob. Reken ze uit op ${BASE_URL}/assessment.`,
  ];

  if (!systems.length) {
    head.push(
      "",
      wanted
        ? `Geen toepassing met id of naam "${opts.system}". Opgeslagen ids: ${
            state.systems.map((s) => s.id).join(", ") || "geen"
          }.`
        : "Er is nog niets opgeslagen. Schrijf een volledige v1-blob met put_assessment.",
      "",
      `Zelfbeoordeling: ${BASE_URL}/assessment`,
    );
    return head.join("\n");
  }

  head.push("");
  for (const s of systems) {
    head.push(
      `- **${s.name}** \`${s.id}\` — ${plural(Object.keys(s.answers ?? {}).length, "antwoord", "antwoorden")}` +
        ` · aangemaakt ${iso(s.createdAt)} · bijgewerkt ${iso(s.updatedAt)}`,
    );
  }
  head.push("", `Zelfbeoordeling: ${BASE_URL}/assessment`, "");

  const prose = head.join("\n");
  const json = JSON.stringify(wanted ? { v: state.v, systems } : state, null, 2);
  if (prose.length + json.length + 20 > opts.maxChars) {
    return (
      `${prose}\n> **Omvang:** de blob zelf is ${json.length} tekens en is hier weggelaten ` +
      `(plafond ${opts.maxChars} tekens, env MCP_MAX_RESULT_CHARS). Vraag één toepassing op met ` +
      "`system`, of lees het statusbestand rechtstreeks."
    );
  }
  return `${prose}\`\`\`json\n${json}\n\`\`\``;
}
