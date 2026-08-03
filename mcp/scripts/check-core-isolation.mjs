/**
 * mcp/src/core/ is `explorer-core` in waiting (roadmap 4.3, see
 * docs/mcp-core-extraction.md): it must stay liftable into a package without a
 * rewrite. That means no import of this repo's data, types or routes — a rule
 * that rots the moment it is only written down, so it runs as the first half of
 * `npm --prefix mcp run build`, and therefore inside `npm run verify:mcp`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = join(dirname(fileURLToPath(import.meta.url)), "../src/core");

/** Packages core may depend on: the protocol, schema validation, the HTTP transport. */
const ALLOWED_PACKAGES = new Set(["zod", "express"]);

const files = readdirSync(CORE, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".ts"))
  .map((e) => join(e.parentPath ?? e.path, e.name));

const problems = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)) {
    const spec = m[1];
    const ok =
      spec.startsWith("node:") ||
      spec.startsWith("@modelcontextprotocol/sdk/") ||
      ALLOWED_PACKAGES.has(spec) ||
      (spec.startsWith("./") && !spec.includes("..")); // sibling module inside core/
    if (!ok) problems.push(`${file}: imports "${spec}"`);
  }
}

if (problems.length) {
  console.error("check-core-isolation: mcp/src/core/ must not reach outside itself:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "  Corpus data, instrument ids and site routes belong in mcp/src/*.ts, not in core/.",
  );
  process.exit(1);
}
console.log(`check-core-isolation: ok (${files.length} files in mcp/src/core/)`);
