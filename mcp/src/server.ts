import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Amendment } from "../../src/lib/types.js";
import type { RiskClass, RoleFlag } from "../../src/lib/assessment/types.js";
import { obligationCatalog } from "../../src/lib/assessment/engine.js";
import { PRECISION_SEARCH_OPTIONS, makeSnippet, searchDocs } from "../../src/lib/search-core.js";
import {
  BASE_URL,
  amendmentDiffs,
  amendments,
  annexes,
  getAnnex,
  getRecital,
  index,
  normalizeArticleInput,
  questionnaire,
  recitalMap,
  resolveArticle,
  slugRank,
  toc,
} from "./data.js";
import { renderAnnex, renderArticle, renderSegments, renderText } from "./render.js";

const text = (md: string) => ({ content: [{ type: "text" as const, text: md }] });
const err = (md: string) => ({ content: [{ type: "text" as const, text: md }], isError: true });

/**
 * Every tool on this server reads a static corpus and mutates nothing, and no
 * tool reaches outside it. claude.ai's per-tool controls key off these hints,
 * so they belong on all tools, not only on new ones.
 */
const RO = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * Result-size guardrails for get_context_pack — the only tool here that can
 * return an unbounded amount of text (it composes N full articles + their
 * recitals). Two client ceilings apply: claude.ai/Desktop truncates a tool
 * result around 150k characters, and Claude Code's default
 * MAX_MCP_OUTPUT_TOKENS is 25k tokens (it warns at 10k). Crossing either
 * silently yields a *truncated* pack, which is worse than an error: a review
 * built on half a pack still looks complete. So the tool refuses and says by
 * how much, rather than trimming.
 *
 * The default ceiling is the strict (Claude Code) one; a claude.ai-only
 * deployment can raise it toward 150k via MCP_MAX_RESULT_CHARS.
 */
const MAX_PACK_ARTICLES = 20;
/** Measured ~3.5 chars/token on this Dutch corpus; rounded down to stay safe. */
const CHARS_PER_TOKEN = 3.4;
const DEFAULT_MAX_PACK_CHARS = 85_000; // 25k tokens x 3.4 — also well under 150k
const MAX_PACK_CHARS = Number(process.env.MCP_MAX_RESULT_CHARS) || DEFAULT_MAX_PACK_CHARS;
const WARN_PACK_CHARS = 34_000; // ~10k tokens — Claude Code's warn threshold
const estTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
/** Thousands separators without depending on the runtime's ICU build. */
const fmt = (n: number, sep = ".") => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);

const omnibusSlugs = () => amendments.newArticles.map((a) => a.slug).join(", ");

