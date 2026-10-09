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
 * - Card 4.1 adds the write surface (get_assessment / put_assessment). It is
 *   opt-in per deployment (AIACT_ASSESSMENT_STATE), so the default run above
 *   must keep listing exactly the read tools; the pair is driven against two
 *   extra short-lived servers with a temp state dir, and the whole section is
 *   bracketed by a data/ + public/ fingerprint so a write that escapes the
 *   state file turns this gate red.
 * - Card 4.2 adds the server's first *resource* (the MCP Apps panel). It is
 *   pinned the way the tools are: an inventory (RESOURCES), the declared mime
 *   type, and a read whose payload must reference every question id in
 *   assessment-v1.json — the panel embeds the questionnaire rather than
 *   restating it, so a question added there and dropped here fails loudly.
 *   Two assertions are specific to this panel:
 *   · **the parity gate** (checkPanelEngine). The panel scores in the browser,
 *     which means mcp/src/panel.ts carries a hand-written mirror of
 *     src/lib/assessment/engine.ts. The gate slices that mirror out of the
 *     *served* HTML, evaluates it, and asserts it agrees with the real engine
 *     on every fixture in scripts/lib/assessment-fixtures.ts. An engine change
 *     without a mirror change is meant to fail here.
 *   · **the degradation matrix**. The panel is registered unconditionally, so
 *     the default (unauthed) server must serve it with data-state/data-write
 *     "off" and no error, and the 4.1 server with both "on".
 *   The card names the HTTP transport, which this harness otherwise never
 *   touches, so the last block starts mcp/dist/mcp/src/http.js on
 *   PANEL_HTTP_PORT and asserts resources/list and resources/read return a
 *   byte-identical payload there.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSESSMENT_FIXTURES } from "./lib/assessment-fixtures";
import { computeVisibility, evaluate } from "../src/lib/assessment/engine";
import type { Questionnaire } from "../src/lib/assessment/types";

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

// ------------------------------------------------- card 4.2: the MCP Apps panel

/** Committed resource inventory — the twin of TOOLS, for resources/list. */
const RESOURCES = [
  {
    uri: "ui://ai-act-explorer-nl/assessment/vragenlijst",
    name: "aiact-assessment-panel",
    title: "AI Act-zelfbeoordeling — invulpaneel",
    mimeType: "text/html;profile=mcp-app",
  },
];

/**
 * The panel is the one payload on this server that is deliberately far above
 * DEFAULT_MAX_BYTES, and for a different reason than get_context_pack: it is
 * not a tool result a model reads, it is a document a host renders once. The
 * bulk is the questionnaire data island (~109 kB of JSON, of which ~32 kB is
 * the editorial `help`), which is kept because walking a client through 205
 * questions is what the guidance is for. Observed: ~139 kB of HTML, ~146 kB
 * serialized. The ceiling is a drift tripwire, not a client limit.
 */
const PANEL_MAX_BYTES = 256 * 1024;

/**
 * Port for the short-lived HTTP server the panel block starts. Deliberately
 * neither the deployed 3106 nor dora's 3199: this must never talk to a running
 * systemd unit, nor collide with a concurrent verify run in the sibling repo.
 */
const PANEL_HTTP_PORT = 3196;

