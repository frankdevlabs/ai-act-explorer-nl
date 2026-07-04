"use client";

import { useSyncExternalStore } from "react";

/**
 * Persistent "open document tabs" store (browser-tab metaphor): visiting an
 * article/recital/annex upserts a tab; tabs survive reloads via localStorage.
 * Same-tab reactivity via a custom event, cross-tab via the native "storage"
 * event (same shape as omnibus-pref.ts).
 */
export interface TabEntry {
  href: string;
  label: string;
  title?: string;
  /** Last-visit timestamp; LRU eviction key. */
  at: number;
}

const KEY = "aiact-tabs";
const EVENT = "aiact:tabs";
const VERSION = 1;
const MAX_TABS = 8;

const EMPTY: readonly TabEntry[] = Object.freeze([]);

// getSnapshot must return a referentially stable value or useSyncExternalStore
// re-renders forever; cache the parsed array keyed on the raw storage string.
let cachedRaw: string | null = null;
let cachedTabs: readonly TabEntry[] = EMPTY;

function parse(raw: string | null): readonly TabEntry[] {
  if (raw === null) return EMPTY;
  try {
    const data = JSON.parse(raw);
    // Version gate: unknown/corrupt data resets to empty, never migrates.
    if (data?.v !== VERSION || !Array.isArray(data.tabs)) return EMPTY;
    return Object.freeze(data.tabs as TabEntry[]);
  } catch {
    return EMPTY;
  }
}

export function getSnapshot(): readonly TabEntry[] {
  const raw = localStorage.getItem(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTabs = parse(raw);
  }
  return cachedTabs;
}

function write(tabs: readonly TabEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, tabs }));
  } catch {
    // Quota exceeded / storage unavailable: tabs simply don't persist.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Inline-script version of visitTab for pre-hydration registration: the
 * returned IIFE runs at HTML parse time, so a visit is recorded even when the
 * page is left before React hydrates. Keep the logic in sync with visitTab.
 */
export function visitTabScript(tab: { href: string; label: string; title?: string }): string {
  const json = JSON.stringify(tab).replace(/</g, "\\u003c");
  return (
    `(function(){try{var t=${json};t.at=Date.now();` +
    `var d={v:1,tabs:[]};` +
    `try{var r=JSON.parse(localStorage.getItem("aiact-tabs"));` +
    `if(r&&r.v===1&&Array.isArray(r.tabs))d=r}catch(e){}` +
    `var i=-1;for(var j=0;j<d.tabs.length;j++)if(d.tabs[j].href===t.href){i=j;break}` +
    `if(i>=0)d.tabs[i]=t;else{d.tabs.push(t);` +
    `while(d.tabs.length>8){var m=0;for(var k=1;k<d.tabs.length;k++)` +
    `if(d.tabs[k].at<d.tabs[m].at)m=k;d.tabs.splice(m,1)}}` +
    `localStorage.setItem("aiact-tabs",JSON.stringify(d));` +
    `window.dispatchEvent(new Event("aiact:tabs"))}catch(e){}})()`
  );
}

export function visitTab(tab: { href: string; label: string; title?: string }): void {
  const tabs = getSnapshot();
  const entry: TabEntry = { ...tab, at: Date.now() };
  const idx = tabs.findIndex((t) => t.href === tab.href);
  let next: TabEntry[];
  if (idx >= 0) {
    // Revisit: refresh label/title/at but keep position (no reorder).
    next = tabs.slice();
    next[idx] = entry;
  } else {
    next = [...tabs, entry];
    while (next.length > MAX_TABS) {
      let lru = 0;
      for (let i = 1; i < next.length; i++) if (next[i].at < next[lru].at) lru = i;
      next.splice(lru, 1);
    }
  }
  write(next);
}

export function closeTab(href: string): void {
  write(getSnapshot().filter((t) => t.href !== href));
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

export function useTabs(): readonly TabEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