function amendmentById(id: string): Amendment | undefined {
  return amendments.amendments.find((a) => `${a.seq}${a.sub ?? ""}` === id);
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "ai-act-explorer-nl", version: "0.1.0" });

  server.registerTool(
    "search_ai_act",
    {
      title: "Zoek in de AI-verordening",
      annotations: RO,
      description:
        "Full-text search in the Dutch text of the EU AI Act (Regulation 2024/1689, consolidated) " +
        "plus the digital-omnibus amendment layer. Returns hits with deep links to " +
        BASE_URL +
        ". Query in Dutch works best.",
      inputSchema: {
        query: z.string().min(2).describe("Search terms (Dutch)"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10"),
        type: z
          .enum(["artikel", "overweging", "bijlage"])
          .optional()
          .describe("Restrict to articles, recitals or annexes"),
      },
    },
    async ({ query, limit, type }) => {
      let hits = searchDocs(index, query, 50, PRECISION_SEARCH_OPTIONS);
      if (type) hits = hits.filter((h) => h.type === type);
      hits = hits.slice(0, limit ?? 10);
      if (!hits.length) return text(`Geen resultaten voor "${query}".`);
      const body = hits
        .map((h) => {
          // short chunks (per-point annex docs, single leden) quoted in full,
          // so agents rarely need a follow-up get_article/get_annex call
          const quoted = h.text.length <= 600 ? h.text : makeSnippet(h.text, h.terms, 200);
          const terms = [...new Set(h.queryTerms)].join(", ");
          return `### ${h.heading}\n${BASE_URL}${h.url}\n_Gevonden termen: ${terms}_\n> ${quoted.replace(/\n+/g, " ")}`;
        })
        .join("\n\n");
      return text(body);
    },
  );

  server.registerTool(
    "get_article",
    {
      title: "Artikel ophalen",
      annotations: RO,
      description:
        'Full Dutch text of an article. Base articles: "1"–"113". Articles inserted by the ' +
        'digital omnibus: "75 bis", "4bis", etc.',
      inputSchema: {
        number: z.string().describe('Article number, e.g. "6" or "75 bis"'),
      },
    },
    async ({ number }) => {
      const key = normalizeArticleInput(number);
      const resolved = resolveArticle(key);
      if (!resolved) {
        return err(
          `Artikel "${number}" niet gevonden. Basisartikelen: 1–113. Omnibus-artikelen: ${omnibusSlugs()}.`,
        );
      }
      let md = renderArticle(resolved);
      if (resolved.kind === "base" && (amendmentDiffs.articles[key] || amendments.titleChanges[key])) {
        md += `\n\n> Let op: dit artikel wordt gewijzigd door de digitale omnibus (PE-CONS 30/26) — zie het tool get_amendments of ${BASE_URL}/artikel/${key}?diff=1.`;
      }
      const related = recitalMap.byArticle[key];
      if (related?.length) {
        md += `\n\n**Relevante overwegingen:** ${related
          .map((n) => `[${n}](${BASE_URL}/overweging/${n})`)
          .join(", ")}`;
      }
      return text(md);
    },
  );

  server.registerTool(
    "get_recital",
    {
      title: "Overweging ophalen",
      annotations: RO,
      description: "Full Dutch text of a recital (overweging), 1–180.",
      inputSchema: {
        number: z.coerce.number().int().min(1).max(180).describe("Recital number (1–180)"),
      },
    },
    async ({ number }) => {
      const r = getRecital(number);
      if (!r) return err(`Overweging ${number} niet gevonden (bereik: 1–180).`);
      const body = r.paragraphs.map((p) => renderText(p.text, p.refs)).join("\n\n");
      const slugs = recitalMap.byRecital[String(r.number)];
      const related = slugs?.length
        ? `\n\n**Relevante artikelen:** ${slugs
            .map((s) => {
              const display = amendments.newArticles.find((n) => n.slug === s)?.displayNumber ?? s;
              return `Artikel ${display} — ${BASE_URL}/artikel/${s}`;
            })
            .join(" · ")}`
        : "";
      return text(`# Overweging ${r.number}\n\n${body}${related}\n\n**Deep link**: ${BASE_URL}/overweging/${r.number}`);
    },
  );

  server.registerTool(
    "get_annex",
    {
      title: "Bijlage ophalen",
      annotations: RO,
      description:
        "Full Dutch text of an annex (bijlage) by Roman numeral, e.g. \"III\". Includes annexes added by the digital omnibus.",
      inputSchema: {
        roman: z.string().describe('Annex Roman numeral, e.g. "III"'),
      },
    },
    async ({ roman }) => {
      const key = roman.trim().replace(/^bijlage\s*/i, "");
      const a = getAnnex(key);
      if (!a) {
        const known = [...annexes.map((x) => x.roman), ...amendments.newAnnexes.map((x) => x.roman)];
        return err(`Bijlage "${roman}" niet gevonden. Beschikbaar: ${known.join(", ")}.`);
      }
      const isNew = amendments.newAnnexes.some((n) => n.roman.toLowerCase() === a.roman.toLowerCase());
      return text(renderAnnex(a, isNew));
    },
  );

  server.registerTool(
    "get_structure",
    {
      title: "Structuur (inhoudsopgave)",
      annotations: RO,
      description:
        "Compact table of contents: chapters, sections, articles (with digital-omnibus insertions), annexes, recital count.",
      inputSchema: {},
    },
    async () => {
      const lines: string[] = ["# Verordening (EU) 2024/1689 — structuur", ""];
      for (const ch of toc.chapters) {
        lines.push(`## Hoofdstuk ${ch.roman} — ${ch.title}`);
        const pushArticle = (n: number, title: string) => {
          lines.push(`- Artikel ${n}: ${title} — ${BASE_URL}/artikel/${n}`);
          for (const ins of amendments.newArticles
            .filter((x) => x.insertAfter === n)
            .sort((a, b) => slugRank(a.slug) - slugRank(b.slug))) {
            lines.push(
              `- Artikel ${ins.displayNumber} (omnibus): ${ins.title} — ${BASE_URL}/artikel/${ins.slug}`,
            );
          }
        };
        for (const a of ch.articles) pushArticle(a.number, a.title);
        for (const s of ch.sections) {
          lines.push(`### Afdeling ${s.number} — ${s.title}`);
          for (const a of s.articles) pushArticle(a.number, a.title);
        }
        lines.push("");
      }
      lines.push("## Bijlagen");
      for (const a of toc.annexes) {
        lines.push(`- Bijlage ${a.roman}: ${a.title} — ${BASE_URL}/bijlage/${a.roman.toLowerCase()}`);
        for (const ins of amendments.newAnnexes.filter(
          (x) => x.insertAfter.toLowerCase() === a.roman.toLowerCase(),
        )) {
          lines.push(
            `- Bijlage ${ins.roman} (omnibus): ${ins.title} — ${BASE_URL}/bijlage/${ins.roman.toLowerCase()}`,
          );
        }
      }
      lines.push("", `${toc.recitalCount} overwegingen — ${BASE_URL}/overwegingen`);
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "get_amendments",
    {
      title: "Omnibus-wijzigingen",
      annotations: RO,
      description:
        "Digital-omnibus (PE-CONS 30/26) amendments to the AI Act. Without arguments: overview of all " +
        "affected articles/annexes. With an article number: the amending instructions plus a word-level " +
        "diff (~~deleted~~ / **inserted**).",
      inputSchema: {
        article: z.string().optional().describe('Article number, e.g. "6" or "75 bis"'),
      },
    },
    async ({ article }) => {
      const meta = amendments.meta;
      if (!article) {
        const lines = [
          `# Digitale omnibus — ${meta.document} (${meta.date})`,
          "",
          `${amendments.amendments.length} wijzigingsinstructies; ${amendments.newArticles.length} nieuwe artikelen; ${amendments.newAnnexes.length} nieuwe bijlagen. Nog niet in werking.`,
          "",
          "Gewijzigde onderdelen in documentvolgorde:",
          ...amendments.orderedTargets.map((t) =>
            t.kind === "article"
              ? `- Artikel ${amendments.newArticles.find((n) => n.slug === t.slug)?.displayNumber ?? t.slug} — ${BASE_URL}/artikel/${t.slug}?diff=1`
              : `- Bijlage ${t.slug.toUpperCase()} — ${BASE_URL}/bijlage/${t.slug}?diff=1`,
          ),
          "",
          `Volledig overzicht: ${BASE_URL}/wijzigingen`,
        ];
        return text(lines.join("\n"));
      }

      const key = normalizeArticleInput(article);
      const ids = amendments.byArticle[key];
      if (!ids?.length) {
        return text(
          `Artikel ${article} wordt niet gewijzigd door de digitale omnibus. Gewijzigde artikelen: ${Object.keys(amendments.byArticle).join(", ")}.`,
        );
      }
      const lines = [`# Omnibus-wijzigingen aan artikel ${key} (${meta.document})`, ""];
      for (const id of ids) {
        const am = amendmentById(id);
        if (!am) continue;
        lines.push(`- **Instructie ${id}** (${am.operation}): ${am.scope.description}${am.note ? ` — ${am.note}` : ""}`);
      }
      const diffs = amendmentDiffs.articles[key];
      if (diffs) {
        lines.push("", "## Wijzigingen per lid (~~geschrapt~~ / **ingevoegd**)");
        for (const d of diffs) {
          if (d.status === "unchanged") continue;
          const label = d.displayNumber ? `lid ${d.displayNumber}` : d.anchor;
          lines.push("", `### ${label} (${d.status})`, "");
          if (d.segments) lines.push(renderSegments(d.segments).replace(/\n+/g, " "));
        }
      }
      lines.push("", `Diff-weergave op de site: ${BASE_URL}/artikel/${key}?diff=1`);
      return text(lines.join("\n"));
    },
  );

  // ---------------------------------------------------------------------
  // Batch 1 (roadmap 2.1): composition tools. Neither adds data — both are
  // compositions over the loaders the tools above already use.

  server.registerTool(
    "get_context_pack",
    {
      title: "Contextpakket: artikelen + overwegingen + omnibus-status",
      annotations: RO,
      description:
        "One call per review instead of three per provision: for each requested article the full " +
        "Dutch text, its digital-omnibus status, and the recitals the editorial recital map ties " +
        "to it — with every referenced recital rendered once, deduplicated across the pack. " +
        "Use this to open a contract or memo review; use get_article for a single provision and " +
        "get_amendments when you need the per-lid word diff. " +
        `Hard limits: at most ${MAX_PACK_ARTICLES} articles per call, and the assembled pack must ` +
        `stay under ${fmt(MAX_PACK_CHARS, ",")} characters (~${fmt(estTokens(MAX_PACK_CHARS), ",")} tokens); ` +
        "a pack over either is refused, never truncated. Ask for the provisions you need, not the " +
        "maximum: a pack runs to roughly 13k characters per article once its recitals are " +
        "included, so about 5 articles already fill a default result budget.",
      inputSchema: {
        articles: z
          .array(z.string())
          .min(1)
          .describe(
            `Article numbers, e.g. ["6", "50", "75 bis"]. At most ${MAX_PACK_ARTICLES}, and fewer if the pack would exceed the size ceiling.`,
          ),
      },
    },
    async ({ articles }) => {
      // Count cap. Enforced here rather than with zod's .max(): zod's too_big
      // message is static and never names the request size, and the SDK rejects
      // before the handler runs — so the caller could not see how far over they
      // were, nor how to re-split.
      if (articles.length > MAX_PACK_ARTICLES) {
        const batches = Math.ceil(articles.length / MAX_PACK_ARTICLES);
        return err(
          `Contextpakket geweigerd: ${articles.length} artikelen gevraagd, maximaal ${MAX_PACK_ARTICLES} per aanroep. ` +
            `Splits de aanvraag in ${batches} aanroepen van ten hoogste ${MAX_PACK_ARTICLES} artikelen. ` +
            "Let op: ook onder dat aantal geldt een omvangsplafond — vraag alleen de bepalingen die u nodig heeft.",
        );
      }

      const unknown: string[] = [];
      const sections: string[] = [];
      const sizes: Array<[string, number]> = [];
      const recitalNumbers: number[] = [];
      const seenArticles = new Set<string>();

      for (const input of articles) {
        const key = normalizeArticleInput(input);
        if (seenArticles.has(key)) continue;
        seenArticles.add(key);
        const resolved = resolveArticle(key);
        if (!resolved) {
          unknown.push(input);
          continue;
        }
        const parts = [renderArticle(resolved)];

        // Omnibus status. The instructions and the diff link go here; the
        // per-lid word diffs stay in get_amendments, and the section says so —
        // PRACTICE.md requires an omnibus check per cited article, so the
        // caller must know which call satisfies which half of it.
        if (resolved.kind === "base") {
          const ids = amendments.byArticle[key] ?? [];
          const changed = ids.length > 0 || Boolean(amendments.titleChanges[key]);
          if (changed) {
            const instructions = ids
              .map((id) => amendmentById(id))
              .filter((a): a is Amendment => Boolean(a))
              .map((a) => `- ${a.seq}${a.sub ?? ""} (${a.operation}): ${a.scope.description}`);
            parts.push(
              [
                `**Omnibus-status:** gewijzigd door de digitale omnibus (${amendments.meta.document}) — nog niet in werking.`,
                ...instructions,
                `Woorddiff per lid: tool get_amendments({article: "${key}"}) · ${BASE_URL}/artikel/${key}?diff=1`,
              ].join("\n"),
            );
          } else {
            parts.push("**Omnibus-status:** niet gewijzigd door de digitale omnibus.");
          }
        }

        const related = recitalMap.byArticle[key] ?? [];
        recitalNumbers.push(...related);
        parts.push(
          related.length
            ? `**Relevante overwegingen:** ${related
                .map((n) => `[${n}](${BASE_URL}/overweging/${n})`)
                .join(", ")}`
            : "**Relevante overwegingen:** geen in de gecureerde overwegingenkaart.",
        );
        const section = parts.join("\n\n");
        sections.push(section);
        sizes.push([key, section.length]);
      }

      if (!sections.length) {
        return err(
          `Geen van de opgevraagde artikelen bestaat (${unknown.join(", ")}). Basisartikelen: 1–113. Omnibus-artikelen: ${omnibusSlugs()}.`,
        );
      }

      const uniqueRecitals = [...new Set(recitalNumbers)].sort((a, b) => a - b);
      const head = [
        `# Contextpakket — ${sections.length} artikel(en), ${uniqueRecitals.length} overweging(en)`,
        "",
        `Bron: Verordening (EU) 2024/1689 (geconsolideerd) + digitale omnibus ${amendments.meta.document}.`,
        // The map is curated and unfinished: an empty recital list must not be
        // read as "no relevant recital exists".
        `> De overwegingenkaart is een gecureerde, nog onvolledige laag (${recitalMap.meta.pairCount} paren, ${recitalMap.meta.reviewedCount} van de overwegingen nagelopen). Een lege lijst betekent "nog niet in kaart gebracht", niet "geen relevante overweging".`,
      ];
      if (unknown.length) {
        head.push("", `> Niet gevonden en overgeslagen: ${unknown.join(", ")}.`);
      }

      const body = [head.join("\n"), ...sections];
      const recitalStart = body.length;
      if (uniqueRecitals.length) {
        body.push("## Overwegingen in dit contextpakket");
        for (const n of uniqueRecitals) {
          const r = getRecital(n);
          if (!r) continue;
          const paras = r.paragraphs.map((p) => renderText(p.text, p.refs)).join("\n\n");
          body.push(`### Overweging ${n}\n${BASE_URL}/overweging/${n}\n\n${paras}`);
        }
      }

      // Size ceiling. Measured only after assembly: the per-article cost is
      // dominated by recitals, which are deduplicated across the pack, so it
      // cannot be predicted from the article count alone. Refuse rather than
      // trim — and say which articles are expensive, so the caller can re-split
      // deliberately instead of bisecting.
      const md = body.join("\n\n---\n\n");
      if (md.length > MAX_PACK_CHARS) {
        const recitalChars = body.slice(recitalStart).reduce((n, s) => n + s.length, 0);
        const breakdown = [...sizes]
          .sort((a, b) => b[1] - a[1])
          .map(([key, n]) => `artikel ${key}: ~${Math.round(n / 1000)}k`)
          .join(", ");
        // Advice, deliberately conservative: the shared recital block does not
        // shrink in proportion to the article count (recitals are deduplicated
        // and several articles cite the same ones), so the linear estimate is
        // an over-estimate — take one off it.
        const linear = Math.floor(sections.length * (MAX_PACK_CHARS / md.length));
        const advice =
          sections.length === 1
            ? "Dit ene artikel past al niet onder het plafond — gebruik get_article (zonder overwegingen) " +
              "of verhoog MCP_MAX_RESULT_CHARS."
            : `Vraag ongeveer ${Math.min(Math.max(linear - 1, 1), sections.length - 1)} artikel(en) per aanroep, ` +
              "of minder wanneer u de grootste artikelen combineert. Voor één bepaling is get_article goedkoper.";
        return err(
          `Contextpakket geweigerd: het pakket voor ${sections.length} artikel(en) is ${fmt(md.length)} tekens ` +
            `(~${fmt(estTokens(md.length))} tokens), boven het plafond van ${fmt(MAX_PACK_CHARS)} tekens ` +
            `(~${fmt(estTokens(MAX_PACK_CHARS))} tokens). Het pakket wordt geweigerd en niet afgekapt: een afgekapt pakket ` +
            "ziet er volledig uit.\n\n" +
            `Opbouw — artikelen: ${breakdown}; gedeelde overwegingen (${uniqueRecitals.length}): ~${Math.round(recitalChars / 1000)}k tekens ` +
            "(overwegingen zijn de grootste post en worden binnen het pakket ontdubbeld).\n\n" +
            `${advice}\n\n` +
            "Plafonds: claude.ai kapt een toolresultaat af rond 150.000 tekens; Claude Code hanteert standaard 25.000 tokens " +
            "(MAX_MCP_OUTPUT_TOKENS). Een implementatie die alleen claude.ai bedient kan dit plafond verhogen via MCP_MAX_RESULT_CHARS.",
        );
      }

      // Warning band. First in the result on purpose: if a client truncates
      // anyway, the size notice is in the part that survives.
      if (md.length > WARN_PACK_CHARS) {
        const banner =
          `> **Omvang:** dit pakket is ${fmt(md.length)} tekens (~${fmt(estTokens(md.length))} tokens) ` +
          `en overschrijdt daarmee de waarschuwingsgrens van Claude Code (~${fmt(estTokens(WARN_PACK_CHARS))} tokens). ` +
          `Het plafond ligt op ${fmt(MAX_PACK_CHARS)} tekens; vraag bij een volgende aanroep minder artikelen tegelijk.`;
        return text(`${banner}\n\n${md}`);
      }
      return text(md);
    },
  );

  const ROLE_ARG: Record<string, RoleFlag> = {
    aanbieder: "rol_aanbieder",
    gebruiksverantwoordelijke: "rol_deployer",
    importeur: "rol_importeur",
    distributeur: "rol_distributeur",
    gemachtigde: "rol_gemachtigde",
    "gpai-aanbieder": "gpai_aanbieder",
  };

  server.registerTool(
    "get_obligations",
    {
      title: "Verplichtingencatalogus per rol en risicoklasse",
      annotations: RO,
      description:
        "Catalog of the AI Act obligations that apply to a role and/or risk class, derived from " +
        "the assessment questionnaire's obligation checklist, with deep links to the underlying " +
        "articles. Without arguments: the full catalog. Note what this is not: it never reports " +
        "compliance status — that is a function of a concrete system's answers and only the " +
        `assessment engine at ${BASE_URL}/assessment computes it. Obligations whose gate the ` +
        'filter cannot decide are included with a "voorwaarde" line rather than dropped.',
      inputSchema: {
        role: z
          .enum([
            "aanbieder",
            "gebruiksverantwoordelijke",
            "importeur",
            "distributeur",
            "gemachtigde",
            "gpai-aanbieder",
          ])
          .optional()
          .describe(
            "Role. The first five are mutually exclusive; \"gpai-aanbieder\" is a second axis " +
              "(a provider of an AI system can also provide a GPAI model).",
          ),
        riskClass: z
          .enum(["geen-ai", "verboden", "hoogrisico", "transparantierisico", "minimaal"])
          .optional()
          .describe("Risk class per the AI Act's classification"),
      },
    },
    async ({ role, riskClass }) => {
      const entries = obligationCatalog(questionnaire, {
        role: role ? ROLE_ARG[role] : undefined,
        riskClass: riskClass as RiskClass | undefined,
      });
      const filterLabel = [
        role ? `rol: ${role}` : null,
        riskClass ? `risicoklasse: ${riskClass}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      if (!entries.length) {
        return text(
          `Geen verplichtingen voor deze combinatie (${filterLabel || "geen filter"}).`,
        );
      }

      const lines = [
        `# Verplichtingen — ${filterLabel || "volledige catalogus"}`,
        "",
        `${entries.length} verplichtingen. Grondslag: ${questionnaire.meta.basis}`,
        "",
        `> ${questionnaire.meta.disclaimer}`,
        "",
        "> Dit is een redactionele checklist die de verplichtingen parafraseert en naar de wettekst " +
          "deep-linkt; de verordeningstekst zelf staat in get_article. Een regel met " +
          '"**Voorwaarde:**" geldt alleen als die voorwaarde is vervuld — het filter kon dat niet ' +
          "bepalen.",
      ];

      let currentModule = "";
      for (const e of entries) {
        if (e.moduleId !== currentModule) {
          currentModule = e.moduleId;
          lines.push("", `## Module ${e.moduleNr} — ${e.moduleTitle}`);
        }
        lines.push("", `**${e.questionId}** — ${e.text}`);
        if (e.conditions.length) lines.push(`**Voorwaarde:** ${e.conditions.join(" · ")}`);
        if (e.omnibus) {
          const from = e.omnibus.appliesFrom ? ` (vanaf ${e.omnibus.appliesFrom})` : "";
          lines.push(`**Omnibus${from}:** ${e.omnibus.note}`);
        }
        if (e.refs?.length) {
          lines.push(
            `**Grondslag:** ${e.refs.map((r) => `[${r.label}](${BASE_URL}${r.href})`).join(" · ")}`,
          );
        }
      }
      lines.push(
        "",
        `Zelfbeoordeling met status per verplichting: ${BASE_URL}/assessment`,
      );
      return text(lines.join("\n"));
    },
  );

  return server;
}