const QUESTIONNAIRE_PATH = join(root, "data/questionnaire/assessment-v1.json");
const questionnaire = JSON.parse(readFileSync(QUESTIONNAIRE_PATH, "utf8")) as Questionnaire;
const QUESTION_IDS = questionnaire.modules.flatMap((m) => m.questions.map((q) => q.id));

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
        // the README's worked example; ~58 kB serialized, deliberately above
        // DEFAULT_MAX_BYTES — a pack is per-provision context, not a bulk dump,
        // and this tool is the size exception (MAX_PACK_CHARS bounds it).
        args: { articles: ["6", "50"] },
        maxBytes: 72 * 1024,
        check: (md) => {
          // the warn banner must come first, before the pack heading: if a
          // client truncates, the size notice has to be in the surviving part
          assert.ok(
            md.startsWith("> **Omvang:**"),
            "pack 6+50 is over the warn band, so it must open with the size banner",
          );
          has(md, "# Contextpakket — 2 artikel(en), 24 overweging(en)", "pack heading");
          has(md, "De overwegingenkaart is een gecureerde", "pack curation caveat");
          has(md, "# Artikel 6 — ", "pack renders article 6");
          has(md, "# Artikel 50 — ", "pack renders article 50");
          // omnibus status per article, with the pointer to the per-lid diff
          has(md, "**Omnibus-status:** gewijzigd door de digitale omnibus", "pack omnibus block");
          assert.equal(
            md.match(/^\*\*Omnibus-status:\*\* /gm)?.length,
            2,
            "pack carries one omnibus-status block per article",
          );
          has(md, 'get_amendments({article: "6"})', "pack points at the word-diff tool");
          const recitalHeads = md.match(/^## Overwegingen in dit contextpakket$/gm) ?? [];
          assert.equal(recitalHeads.length, 1, "pack renders exactly one recital section");
          // recital 26 is mapped to both articles: rendered exactly once —
          // and no other recital is duplicated either
          assert.equal(
            md.match(/^### Overweging 26$/gm)?.length,
            1,
            "pack deduplicates recitals across articles",
          );
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
        // duplicate input collapses; an unknown article is skipped, not fatal,
        // as long as at least one resolves
        args: { articles: ["6", "6", "999"] },
        maxBytes: 48 * 1024,
        check: (md) => {
          has(md, "# Contextpakket — 1 artikel(en)", "pack deduplicates repeated articles");
          has(md, "> Niet gevonden en overgeslagen: 999.", "pack reports skipped articles");
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
          has(md, "Geen van de opgevraagde artikelen bestaat (999)", "pack all-unknown error");
          has(md, "1–113", "pack error names the base range");
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
        // unfiltered catalog — the largest result this tool can produce
        // (≈ 56.3 kB ≈ 16k tokens: under Claude Code's 25k budget, but the
        // reason the tool's description tells callers to filter)
        args: {},
        maxBytes: 64 * 1024,
        check: (md) => {
          has(md, "# Verplichtingen — volledige catalogus", "catalog heading");
          // twin of verify-assessment.ts: every obligation-flagged question
          has(md, "123 verplichtingen.", "unfiltered catalog size");
          has(md, "## Module 8 — ", "catalog groups by module");
          // obligations behind an undecidable gate are kept with a Voorwaarde
          // line rather than dropped — that promise is in the tool description
          has(md, "**Voorwaarde:**", "catalog keeps gated obligations");
          has(md, `Zelfbeoordeling met status per verplichting: ${BASE}/assessment`, "catalog footer");
        },
      },
      {
        args: { role: "gebruiksverantwoordelijke", riskClass: "hoogrisico" },
        check: (md) => {
          has(md, "# Verplichtingen — rol: gebruiksverantwoordelijke · risicoklasse: hoogrisico", "filtered heading");
          has(md, "59 verplichtingen.", "filtered catalog size");
          has(md, `${BASE}/artikel/26`, "obligations deep link to art. 26");
          has(md, "## Module 9 — ", "deployer module present");
          has(md, "## Module 10 — ", "FRIA module present");
          // the provider modules are the point of the role filter
          for (const nr of [11, 12, 13, 14, 15, 16])
            assert.ok(!md.includes(`## Module ${nr} — `), `provider module ${nr} leaked into the deployer catalog`);
          // gates the filter cannot decide are kept, flagged, not dropped
          has(md, "**Voorwaarde:** ", "unresolved gate rendered as a condition line");
        },
      },
      {
        // zod enum violation surfaces inside the result, like get_recital 999
        args: { role: "onzin" },
        isError: true,
        noLinks: true,
        check: (md) => has(md, "Invalid enum value", "unknown role"),
      },
    ],
  },
  {
    name: "get_questionnaire",
    title: "Zelfbeoordelingsvragenlijst (modules en vragen)",
    properties: ["module"],
    required: [],
    calls: [
      {
        args: {},
        check: (md) => {
          has(md, "# AI Act-assessment en AI-register — versie 1", "questionnaire meta header");
          // twin of verify-assessment.ts "25 modules"; the question total is a
          // deliberate pin on curated content — update it with the edit
          has(md, "25 modules, 205 vragen.", "questionnaire module/question totals");
          has(md, "> Deze zelfbeoordeling is een hulpmiddel en geen juridisch advies", "disclaimer");
          const modules = md.match(/^- \*\*Module \d+\*\* `m\d+` — /gm) ?? [];
          assert.equal(modules.length, 25, "module list has one line per module");
          // ids are not in module order — the list must show both, since the
          // tool resolves by id first
          has(md, "- **Module 12** `m19` — ", "module list pairs nr with its historical id");
          has(md, " · voorwaardelijk", "conditional modules are marked");
          has(md, `Vragenlijst op de site: ${BASE}/assessment/vragenlijst`, "questionnaire deep link");
        },
      },
      {
        // id-before-nr resolution: "m19" is module 12, not module 19
        args: { module: "m19" },
        check: (md) => {
          assert.equal(
            md.split("\n")[0],
            "# Module 12 `m19` — Aanbieder: documentatie, logging en informatie (art. 11–13)",
            "module by id resolves to its nr, not to the numeric part of the id",
          );
          has(md, "8 vragen, 8 verplichtingen.", "module counts");
          has(md, '**Zichtbaar als:** `{"all":[{"flag":"hoogrisico"},{"flag":"rol_aanbieder"}]}`', "module showIf as raw JSON");
          has(md, "atomen: alleen bij hoog risico (hoogrisico)", "module showIf gloss");
          has(md, "## Vraag 19.1", "module questions");
          has(md, "- **Markering:** verplichting", "obligation flag");
        },
      },
      {
        // numeric input resolves by module nr; m3 carries options-free choice
        // questions, an answer-gated showIf and flag effects
        args: { module: "3" },
        check: (md) => {
          has(md, "# Module 3 `m3` — GPAI: model of systeem?", "module by nr");
          has(md, "- **Antwoordtype:** janee", "answer type");
          has(md, '- **Zichtbaar als:** `{"answer":{"q":"3.1","is":"nee"}}`', "question showIf");
          has(md, "afhankelijk van het antwoord op vraag 3.1", "answer-gate gloss");
          has(md, '`[{"when":"ja","setFlag":"gpai_model"}]`', "effects as raw JSON");
          has(md, "**Toelichting:**", "question help");
        },
      },
      {
        // 12 is a valid nr *and* the numeric part of id m12 (module 18) —
        // "m12" must win over "module 12"
        args: { module: "m12" },
        check: (md) => has(md, "# Module 18 `m12` — Verplichtingen GPAI-aanbieder", "id wins over nr"),
      },
      {
        args: { module: "m99" },
        isError: true,
        noLinks: true,
        check: (md) => {
          has(md, 'Module "m99" niet gevonden', "unknown module error");
          has(md, "m19 (nr 12)", "unknown module error enumerates id/nr pairs");
        },
      },
    ],
  },
  {
    name: "get_recital_map",
    title: "Overwegingenkaart (overweging ↔ artikel)",
    properties: ["article", "recital"],
    required: [],
    calls: [
      {
        // counts stay unpinned on purpose (curation in progress — see the
        // header note); the shape and the caveat are what this gate owns
        args: {},
        check: (md) => {
          assert.ok(/^# Overwegingenkaart — \d+ paren$/.test(md.split("\n")[0]), "map heading");
          has(md, "> Gecureerde redactionele laag:", "map curation caveat");
          has(md, "van de 180 overwegingen zijn in kaart gebracht", "map coverage line");
          has(md, "Nog niet in kaart gebracht: ", "map lists the unmapped recitals");
          has(md, "## Overweging → artikelen", "map body");
          const rows = md.match(/^- \[Overweging \d+\]\(.+?\) → /gm) ?? [];
          assert.ok(rows.length >= 100, `map body has ${rows.length} rows, expected the full map`);
        },
      },
      {
        args: { article: "6" },
        check: (md) => {
          has(md, "# Overwegingen bij artikel 6 — Classificatieregels", "map by article");
          has(md, `- [Overweging 26](${BASE}/overweging/26)`, "map by article lists recitals");
          assert.ok(
            md.trimEnd().endsWith(`Artikel: ${BASE}/artikel/6`),
            "map by article ends with the article deep link",
          );
        },
      },
      {
        args: { recital: 26 },
        check: (md) => {
          has(md, "# Artikelen bij overweging 26", "map by recital");
          has(md, `[Artikel 6](${BASE}/artikel/6)`, "map by recital links articles");
        },
      },
      {
        // an unmapped recital is an answer, not an error — the caveat carries
        // the distinction the caller needs
        args: { recital: 2 },
        check: (md) => has(md, "nog niet aan artikelen gekoppeld", "unmapped recital"),
      },
      {
        args: { article: "6", recital: 26 },
        isError: true,
        noLinks: true,
        check: (md) => has(md, "niet allebei", "both directions at once is an error"),
      },
      {
        args: { article: "999" },
        isError: true,
        noLinks: true,
        check: (md) => has(md, "niet gevonden", "unknown article in the map"),
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

// ------------------------------------------------- card 4.1: the write surface

/**
 * The assessment pair, registered only when AIACT_ASSESSMENT_STATE is set.
 * Schema/annotation contract asserted like TOOLS above; the call sequence is
 * stateful, so it lives in checkAssessment() rather than in per-call `check`s.
 */
const ASSESSMENT_TOOLS: Omit<ToolSpec, "calls">[] = [
  {
    name: "get_assessment",
    title: "Assessmentstatus ophalen",
    properties: ["system"],
    required: [],
  },
  {
    name: "put_assessment",
    title: "Assessmentstatus opslaan",
    properties: ["blob"],
    required: ["blob"],
  },
];

/** Not a real secret: the gate is "is MCP_TOKEN set", and this value only ever
 *  lives in this file and in the child process it starts. */
const VERIFY_TOKEN = "verify-mcp-token";

/** Modelled on legal-workbench/inbox/examples/ai-assessments.json: 1.1 doubles
 *  as the display name, 1.4 is a `choice` with a closed option list, 2.1 janee. */
const FIXTURE = {
  v: 1,
  systems: [
    {
      id: "verify-sys-1",
      name: "Fictieve Klantcontact-assistent",
      answers: {
        "1.1": "Fictieve Klantcontact-assistent",
        "1.4": "inkoop-saas",
        "2.1": "ja",
      },
      createdAt: 1750000000000,
      updatedAt: 1750000100000,
    },
  ],
};

// ------------------------------------------------- JSON-RPC over stdio

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type ResourceContents = { uri: string; mimeType?: string; text?: string; blob?: string };
type Rpc = { id?: number; result?: unknown; error?: { code: number; message: string } };
type ListedTool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
};

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

/** Input-schema / title / description contract, shared by TOOLS and the
 *  conditionally registered assessment pair. */
function assertSchema(spec: Omit<ToolSpec, "calls">, tool: ListedTool): void {
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
  assert.ok((tool.description ?? "").length > 40, `${spec.name}: description too short to be useful`);
}

/**
 * Card 4.2: what the panel payload must satisfy on every transport. The
 * question-id assertion is the load-bearing one — the panel embeds
 * assessment-v1.json and builds its form from it, so a questionnaire that grew
 * a question the panel cannot show fails here rather than silently under-asking.
 * `caps` pins the degradation matrix: the same document, with the load/save
 * controls present only where the deployment can honour them.
 */
function checkPanel(
  label: string,
  contents: ResourceContents[],
  caps: { state: boolean; write: boolean },
): string {
  assert.equal(contents.length, 1, `${label}: expected exactly one contents entry`);
  const c = contents[0];
  assert.equal(c.uri, RESOURCES[0].uri, `${label}: contents uri`);
  assert.equal(c.mimeType, RESOURCES[0].mimeType, `${label}: contents mimeType`);
  const html = c.text ?? "";
  assert.ok(html.trim().length > 0, `${label}: empty panel payload`);
  assert.ok(html.startsWith("<!doctype html>"), `${label}: payload is not an HTML document`);
  // the MCP Apps iframe CSP is deny-by-default: a panel that reaches for an
  // external script, stylesheet or font renders blank in the host
  assert.ok(
    !/<(?:script|link)[^>]+(?:src|href)=/i.test(html),
    `${label}: panel must inline every asset — no external script/link`,
  );
  const missing = QUESTION_IDS.filter((id) => !html.includes(id));
  assert.deepEqual(
    missing,
    [],
    `${label}: panel does not reference every question id in assessment-v1.json (missing: ${missing.join(", ")})`,
  );
  has(html, "25 modules, 205 vragen", `${label}: panel states the questionnaire totals`);
  // the capability flags the client half reads off <body>
  has(html, `data-state="${caps.state ? "on" : "off"}"`, `${label}: data-state`);
  has(html, `data-write="${caps.write ? "on" : "off"}"`, `${label}: data-write`);
  assert.equal(
    html.includes('id="save"'),
    caps.write,
    `${label}: the save control must exist exactly when put_assessment can accept a write`,
  );
  assert.equal(
    html.includes('id="load"'),
    caps.state,
    `${label}: the load control must exist exactly when get_assessment is registered`,
  );
  // the fallback path is unconditional: a host that cannot render or refuses
  // the tool call must still be able to hand the answers over by copy-paste
  has(html, 'id="fallback"', `${label}: copy-paste fallback present`);
  assertLinks(label, html, true);
  return html;
}

/**
 * The parity gate. mcp/src/panel.ts mirrors src/lib/assessment/engine.ts in
 * browser JS because the panel scores in an iframe that cannot import the
 * CommonJS build; this asserts the two really agree, on the same four worked
 * examples verify-assessment.ts pins the engine against. Sliced out of the
 * *served* HTML, not out of the source file, so what is tested is what a host
 * would actually run.
 */
function checkPanelEngine(html: string): void {
  const m = html.match(/\/\*__PANEL_ENGINE_START__\*\/[\s\S]+?\/\*__PANEL_ENGINE_END__\*\//);
  assert.ok(m, "panel: PANEL_ENGINE sentinels missing — mcp/src/panel.ts changed shape?");
  const panelEvaluate = new Function(`${m[0]};return panelEvaluate`)() as (
    q: Questionnaire,
    answers: Record<string, string>,
  ) => {
    kwalificatie: string;
    rollen: string[];
    riskClass: string;
    riskLabel: string;
    stops: string[];
    annex3Categorieen: string[];
    annex1: boolean;
    escape: Record<string, boolean>;
    friaVereist: boolean;
    transparantieLeden: string[];
    openActions: { questionId: string }[];
    answered: number;
    total: number;
    visibleModules: Record<string, boolean>;
    visibleQuestions: Record<string, boolean>;
  };

  for (const { label, answers } of ASSESSMENT_FIXTURES) {
    const p = panelEvaluate(questionnaire, answers);
    const e = evaluate(questionnaire, answers);
    const ctx = computeVisibility(questionnaire, answers);
    const where = `panel engine ${label}`;
    assert.equal(p.kwalificatie, e.kwalificatie, `${where}: kwalificatie`);
    assert.deepEqual(p.rollen, e.rollen, `${where}: rollen`);
    assert.equal(p.riskClass, e.riskClass, `${where}: riskClass`);
    assert.deepEqual(p.stops, e.stops, `${where}: art. 5 stops`);
    assert.deepEqual(p.annex3Categorieen, e.annex3Categorieen, `${where}: bijlage III`);
    assert.equal(p.annex1, e.annex1, `${where}: bijlage I`);
    assert.deepEqual(p.escape, e.escape, `${where}: uitzondering art. 6, lid 3`);
    assert.equal(p.friaVereist, e.friaVereist, `${where}: FRIA`);
    assert.deepEqual(p.transparantieLeden, e.transparantieLeden, `${where}: art. 50-leden`);
    assert.deepEqual(
      p.openActions.map((o) => o.questionId),
      e.openActions.map((o) => o.questionId),
      `${where}: open acties`,
    );
    assert.equal(p.answered, e.answered, `${where}: answered`);
    assert.equal(p.total, e.total, `${where}: total`);
    assert.deepEqual(
      Object.keys(p.visibleModules).sort(),
      [...ctx.visibleModules].sort(),
      `${where}: zichtbare modules`,
    );
    assert.deepEqual(
      Object.keys(p.visibleQuestions).sort(),
      [...ctx.visibleQuestions].sort(),
      `${where}: zichtbare vragen`,
    );
  }
  console.log(
    `verify-mcp: panel engine agrees with src/lib/assessment/engine.ts on ` +
      `${ASSESSMENT_FIXTURES.map((f) => f.label).join(", ")}`,
  );
}

function textOf(label: string, result: ToolResult): string {
  assert.ok(Array.isArray(result?.content), `${label}: result has no content array`);
  assert.equal(result.content.length, 1, `${label}: expected exactly one content block`);
  assert.equal(result.content[0].type, "text", `${label}: content block is not text`);
  const md = result.content[0].text;
  assert.ok(typeof md === "string" && md.trim().length > 0, `${label}: empty text content`);
  return md;
}

// ------------------------------------------------- card 4.1: assessment tools

/** path → size+mtime for every file under `dir`, so a stray write is visible. */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const s = statSync(p);
        out[relative(root, p)] = `${s.size}:${s.mtimeMs}`;
      }
    }
  };
  walk(dir);
  return out;
}

type Driver = ReturnType<typeof startServer>;

async function handshake(server: Driver, label: string): Promise<void> {
  const init = await server.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "verify-mcp", version: "1" },
  });
  assert.ok(!init.error, `${label}: initialize failed: ${JSON.stringify(init.error)}`);
  server.notify("notifications/initialized");
}

