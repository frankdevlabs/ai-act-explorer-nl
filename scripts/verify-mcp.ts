/**
 * Smoke-test gate for the MCP server (mcp/src/*) — the one subsystem that had
 * no verify-*.ts check. Standalone: `npm run verify:mcp` (not part of
 * `npm run verify` / `npm run build`, because mcp/node_modules and mcp/dist are
 * gitignored and installed separately — a clean clone must still build the site).
 *
 * What it pins:
 * - the tool inventory (TOOLS below) against a live `tools/list`, so a tool
 *   added, removed or renamed without updating this file fails loudly;
 * - each tool's input-schema property/required sets and its agent-facing title
 *   and description — that is the contract callers program against;
 * - one representative invocation per tool (plus the error branches), asserting
 *   non-empty well-formed markdown, the citation/deep-link fields the render
 *   layer promises, and a few known-correct spot values (art. 6, bijlage III,
 *   overweging 1) so silent data regressions turn red here too;
 * - a serialized byte ceiling per call (DEFAULT_MAX_BYTES, overridable per call).
 *
 * Design notes:
 * - The server is driven as a subprocess over stdio against the *compiled*
 *   mcp/dist/mcp/src/stdio.js rather than importing createServer(). mcp/src/data.ts
 *   derives REPO_ROOT from the compiled layout (mcp/dist/mcp/src/), the MCP SDK
 *   only exists in mcp/node_modules, and mcp builds with `declaration: false` —
 *   so a tsx import from scripts/ would silently load the wrong data dir. Driving
 *   the real entrypoint also smoke-tests stdio.ts and the transport.
 * - BASE_URL is overridden with a sentinel host, which both proves the env
 *   plumbing in mcp/src/data.ts and lets every deep-link assertion be exact
 *   without hardcoding the deployed domain.
 * - Counts duplicated from other gates (113 articles, 180 recitals, 76 amending
 *   instructions) carry a pointer to their twin; this file asserts that the
 *   *rendering* still carries them, so a source update moves both files together.
 * - Recital-map values are deliberately not pinned (curation in progress,
 *   verify-recital-map.ts owns their content) — only panel presence.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(root, "mcp/dist/mcp/src/stdio.js");

/** Sentinel origin injected as BASE_URL; every rendered link must use it. */
const BASE = "https://verify-mcp.test";

/** Hosts the legal text itself carries (ELI links in annex/article footnotes). */
const EXTERNAL_HOSTS = new Set(["data.europa.eu", "eur-lex.europa.eu"]);

/**
 * Per-result ceiling on the serialized tool result. Observed maxima on the
 * current corpus: get_article 3 ≈ 21.2 kB, get_amendments 3 ≈ 20.6 kB,
 * search_ai_act limit:50 ≈ 26.9 kB, get_structure ≈ 17.1 kB. Card 2.3
 * tightened this from 64 kB to 32 kB now that every result is measured. Two
 * calls carry an explicit, higher per-call `maxBytes`: get_context_pack (whose
 * whole point is to compose many provisions — MAX_PACK_CHARS in
 * mcp/src/server.ts is what bounds it) and the unfiltered get_obligations
 * catalog (≈ 56.3 kB — see mcp/README.md, "Result-size guardrails").
 */
const DEFAULT_MAX_BYTES = 32 * 1024;

const PROTOCOL_VERSION = "2025-06-18";

// ------------------------------------------------- committed tool inventory

type ToolCall = {
  args: Record<string, unknown>;
  /** Expected value of result.isError (default false). */
  isError?: boolean;
  /** Result legitimately carries no deep link (empty search, error text). */
  noLinks?: boolean;
  maxBytes?: number;
  check: (md: string) => void;
};

type ToolSpec = {
  name: string;
  title: string;
  properties: string[];
  required: string[];
  calls: ToolCall[];
};

const has = (md: string, needle: string, what: string) =>
  assert.ok(md.includes(needle), `${what}: expected to contain ${JSON.stringify(needle)}`);

/** Lines that are a bare URL list item or a search-hit URL line. */
const urlLines = (md: string) =>
  md
    .split("\n")
    .map((l) => l.replace(/^-\s+/, "").trim())
    .filter((l) => l.startsWith("http"));

