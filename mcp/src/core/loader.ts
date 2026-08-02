/**
 * Startup data loading and input normalisation — the mechanism, not the data.
 * Which files an explorer reads, and from where, stays in its own `data.ts`.
 */
import { readFileSync } from "node:fs";

/** Read one JSON file synchronously at startup; a missing file must throw. */
export function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** BASE_URL from the environment, trailing slash stripped, with a per-repo default. */
export function baseUrlFromEnv(defaultUrl: string): string {
  return (process.env.BASE_URL ?? defaultUrl).replace(/\/$/, "");
}

/** "Artikel 6" / " 6 " → "6". */
export function normalizeArticleInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^artikel\s*/, "")
    .replace(/[\s\-–]+/g, "");
}