/** One tools/call, with the shared link/size/shape assertions applied. */
async function callTool(
  server: Driver,
  name: string,
  args: Record<string, unknown>,
  opts: { isError?: boolean; noLinks?: boolean } = {},
): Promise<string> {
  const label = `${name} ${JSON.stringify(args)}`;
  const response = await server.request("tools/call", { name, arguments: args });
  assert.ok(!response.error, `${label}: JSON-RPC error ${JSON.stringify(response.error)}`);
  const result = response.result as ToolResult;
  const md = textOf(label, result);
  assert.equal(
    Boolean(result.isError),
    Boolean(opts.isError),
    `${label}: isError should be ${Boolean(opts.isError)} — got ${JSON.stringify(md.slice(0, 300))}`,
  );
  assertLinks(label, md, !opts.noLinks);
  const bytes = assertSize(label, result, DEFAULT_MAX_BYTES);
  console.log(`verify-mcp: ${label} ok (${bytes} B)`);
  return md;
}

/** The fenced ```json block get_assessment appends for round-tripping. */
function blobOf(label: string, md: string): unknown {
  const m = md.match(/```json\n([\s\S]+?)\n```/);
  assert.ok(m, `${label}: no fenced JSON blob in the result`);
  return JSON.parse(m[1]);
}

/**
 * Card 4.1. Two extra servers: one with a state file but no token (the write
 * path must refuse), one with both (the round-trip). The state file lives in a
 * temp dir, so nothing in the repo is touched — asserted separately by the
 * data/ + public/ fingerprint in main().
 */
