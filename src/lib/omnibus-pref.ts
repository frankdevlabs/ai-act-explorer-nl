"use client";

import { useSyncExternalStore } from "react";

/**
 * Global "show omnibus track changes" preference. Tiny external store over
 * localStorage: same-tab reactivity via a custom event, cross-tab via the
 * native "storage" event. Key/format predate this module — keep them.
 */
const KEY = "omnibus-diff";
const EVENT = "aiact:omnibus-diff";

export function getSnapshot(): boolean {
  return localStorage.getItem(KEY) === "1";
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

export function setOmnibusDiff(v: boolean): void {
  localStorage.setItem(KEY, v ? "1" : "0");
  window.dispatchEvent(new Event(EVENT));
}

export function useOmnibusDiff(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
