"use client";

import { useSyncExternalStore } from "react";
import type { AssessmentState, StoredSystem } from "./types";

/**
 * Persistent assessment store: every assessed system lives as one entry in a
 * single versioned localStorage blob. Nothing ever leaves the browser.
 * Reactivity pattern identical to tabs.ts: custom event for same-tab updates,
 * native "storage" event for cross-tab.
 */

const KEY = "aiact-assessments";
const EVENT = "aiact:assessments";
const VERSION = 1;

const EMPTY: readonly StoredSystem[] = Object.freeze([]);

let cachedRaw: string | null = null;
let cachedSystems: readonly StoredSystem[] = EMPTY;

function parse(raw: string | null): readonly StoredSystem[] {
  if (raw === null) return EMPTY;
  try {
    const data = JSON.parse(raw) as AssessmentState;
    if (data?.v !== VERSION || !Array.isArray(data.systems)) return EMPTY;
    return Object.freeze(data.systems);
  } catch {
    return EMPTY;
  }
}

export function getSnapshot(): readonly StoredSystem[] {
  const raw = localStorage.getItem(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSystems = parse(raw);
  }
  return cachedSystems;
}

function write(systems: readonly StoredSystem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, systems }));
  } catch {
    // Quota exceeded / storage unavailable: assessment simply doesn't persist.
  }
  window.dispatchEvent(new Event(EVENT));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `sys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSystem(name: string): StoredSystem {
  const system: StoredSystem = {
    id: newId(),
    name: name.trim() || "Naamloze toepassing",
    answers: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  write([...getSnapshot(), system]);
  return system;
}

export function getSystem(id: string): StoredSystem | undefined {
  return getSnapshot().find((s) => s.id === id);
}

export function setAnswer(id: string, questionId: string, value: string): void {
  write(
    getSnapshot().map((s) =>
      s.id === id
        ? {
            ...s,
            // Answer 1.1 doubles as the display name so list and register stay in sync.
            name: questionId === "1.1" && value.trim() !== "" ? value.trim() : s.name,
            answers: { ...s.answers, [questionId]: value },
            updatedAt: Date.now(),
          }
        : s,
    ),
  );
}

export function deleteSystem(id: string): void {
  write(getSnapshot().filter((s) => s.id !== id));
}

export function exportStateJson(): string {
  return JSON.stringify({ v: VERSION, systems: getSnapshot() }, null, 2);
}

/**
 * Import a previously exported JSON dump. Merges by id (imported entries win);
 * returns the number of systems imported, or -1 when the payload is invalid.
 */
export function importStateJson(json: string): number {
  let incoming: readonly StoredSystem[];
  try {
    const data = JSON.parse(json) as AssessmentState;
    if (data?.v !== VERSION || !Array.isArray(data.systems)) return -1;
    incoming = data.systems.filter(
      (s) => typeof s?.id === "string" && typeof s?.name === "string" && typeof s?.answers === "object",
    );
  } catch {
    return -1;
  }
  const byId = new Map(getSnapshot().map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  write([...byId.values()]);
  return incoming.length;
}

export function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAssessments(): readonly StoredSystem[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