async function checkAssessment(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "verify-mcp-"));
  const statePath = join(dir, "assessment.json");
  let calls = 0;
  try {
    // ---- server B: enabled, unauthenticated
    const anon = startServer({ AIACT_ASSESSMENT_STATE: statePath });
    try {
      await handshake(anon, "assessment(anon)");
      const listed = ((await anon.request("tools/list", {})).result as { tools: ListedTool[] })
        .tools;
      assert.deepEqual(
        listed.map((t) => t.name).sort(),
        [...TOOLS.map((t) => t.name), ...ASSESSMENT_TOOLS.map((t) => t.name)].sort(),
        "AIACT_ASSESSMENT_STATE must register exactly the two assessment tools on top of the corpus tools",
      );
      for (const spec of ASSESSMENT_TOOLS) {
        assertSchema(spec, listed.find((t) => t.name === spec.name)!);
      }
      const read = listed.find((t) => t.name === "get_assessment")!;
      assert.equal(read.annotations?.readOnlyHint, true, "get_assessment: readOnlyHint");
      const write = listed.find((t) => t.name === "put_assessment")!;
      assert.notEqual(
        write.annotations?.readOnlyHint,
        true,
        "put_assessment must not claim readOnlyHint — it writes",
      );
      assert.equal(
        write.annotations?.destructiveHint,
        true,
        "put_assessment: destructiveHint — merge-by-id replaces an existing record wholesale",
      );
      assert.equal(write.annotations?.idempotentHint, true, "put_assessment: idempotentHint");
      assert.equal(write.annotations?.openWorldHint, false, "put_assessment: openWorldHint");
      has(
        write.description ?? "",
        "MCP_TOKEN",
        "put_assessment description names the auth env var",
      );

      // empty state reads cleanly — nothing stored is an answer, not an error
      const empty = await callTool(anon, "get_assessment", {});
      has(empty, "Er is nog niets opgeslagen", "empty state");
      calls++;

      // the gate: no MCP_TOKEN ⇒ refusal, and nothing on disk
      const refused = await callTool(
        anon,
        "put_assessment",
        { blob: FIXTURE },
        { isError: true, noLinks: true },
      );
      has(refused, "geweigerd", "unauthenticated write is refused");
      has(refused, "MCP_TOKEN", "refusal names the credential the server lacks");
      has(refused, "niets opgeslagen", "refusal states nothing was written");
      assert.ok(
        !existsSync(statePath),
        "unauthenticated write created the state file — the gate ran too late",
      );
      calls++;

      // card 4.2, middle row of the degradation matrix: a state file without a
      // credential ⇒ the panel can load but not save
      const anonPanel = await anon.request("resources/read", { uri: RESOURCES[0].uri });
      assert.ok(!anonPanel.error, `panel(anon): ${JSON.stringify(anonPanel.error)}`);
      checkPanel(
        "resources/read (state, no token)",
        (anonPanel.result as { contents: ResourceContents[] }).contents,
        { state: true, write: false },
      );
      calls++;
    } finally {
      anon.close();
    }

    // ---- server C: enabled + authenticated
    const authed = startServer({
      AIACT_ASSESSMENT_STATE: statePath,
      MCP_TOKEN: VERIFY_TOKEN,
    });
    try {
      await handshake(authed, "assessment(authed)");

      // (a) valid write
      const wrote = await callTool(authed, "put_assessment", { blob: FIXTURE });
      has(wrote, "1 toegevoegd (verify-sys-1)", "authed write reports the added id");
      has(wrote, "0 bijgewerkt", "authed write reports the updated count");
      assert.ok(existsSync(statePath), "authed write did not create the state file");
      calls++;

      // (b) round-trip through the read tool
      const back = await callTool(authed, "get_assessment", {});
      has(back, "# Assessmentstatus — 1 toepassing", "read after write");
      assert.deepEqual(blobOf("get_assessment", back), FIXTURE, "blob must round-trip unchanged");
      calls++;

      // (c) unknown question id: rejected, and the stored state is untouched
      const badId = await callTool(
        authed,
        "put_assessment",
        {
          blob: { v: 1, systems: [{ id: "verify-sys-1", name: "Aangepast", answers: { "99.9": "ja" } }] },
        },
        { isError: true, noLinks: true },
      );
      has(badId, "99.9", "invalid question id is named in the refusal");
      has(badId, "onbekende vraag-id", "invalid question id is diagnosed");
      has(badId, "get_questionnaire", "refusal points at the questionnaire tool");
      calls++;
      const afterBadId = await callTool(authed, "get_assessment", {});
      assert.deepEqual(
        blobOf("get_assessment", afterBadId),
        FIXTURE,
        "a rejected write must not land, not even partially",
      );
      calls++;

      // (d) invalid option value on a `choice` question
      const badValue = await callTool(
        authed,
        "put_assessment",
        { blob: { v: 1, systems: [{ id: "verify-sys-3", name: "X", answers: { "1.4": "onzin" } }] } },
        { isError: true, noLinks: true },
      );
      has(badValue, "geen geldige optie", "invalid option value is diagnosed");
      has(badValue, "inkoop-saas", "refusal enumerates the valid options");
      calls++;

      // (e) wrong blob version is a hard stop, never a migration
      const badVersion = await callTool(
        authed,
        "put_assessment",
        { blob: { v: 2, systems: [] } },
        { isError: true, noLinks: true },
      );
      has(badVersion, "Verkeerde blobversie", "v:2 is refused");
      calls++;

      // (f) merge by id: a second system is added, the first survives
      const second = await callTool(authed, "put_assessment", {
        blob: {
          v: 1,
          systems: [{ id: "verify-sys-2", name: "Tweede toepassing", answers: { "2.1": "nee" } }],
        },
      });
      has(second, "1 toegevoegd (verify-sys-2)", "second system added");
      has(second, "1 ongewijzigd (verify-sys-1)", "omission does not delete");
      calls++;

      // (g) re-submitting an existing id updates it in place
      const changed = {
        ...FIXTURE.systems[0],
        answers: { ...FIXTURE.systems[0].answers, "2.1": "nee" },
        updatedAt: 1750000200000,
      };
      const update = await callTool(authed, "put_assessment", {
        blob: { v: 1, systems: [changed] },
      });
      has(update, "1 bijgewerkt (verify-sys-1)", "existing id is updated, not duplicated");
      calls++;

      const final = await callTool(authed, "get_assessment", {});
      const state = blobOf("get_assessment", final) as { v: number; systems: { id: string }[] };
      assert.equal(state.systems.length, 2, "state holds both systems after the update");
      assert.deepEqual(
        state.systems.find((s) => s.id === "verify-sys-1"),
        changed,
        "the updated record carries the new answer",
      );
      calls++;

      // (h) the `system` filter narrows to one record
      const one = await callTool(authed, "get_assessment", { system: "verify-sys-2" });
      has(one, "Tweede toepassing", "filter returns the requested system");
      assert.ok(!one.includes("verify-sys-1"), "filter must not leak the other system");
      calls++;

      // (i) card 4.2, top row of the degradation matrix: state file + token ⇒
      // the panel offers both write-back controls. The panel's own round-trip
      // rides these same two tools, so nothing new is registered for it.
      const authedPanel = await authed.request("resources/read", { uri: RESOURCES[0].uri });
      assert.ok(!authedPanel.error, `panel(authed): ${JSON.stringify(authedPanel.error)}`);
      const authedHtml = checkPanel(
        "resources/read (state + token)",
        (authedPanel.result as { contents: ResourceContents[] }).contents,
        { state: true, write: true },
      );
      has(authedHtml, "put_assessment", "writable panel calls put_assessment");
      has(authedHtml, "get_assessment", "writable panel calls get_assessment");
      calls++;
    } finally {
      authed.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return calls;
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
  let panelHtml = "";
  let panelBytes = 0;
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
    // card 4.2: the panel is registered unconditionally, so this capability is
    // present on the *default* (public-shaped) server too
    assert.ok(info.capabilities.resources, "server advertises the resources capability");
    server.notify("notifications/initialized");

    // ---- tool inventory
    const listed = ((await server.request("tools/list", {})).result as { tools: ListedTool[] })
      .tools;

    const registered = listed.map((t) => t.name).sort();
    const inventory = TOOLS.map((t) => t.name).sort();
    // Also the card 4.1 guarantee that the *default* configuration exposes no
    // write surface: get_assessment/put_assessment exist only when
    // AIACT_ASSESSMENT_STATE is set, which this server does not set.
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
      assertSchema(spec, tool);
      // card 4.1: the committed tools stay read-only. claude.ai's per-tool
      // controls key off these hints, so a tool that quietly loses them (or
      // gains a write path) must fail here.
      assert.equal(
        tool.annotations?.readOnlyHint,
        true,
        `${spec.name}: readOnlyHint must stay true on every corpus tool`,
      );
      assert.equal(
        tool.annotations?.openWorldHint,
        false,
        `${spec.name}: openWorldHint must stay false on every corpus tool`,
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

    // ---- card 4.2: the MCP Apps panel resource (stdio half)
    //
    // The association that makes a host offer to render the panel for this
    // tool. It sits in _meta, so neither inputSchema nor annotations changed.
    const questionnaireTool = listed.find((t) => t.name === "get_questionnaire") as
      | { _meta?: { ui?: { resourceUri?: string } } }
      | undefined;
    assert.equal(
      questionnaireTool?._meta?.ui?.resourceUri,
      RESOURCES[0].uri,
      "get_questionnaire carries the MCP Apps association to the panel resource",
    );

    const listedResources = ((await server.request("resources/list", {})).result as {
      resources: {
        uri: string;
        name: string;
        title?: string;
        description?: string;
        mimeType?: string;
      }[];
    }).resources;
    assert.deepEqual(
      listedResources.map((r) => r.uri).sort(),
      RESOURCES.map((r) => r.uri).sort(),
      "resource inventory drift — update RESOURCES in scripts/verify-mcp.ts when adding a resource",
    );
    for (const spec of RESOURCES) {
      const r = listedResources.find((x) => x.uri === spec.uri)!;
      assert.equal(r.name, spec.name, `${spec.uri}: name`);
      assert.equal(r.title, spec.title, `${spec.uri}: title`);
      assert.equal(r.mimeType, spec.mimeType, `${spec.uri}: mimeType`);
      // the panel's one job must be readable off the resource itself, not only
      // out of the README
      assert.ok((r.description ?? "").length > 40, `${spec.uri}: description too short`);
      has(r.description ?? "", "viewing need", `${spec.uri}: description names the viewing need`);
    }

    // This server sets neither AIACT_ASSESSMENT_STATE nor MCP_TOKEN — the
    // public deployment's shape. The panel must still render, read-only.
    const readLabel = "resources/read (stdio, unauthed)";
    const read = await server.request("resources/read", { uri: RESOURCES[0].uri });
    assert.ok(!read.error, `${readLabel}: JSON-RPC error ${JSON.stringify(read.error)}`);
    panelHtml = checkPanel(
      readLabel,
      (read.result as { contents: ResourceContents[] }).contents,
      { state: false, write: false },
    );
    checkPanelEngine(panelHtml);
    panelBytes = assertSize(readLabel, read.result, PANEL_MAX_BYTES);
    calls++;
    console.log(`verify-mcp: ${readLabel} ok (${panelBytes} B, ${QUESTION_IDS.length} vragen)`);
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

  // ---- card 4.1: the authed write surface. Bracketed by a fingerprint of the
  // committed corpus: a write tool that reaches outside its state file — into
  // data/ or public/ — must fail here, not in review.
  const before = { ...fingerprint(join(root, "data")), ...fingerprint(join(root, "public")) };
  const assessmentCalls = await checkAssessment();
  calls += assessmentCalls;
  assert.deepEqual(
    { ...fingerprint(join(root, "data")), ...fingerprint(join(root, "public")) },
    before,
    "a put_assessment call changed something under data/ or public/ — state must stay in AIACT_ASSESSMENT_STATE",
  );

  // ---- card 4.2: the panel over streamable HTTP — the transport claude.ai
  //      custom connectors use, and the one surface that can render it. The
  //      endpoint is stateless (no session ids), so a bare request works
  //      without a handshake; that is the property being pinned as much as the
  //      payload. Its own short-lived process on PANEL_HTTP_PORT, never 3106.
  const http = spawn(process.execPath, [join(root, "mcp/dist/mcp/src/http.js")], {
    cwd: root,
    env: { ...process.env, BASE_URL: BASE, PORT: String(PANEL_HTTP_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let httpErr = "";
  http.stderr.on("data", (d: Buffer) => (httpErr += d.toString()));
  const origin = `http://127.0.0.1:${PANEL_HTTP_PORT}`;
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try {
        up = (await fetch(`${origin}/healthz`)).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(up, `verify-mcp: HTTP server did not come up on ${origin}\n${httpErr}`);

    const rpc = async (method: string, params?: unknown): Promise<Rpc> => {
      const res = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      assert.equal(res.status, 200, `${method} over HTTP: status ${res.status}`);
      return (await res.json()) as Rpc;
    };

    const httpList = await rpc("resources/list");
    assert.ok(!httpList.error, `resources/list (HTTP): ${JSON.stringify(httpList.error)}`);
    const uris = (httpList.result as { resources: { uri: string }[] }).resources.map((r) => r.uri);
    assert.deepEqual(
      uris.sort(),
      RESOURCES.map((r) => r.uri).sort(),
      "the panel must be discoverable via resources/list on the HTTP transport",
    );

    const httpRead = await rpc("resources/read", { uri: RESOURCES[0].uri });
    assert.ok(!httpRead.error, `resources/read (HTTP): ${JSON.stringify(httpRead.error)}`);
    const html = checkPanel(
      "resources/read (HTTP, unauthed)",
      (httpRead.result as { contents: ResourceContents[] }).contents,
      { state: false, write: false },
    );
    // one renderer, two transports: a divergence here means a transport is
    // reshaping the payload
    assert.equal(html, panelHtml, "the panel payload must be identical over stdio and HTTP");
    calls += 2;
    console.log(
      `verify-mcp: resources/{list,read} over HTTP on :${PANEL_HTTP_PORT} ok ` +
        `(${Buffer.byteLength(html, "utf8")} B, identical to stdio)`,
    );
  } finally {
    http.kill();
  }

  console.log(
    `verify-mcp: all assertions passed ` +
      `(${TOOLS.length} tools + ${ASSESSMENT_TOOLS.length} conditional assessment tools, ` +
      `${RESOURCES.length} resource over stdio + HTTP, ` +
      `${calls} calls of which ${assessmentCalls} on the assessment pair, ` +
      `largest tool result ${maxBytes} B (ceiling ${DEFAULT_MAX_BYTES} B, raised per call where noted), ` +
      `panel ${panelBytes} B (ceiling ${PANEL_MAX_BYTES} B); ` +
      `data/ + public/ unchanged)`,
  );
}

main().catch((e) => {
  console.error(e instanceof assert.AssertionError ? `verify-mcp FAILED: ${e.message}` : e);
  process.exit(1);
});