const TOOLS: ToolSpec[] = [
  {
    name: "search_ai_act",
    title: "Zoek in de AI-verordening",
    properties: ["limit", "query", "type"],
    required: ["query"],
    calls: [
      {
        args: { query: "biometrische identificatie op afstand", limit: 2 },
        check: (md) => {
          const blocks = md.split("\n\n").filter((b) => b.startsWith("### "));
          assert.equal(blocks.length, 2, "search: limit honoured (2 hit blocks)");
          // top hit for this query is annex III point 1 — the same corpus fact
          // verify-search.ts golden queries pin from the library side
          has(md.split("\n")[0], "Bijlage III", "search top hit heading");
          has(md, `${BASE}/bijlage/iii#punt-1`, "search top hit url");
          for (const b of blocks) {
            assert.ok(/^### .+\n/.test(b), `search hit block has a heading: ${b.slice(0, 60)}`);
            has(b, "_Gevonden termen:", "search hit block");
            has(b, "\n> ", "search hit block quote");
          }
        },
      },
      {
        args: { query: "biometrische identificatie op afstand", limit: 3, type: "overweging" },
        check: (md) => {
          const urls = urlLines(md);
          assert.ok(urls.length >= 1, "type-filtered search returns hits");
          for (const u of urls)
            assert.ok(u.startsWith(`${BASE}/overweging/`), `type=overweging filter leaked: ${u}`);
        },
      },
      {
        // tripwire for the "second corpus silently absent" branch in
        // mcp/src/data.ts: these leden only exist in public/amendment-search-docs.json
        args: { query: "dwangsommen AI-bureau", limit: 10 },
        check: (md) => {
          const omnibus = urlLines(md).filter((u) =>
            /\/artikel\/(4bis|60bis|75bis|75ter|75quater|75quinquies)/.test(u),
          );
          assert.ok(
            omnibus.length >= 1,
            "omnibus search corpus missing — public/amendment-search-docs.json not loaded?",
          );
        },
      },
      {
        args: { query: "risico", limit: 50 },
        // worst-case result observed on the current corpus (~26.9 kB)
        check: (md) => assert.ok(md.split("### ").length - 1 === 50, "limit:50 returns 50 hits"),
      },
      {
        args: { query: "zxqwvy" },
        noLinks: true,
        check: (md) => has(md, 'Geen resultaten voor "zxqwvy"', "empty search"),
      },
    ],
  },
  {
    name: "get_article",
    title: "Artikel ophalen",
    properties: ["number"],
    required: ["number"],
    calls: [
      {
        args: { number: "6" },
        check: (md) => {
          assert.equal(
            md.split("\n")[0],
            "# Artikel 6 — Classificatieregels voor AI-systemen met een hoog risico",
            "art. 6 heading",
          );
          has(md, "*Hoofdstuk III", "art. 6 context line");
          has(md, "## Lid 1", "art. 6 leden");
          // deepLinks() block: article root + one anchor per numbered lid
          has(md, "**Deep links**", "art. 6 deep-link block");
          has(md, `${BASE}/artikel/6#lid-1`, "art. 6 lid anchor");
          // art. 6 is amended by the omnibus, so the ?diff=1 pointer must appear
          has(md, `${BASE}/artikel/6?diff=1`, "art. 6 omnibus warning");
          has(md, "digitale omnibus (PE-CONS 30/26)", "art. 6 omnibus warning");
          // presence only — verify-recital-map.ts owns which recitals are listed
          has(md, "**Relevante overwegingen:**", "art. 6 recital panel");
          assert.ok(
            md.includes(`(${BASE}/overweging/`),
            "art. 6 recital panel links to at least one overweging",
          );
        },
      },
      {
        args: { number: "75 bis" },
        check: (md) => {
          // input normalisation ("75 bis" → slug 75bis) + the new-article path
          has(md, "# Artikel 75 bis — ", "art. 75 bis heading");
          has(md, "Ingevoegd door de digitale omnibus (PE-CONS 30/26)", "art. 75 bis banner");
          has(md, `${BASE}/artikel/75bis`, "art. 75 bis deep link");
        },
      },
      {
        args: { number: "999" },
        isError: true,
        noLinks: true,
        check: (md) => {
          has(md, "niet gevonden", "unknown article error");
          has(md, "1–113", "unknown article error names the base range");
          has(md, "75bis", "unknown article error names the omnibus slugs");
        },
      },
    ],
  },
  {
    name: "get_recital",
    title: "Overweging ophalen",
    properties: ["number"],
    required: ["number"],
    calls: [
      {
        args: { number: 1 },
        check: (md) => {
          assert.equal(md.split("\n")[0], "# Overweging 1", "overweging 1 heading");
          has(
            md,
            "Deze verordening heeft ten doel de werking van de interne markt te verbeteren",
            "overweging 1 verbatim opening",
          );
          has(md, "**Relevante artikelen:**", "overweging 1 article panel");
          assert.ok(
            md.trimEnd().endsWith(`**Deep link**: ${BASE}/overweging/1`),
            "overweging 1 ends with its deep link",
          );
        },
      },
      {
        // zod range violation: the SDK surfaces validation errors inside the
        // result (isError), not as a JSON-RPC error
        args: { number: 999 },
        isError: true,
        noLinks: true,
        check: (md) => has(md, "validation error", "out-of-range recital"),
      },
    ],
  },
  {
    name: "get_annex",
    title: "Bijlage ophalen",
    properties: ["roman"],
    required: ["roman"],
    calls: [
      {
        args: { roman: "III" },
        check: (md) => {
          assert.equal(
            md.split("\n")[0],
            "# Bijlage III — In artikel 6, lid 2, bedoelde AI-systemen met een hoog risico",
            "bijlage III heading",
          );
          has(md, "**1.** Biometrie", "bijlage III point 1");
          has(md, `${BASE}/artikel/6#lid-2`, "bijlage III cross-reference link");
          assert.ok(
            md.trimEnd().endsWith(`**Deep link**: ${BASE}/bijlage/iii`),
            "bijlage III ends with its deep link",
          );
        },
      },
      {
        // "bijlage iii" must normalise to the same annex, byte-identically;
        // asserted against the call above in main()
        args: { roman: "bijlage iii" },
        check: () => {},
      },
      {
        args: { roman: "XIV" },
        check: (md) => {
          has(md, "# Bijlage XIV — ", "bijlage XIV heading");
          has(md, "Toegevoegd door de digitale omnibus (PE-CONS 30/26)", "bijlage XIV banner");
          has(md, `${BASE}/bijlage/xiv`, "bijlage XIV deep link");
        },
      },
      {
        args: { roman: "ZZ" },
        isError: true,
        noLinks: true,
        check: (md) => {
          has(md, "niet gevonden", "unknown annex error");
          has(md, "I, II, III", "unknown annex error lists the known romans");
        },
      },
    ],
  },
  {
    name: "get_structure",
    title: "Structuur (inhoudsopgave)",
    properties: [],
    required: [],
    calls: [
      {
        args: {},
        check: (md) => {
          has(md, "# Verordening (EU) 2024/1689 — structuur", "structure heading");
          has(md, "## Hoofdstuk I", "structure chapters");
          has(md, "## Bijlagen", "structure annex section");
          // twin of verify-data.ts "113 articles" / "180 recitals"
          const baseArticles = md.match(/^- Artikel \d+: /gm) ?? [];
          assert.equal(baseArticles.length, 113, "structure lists all 113 base articles");
          has(md, `180 overwegingen — ${BASE}/overwegingen`, "structure recital count");
          // omnibus insertions are interleaved, not appended
          has(md, `- Artikel 75 bis (omnibus): `, "structure omnibus insertion");
          has(md, `${BASE}/artikel/75bis`, "structure omnibus insertion link");
        },
      },
    ],
  },
  {
    name: "get_amendments",
    title: "Omnibus-wijzigingen",
    properties: ["article"],
    required: [],
    calls: [
      {
        args: {},
        check: (md) => {
          has(md, "# Digitale omnibus — PE-CONS 30/26", "amendments overview heading");
          // twin of verify-amendments.ts EXPECTED.instructions (76)
          has(md, "76 wijzigingsinstructies", "amendments instruction count");
          has(md, "6 nieuwe artikelen", "amendments new-article count");
          has(md, `${BASE}/artikel/6?diff=1`, "amendments overview diff link");
          has(md, `Volledig overzicht: ${BASE}/wijzigingen`, "amendments overview footer");
        },
      },
      {
        args: { article: "6" },
        check: (md) => {
          assert.equal(
            md.split("\n")[0],
            "# Omnibus-wijzigingen aan artikel 6 (PE-CONS 30/26)",
            "amendments art. 6 heading",
          );
          has(md, "**Instructie 8** (insert)", "amendments art. 6 instruction");
          has(md, "## Wijzigingen per lid", "amendments art. 6 diff section");
          has(md, "### lid 1 bis (inserted)", "amendments art. 6 inserted lid");
          assert.ok(
            md.trimEnd().endsWith(`${BASE}/artikel/6?diff=1`),
            "amendments art. 6 ends with the diff-view link",
          );
        },
      },
      {
        // deliberate non-isError branch: an unamended article is an answer,
        // not a failure — callers (cards 2.1/2.2) rely on that distinction
        args: { article: "7" },
        noLinks: true,
        check: (md) => {
          has(md, "wordt niet gewijzigd", "unamended article");
          has(md, "Gewijzigde artikelen:", "unamended article lists the amended set");
        },
      },
    ],
  },
  {
    name: "get_context_pack",
    title: "Contextpakket: artikelen + overwegingen + omnibus-status",
    properties: ["articles"],
    required: ["articles"],
    calls: [
      {
        // README smoke-test pack; ~58.3 kB serialized on the current corpus,
        // deliberately above DEFAULT_MAX_BYTES — this tool is the exception.
        args: { articles: ["6", "50"] },
        maxBytes: 72 * 1024,
        check: (md) => {
          // the warn banner must come first, before the pack heading: if a
          // client truncates, the size notice has to be in the surviving part
          assert.ok(
            md.startsWith("> **Omvang:**"),
            "pack 6+50 is over the warn band, so it must open with the size banner",
          );
          has(md, "# Contextpakket — 2 artikel(en),", "pack heading");
          has(md, "**Omnibus-status:** gewijzigd door de digitale omnibus", "pack omnibus block");
          has(md, "# Artikel 6 — ", "pack article 6");
          has(md, "# Artikel 50 — ", "pack article 50");
          const recitalHeads = md.match(/^## Overwegingen in dit contextpakket$/gm) ?? [];
          assert.equal(recitalHeads.length, 1, "pack renders exactly one recital section");
          // every recital is rendered once, deduplicated across the pack
          const numbers = (md.match(/^### Overweging (\d+)$/gm) ?? []).map((l) =>
            l.replace("### Overweging ", ""),
          );
          assert.ok(numbers.length >= 1, "pack renders at least one recital");
          assert.equal(
            new Set(numbers).size,
            numbers.length,
            `pack renders a recital twice: ${numbers.join(", ")}`,
          );
        },
      },
      {
        // card 2.3: the count cap must refuse, and the message must name both
        // the request size and the limit so the caller can re-split
        args: { articles: Array.from({ length: 21 }, (_, i) => String(i + 1)) },
        isError: true,
        noLinks: true,
        check: (md) => {
          has(md, "geweigerd", "21-article pack is refused");
          has(md, "21", "refusal names the request size");
          has(md, "20", "refusal names the cap");
          has(md, "2 aanroepen", "refusal says how to re-split");
        },
      },
      {
        args: { articles: ["999"] },
        isError: true,
        noLinks: true,
        check: (md) => {
          has(md, "Geen van de opgevraagde artikelen bestaat", "all-unknown pack");
          has(md, "1–113", "all-unknown pack names the base range");
        },
      },
    ],
  },
  {
    name: "get_obligations",
    title: "Verplichtingencatalogus per rol en risicoklasse",
    properties: ["riskClass", "role"],
    required: [],
    calls: [
      {
        args: { role: "gebruiksverantwoordelijke", riskClass: "hoogrisico" },
        check: (md) => {
          has(md, "# Verplichtingen — rol: gebruiksverantwoordelijke · risicoklasse: hoogrisico",
            "obligations heading carries the filter");
          has(md, `${BASE}/artikel/26`, "obligations deep link to art. 26");
        },
      },
      {
        // unfiltered catalog — the largest result this tool can produce
        // (≈ 56.3 kB ≈ 16k tokens: under Claude Code's 25k budget, but the
        // reason the tool's description tells callers to filter)
        args: {},
        maxBytes: 64 * 1024,
        check: (md) => {
          has(md, "# Verplichtingen — volledige catalogus", "full catalog heading");
          // obligations behind an undecidable gate are kept with a Voorwaarde
          // line rather than dropped — that promise is in the tool description
          has(md, "**Voorwaarde:**", "catalog keeps gated obligations");
        },
      },
    ],
  },
];

/**
 * Card 2.3, size-refusal branch. Driven against a second, short-lived server
 * started with a deliberately tiny MCP_MAX_RESULT_CHARS, so the assertion does
 * not depend on which articles happen to be large in the current corpus.
 */
const SIZE_LIMIT_ENV = { MCP_MAX_RESULT_CHARS: "5000" };

// ------------------------------------------------- JSON-RPC over stdio

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type Rpc = { id?: number; result?: unknown; error?: { code: number; message: string } };

function startServer(extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: root,
    env: { ...process.env, BASE_URL: BASE, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  child.on("error", (e) => {
    throw e;
  });

  const pending = new Map<number, (msg: Rpc) => void>();
  let buffer = "";
  child.stdout.on("data", (d: Buffer) => {
    buffer += d.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as Rpc;
      if (msg.id != null) pending.get(msg.id)?.(msg);
    }
  });

  let nextId = 0;
  const request = (method: string, params?: unknown): Promise<Rpc> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`verify-mcp: ${method} timed out after 20s\n${stderr}`)),
        20_000,
      );
      pending.set(id, (msg) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const notify = (method: string, params?: unknown) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  const close = () => {
    child.stdin.end();
    child.kill();
  };
  return { request, notify, close, stderr: () => stderr };
}

// ------------------------------------------------- assertion helpers

/** Serialized size of a tool result; the hook card 2.3 tightens. */
function assertSize(label: string, result: unknown, max: number): number {
  const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  assert.ok(bytes <= max, `${label}: result is ${bytes} B, over the ${max} B ceiling`);
  return bytes;
}

/** Every absolute link is either a BASE_URL deep link or a known external cite. */
function assertLinks(label: string, md: string, expectDeepLink: boolean): void {
  for (const url of md.match(/https?:\/\/[^\s)"'\]]+/g) ?? []) {
    const host = new URL(url).host;
    assert.ok(
      host === new URL(BASE).host || EXTERNAL_HOSTS.has(host),
      `${label}: link to unexpected host ${host} (${url}) — BASE_URL not threaded through?`,
    );
  }
  if (expectDeepLink)
    assert.ok(md.includes(BASE), `${label}: no ${BASE} deep link in the result`);
}

function textOf(label: string, result: ToolResult): string {
  assert.ok(Array.isArray(result?.content), `${label}: result has no content array`);
  assert.equal(result.content.length, 1, `${label}: expected exactly one content block`);
  assert.equal(result.content[0].type, "text", `${label}: content block is not text`);
  const md = result.content[0].text;
  assert.ok(typeof md === "string" && md.trim().length > 0, `${label}: empty text content`);
  return md;
}

// ------------------------------------------------- run

async function main(): Promise<void> {
  assert.ok(
    existsSync(SERVER),
    `mcp/dist missing — run \`npm --prefix mcp install && npm --prefix mcp run build\``,
  );
  const server = startServer();
  let calls = 0;
  let maxBytes = 0;
  try {
    // ---- handshake
    const init = await server.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "verify-mcp", version: "1" },
    });
    assert.ok(!init.error, `initialize failed: ${JSON.stringify(init.error)}\n${server.stderr()}`);
    const info = init.result as {
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
    };
    assert.equal(info.serverInfo.name, "ai-act-explorer-nl", "serverInfo.name");
    assert.ok(info.capabilities.tools, "server advertises the tools capability");
    server.notify("notifications/initialized");

    // ---- tool inventory
    const listed = ((await server.request("tools/list", {})).result as {
      tools: { name: string; title?: string; description?: string; inputSchema: Record<string, unknown> }[];
    }).tools;

    const registered = listed.map((t) => t.name).sort();
    const inventory = TOOLS.map((t) => t.name).sort();
    assert.deepEqual(
      registered,
      inventory,
      "tool inventory drift — registered but not in TOOLS: " +
        `[${registered.filter((n) => !inventory.includes(n)).join(", ")}]; ` +
        "in TOOLS but not registered: " +
        `[${inventory.filter((n) => !registered.includes(n)).join(", ")}]. ` +
        "Update TOOLS (and its calls) in scripts/verify-mcp.ts when adding or renaming a tool.",
    );

    for (const spec of TOOLS) {
      const tool = listed.find((t) => t.name === spec.name)!;
      const schema = tool.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      assert.deepEqual(
        Object.keys(schema.properties ?? {}).sort(),
        [...spec.properties].sort(),
        `${spec.name}: input-schema properties`,
      );
      assert.deepEqual(
        [...(schema.required ?? [])].sort(),
        [...spec.required].sort(),
        `${spec.name}: input-schema required`,
      );
      assert.equal(tool.title, spec.title, `${spec.name}: title`);
      // descriptions are the agent-facing contract; a stub would silently
      // degrade every caller
      assert.ok(
        (tool.description ?? "").length > 40,
        `${spec.name}: description too short to be useful`,
      );
    }

    // ---- invocations
    const byLabel = new Map<string, string>();
    for (const spec of TOOLS) {
      for (const call of spec.calls) {
        const label = `${spec.name} ${JSON.stringify(call.args)}`;
        const response = await server.request("tools/call", {
          name: spec.name,
          arguments: call.args,
        });
        assert.ok(
          !response.error,
          `${label}: JSON-RPC error ${JSON.stringify(response.error)}`,
        );
        const result = response.result as ToolResult;
        const md = textOf(label, result);
        assert.equal(
          Boolean(result.isError),
          Boolean(call.isError),
          `${label}: isError should be ${Boolean(call.isError)}`,
        );
        assertLinks(label, md, !call.noLinks);
        call.check(md);
        const bytes = assertSize(label, result, call.maxBytes ?? DEFAULT_MAX_BYTES);
        maxBytes = Math.max(maxBytes, bytes);
        calls++;
        byLabel.set(label, md);
        console.log(`verify-mcp: ${label} ok (${bytes} B)`);
      }
    }

    // input normalisation must be lossless, not merely successful
    assert.equal(
      byLabel.get('get_annex {"roman":"bijlage iii"}'),
      byLabel.get('get_annex {"roman":"III"}'),
      'get_annex: "bijlage iii" must render identically to "III"',
    );

    // card 2.3: the caller must be able to read both ceilings off the tool
    // description, not only discover them by being refused
    const packDesc = listed.find((t) => t.name === "get_context_pack")?.description ?? "";
    has(packDesc, "20 articles per call", "get_context_pack description names the count cap");
    has(packDesc, "85,000 characters", "get_context_pack description names the size ceiling");
  } finally {
    server.close();
  }

  // ---- card 2.3: size refusal, against a server with a tiny ceiling
  const tiny = startServer(SIZE_LIMIT_ENV);
  try {
    await tiny.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "verify-mcp", version: "1" },
    });
    tiny.notify("notifications/initialized");
    const label = `get_context_pack {"articles":["6"]} @ MCP_MAX_RESULT_CHARS=${SIZE_LIMIT_ENV.MCP_MAX_RESULT_CHARS}`;
    const response = await tiny.request("tools/call", {
      name: "get_context_pack",
      arguments: { articles: ["6"] },
    });
    assert.ok(!response.error, `${label}: JSON-RPC error ${JSON.stringify(response.error)}`);
    const result = response.result as ToolResult;
    const md = textOf(label, result);
    assert.equal(result.isError, true, `${label}: an oversized pack must be refused`);
    has(md, "geweigerd", "size refusal");
    has(md, "5.000 tekens", "size refusal names the active ceiling");
    has(md, "tokens", "size refusal converts to tokens");
    has(md, "Opbouw — artikelen: artikel 6:", "size refusal gives the per-article breakdown");
    has(md, "MCP_MAX_RESULT_CHARS", "size refusal names the override");
    // the refusal must not smuggle the pack itself back to the caller
    assert.ok(
      md.length < 2000,
      `${label}: refusal is ${md.length} chars — it must be a message, not the pack`,
    );
    calls++;
    console.log(`verify-mcp: ${label} ok (refused, ${md.length} chars)`);
  } finally {
    tiny.close();
  }

  console.log(
    `verify-mcp: all assertions passed ` +
      `(${TOOLS.length} tools, ${calls} calls, largest result ${maxBytes} B; ` +
      `default ceiling ${DEFAULT_MAX_BYTES} B, raised per call where noted)`,
  );
}

main().catch((e) => {
  console.error(e instanceof assert.AssertionError ? `verify-mcp FAILED: ${e.message}` : e);
  process.exit(1);
});
