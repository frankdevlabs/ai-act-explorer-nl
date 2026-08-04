import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Amendment } from "../../src/lib/types.js";
import type { Module, RiskClass, RoleFlag } from "../../src/lib/assessment/types.js";
import { obligationCatalog, unresolvedConditions } from "../../src/lib/assessment/engine.js";
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
import { refLinks, renderAnnex, renderArticle, renderSegments, renderText } from "./render.js";
import { err, registerTool, text } from "./core/tools.js";
import {
  checkPackSize,
  estTokens,
  packLimitsFromEnv,
  tooManyArticlesMessage,
} from "./core/size.js";
import { fmt, helpLines, plural } from "./core/text.js";
import {
  STATE_ENV,
  assessmentEnabled,
  mergeById,
  readState,
  renderAssessment,
  statePath,
  unwrapEnvelope,
  validateBlob,
  writeAuthorized,
  writeState,
} from "./assessment-state.js";

/**
 * Result-size guardrails for get_context_pack — the only tool here that can
 * return an unbounded amount of text (it composes N full articles + their
 * recitals). The policy, the ceilings and the Dutch refusal templates live in
 * core/size.ts (shared with the sibling explorers); the corpus facts they quote
 * are filled in at the call site below. Read once at module scope, as the tool
 * description quotes the same numbers the guard enforces.
 */
const PACK = packLimitsFromEnv();

const omnibusSlugs = () => amendments.newArticles.map((a) => a.slug).join(", ");

function amendmentById(id: string): Amendment | undefined {
  return amendments.amendments.find((a) => `${a.seq}${a.sub ?? ""}` === id);
}

/**
 * A `showIf` tree, rendered twice: the raw JSON (a claude.ai-side skill must be
 * able to re-evaluate the gate against an answer blob) and, with no facts at
 * all, the Dutch phrases the obligation catalog already uses for the same
 * trees. Both, because either alone is lossy — the gloss flattens all/any/not
 * to its atoms, which is why the JSON leads.
 */
const conditionLine = (cond: NonNullable<Module["showIf"]>) =>
  `\`${JSON.stringify(cond)}\` — atomen: ${unresolvedConditions(cond, {}).join(" · ")}`;

export function createServer(): McpServer {
  const server = new McpServer({ name: "ai-act-explorer-nl", version: "0.1.0" });

  registerTool(
    server,
    "search_ai_act",
    {
      title: "Zoek in de AI-verordening",
      description:
        "Full-text search in the Dutch text of the EU AI Act (Regulation 2024/1689, consolidated) " +
        "plus the digital-omnibus amendment layer. Returns hits with deep links to " +
        BASE_URL +
        ". Query in Dutch works best.",
      inputSchema: {
        query: z.string().min(2).max(200).describe("Search terms (Dutch)"),
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

  registerTool(
    server,
    "get_article",
    {
      title: "Artikel ophalen",
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

  registerTool(
    server,
    "get_recital",
    {
      title: "Overweging ophalen",
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

  registerTool(
    server,
    "get_annex",
    {
      title: "Bijlage ophalen",
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

  registerTool(
    server,
    "get_structure",
    {
      title: "Structuur (inhoudsopgave)",
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

  registerTool(
    server,
    "get_amendments",
    {
      title: "Omnibus-wijzigingen",
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

  registerTool(
    server,
    "get_context_pack",
    {
      title: "Contextpakket: artikelen + overwegingen + omnibus-status",
      description:
        "One call per review instead of three per provision: for each requested article the full " +
        "Dutch text, its digital-omnibus status, and the recitals the editorial recital map ties " +
        "to it — with every referenced recital rendered once, deduplicated across the pack. " +
        "Use this to open a contract or memo review; use get_article for a single provision and " +
        "get_amendments when you need the per-lid word diff. " +
        `Hard limits: at most ${PACK.maxArticles} articles per call, and the assembled pack must ` +
        `stay under ${fmt(PACK.maxChars, ",")} characters (~${fmt(estTokens(PACK.maxChars, PACK), ",")} tokens); ` +
        "a pack over either is refused, never truncated. Ask for the provisions you need, not the " +
        "maximum: a pack runs to roughly 13k characters per article once its recitals are " +
        "included, so about 5 articles already fill a default result budget.",
      inputSchema: {
        articles: z
          .array(z.string())
          .min(1)
          .describe(
            `Article numbers, e.g. ["6", "50", "75 bis"]. At most ${PACK.maxArticles}, and fewer if the pack would exceed the size ceiling.`,
          ),
      },
    },
    async ({ articles }) => {
      // Count cap. Enforced here rather than with zod's .max(): zod's too_big
      // message is static and never names the request size, and the SDK rejects
      // before the handler runs — so the caller could not see how far over they
      // were, nor how to re-split.
      if (articles.length > PACK.maxArticles) {
        // No corpusLabel: this is a single-instrument corpus, so the shared
        // template's " uit <citation>" clause stays absent.
        return err(tooManyArticlesMessage(articles.length, PACK));
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

      // Size ceiling and warning band: the policy and the Dutch templates are
      // core/size.ts's (they are identical across the explorers); the facts they
      // quote are this corpus's. Measured only after assembly — the per-article
      // cost is dominated by recitals, which are deduplicated across the pack,
      // so it cannot be predicted from the article count alone.
      const md = body.join("\n\n---\n\n");
      const verdict = checkPackSize(md, PACK, {
        sections: sections.length,
        sizes,
        sharedRecitals: uniqueRecitals.length,
        sharedRecitalChars: body.slice(recitalStart).reduce((n, s) => n + s.length, 0),
        singleArticleHint: "zonder overwegingen",
      });
      if (verdict.kind === "refused") return err(verdict.message);
      // The banner goes first on purpose: if a client truncates anyway, the size
      // notice is in the part that survives.
      if (verdict.kind === "warn") return text(`${verdict.banner}\n\n${md}`);
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

  registerTool(
    server,
    "get_obligations",
    {
      title: "Verplichtingencatalogus per rol en risicoklasse",
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

  // ---------------------------------------------------------------------
  // Batch 2 (roadmap 2.2): the convenience half — curated layers the corpus
  // already encodes, served as-is instead of paraphrased from structure.

  registerTool(
    server,
    "get_questionnaire",
    {
      title: "Zelfbeoordelingsvragenlijst (modules en vragen)",
      description:
        "The curated self-assessment questionnaire behind " +
        BASE_URL +
        "/assessment: modules, questions, answer types, visibility conditions and flag effects. " +
        "Without arguments: the module list. With `module`: that module in full — enough to " +
        "interpret a stored answer blob without a repo checkout — `showIf` is emitted as raw JSON " +
        "(authoritative: it carries the all/any/not structure) plus an indicative Dutch gloss of " +
        "its atoms. There is deliberately no " +
        "all-modules mode (the questionnaire is ~108 kB of JSON); ask per module. Editorial " +
        "content: it paraphrases obligations and deep-links to the legal text, which lives in " +
        "get_article.",
      inputSchema: {
        module: z
          .string()
          .optional()
          .describe(
            'Module id ("m19") or module number ("12"). Resolved by id first, then by number — ' +
              "the ids are historical and not in module order (m19 is module 12, m12 is module 18).",
          ),
      },
    },
    async ({ module }) => {
      const meta = questionnaire.meta;
      const totalQuestions = questionnaire.modules.reduce((n, m) => n + m.questions.length, 0);

      if (module == null) {
        const lines = [
          `# ${meta.title} — versie ${meta.version} (bijgewerkt ${meta.updated})`,
          "",
          `${questionnaire.modules.length} modules, ${totalQuestions} vragen. Grondslag: ${meta.basis}`,
          "",
          `> ${meta.disclaimer}`,
          "",
          'Roep dit tool opnieuw aan met `module` (id of nummer) voor de volledige module. "Voorwaardelijk" = ' +
            "de module wordt alleen getoond als eerdere antwoorden dat oproepen.",
          "",
        ];
        for (const m of questionnaire.modules) {
          const flags = [
            m.showIf ? "voorwaardelijk" : null,
            m.financeOnly ? "alleen financiële entiteiten" : null,
            m.omnibus ? "omnibus-annotatie" : null,
          ].filter(Boolean);
          const obligations = m.questions.filter((q) => q.obligation).length;
          lines.push(
            `- **Module ${m.nr}** \`${m.id}\` — ${m.title} — ` +
              `${plural(m.questions.length, "vraag", "vragen")}, ${plural(obligations, "verplichting", "verplichtingen")}` +
              `${flags.length ? ` · ${flags.join(" · ")}` : ""}`,
          );
        }
        lines.push("", `Vragenlijst op de site: ${BASE_URL}/assessment/vragenlijst`);
        return text(lines.join("\n"));
      }

      // id before nr: the ids are not in module order, and a caller who names
      // "m12" means the module with that id, not module 12.
      const wanted = module.trim().toLowerCase().replace(/^module\s*/, "");
      const mod =
        questionnaire.modules.find((m) => m.id.toLowerCase() === wanted) ??
        questionnaire.modules.find((m) => String(m.nr) === wanted);
      if (!mod) {
        return err(
          `Module "${module}" niet gevonden. Beschikbaar: ` +
            `${questionnaire.modules.map((m) => `${m.id} (nr ${m.nr})`).join(", ")}.`,
        );
      }

      const lines = [`# Module ${mod.nr} \`${mod.id}\` — ${mod.title}`, ""];
      const obligations = mod.questions.filter((q) => q.obligation).length;
      lines.push(
        `${plural(mod.questions.length, "vraag", "vragen")}, ${plural(obligations, "verplichting", "verplichtingen")}.`,
      );
      if (mod.showIf) lines.push(`**Zichtbaar als:** ${conditionLine(mod.showIf)}`);
      if (mod.financeOnly) lines.push("**Alleen relevant voor financiële entiteiten (DORA/Wft).**");
      if (mod.omnibus) {
        const from = mod.omnibus.appliesFrom ? ` (vanaf ${mod.omnibus.appliesFrom})` : "";
        lines.push(`**Omnibus${from}:** ${mod.omnibus.note}`);
      }
      if (mod.refs?.length) lines.push(`**Grondslag:** ${refLinks(mod.refs)}`);
      const intro = helpLines(mod.intro);
      if (intro.length) lines.push("", ...intro);

      for (const q of mod.questions) {
        lines.push("", `## Vraag ${q.id}`, "", q.text, "");
        lines.push(`- **Antwoordtype:** ${q.answerType}`);
        if (q.options?.length) {
          lines.push(
            `- **Opties:** ${q.options.map((o) => `\`${o.value}\` = ${o.label}`).join(" · ")}`,
          );
        }
        if (q.showIf) lines.push(`- **Zichtbaar als:** ${conditionLine(q.showIf)}`);
        if (q.effects?.length) {
          lines.push(
            `- **Effecten:** ${q.effects
              .map(
                (e) =>
                  `bij antwoord ${[e.when].flat().map((w) => `"${w}"`).join("/")} → vlag \`${e.setFlag}\``,
              )
              .join(" · ")} \`${JSON.stringify(q.effects)}\``,
          );
        }
        const marks = [
          q.obligation ? "verplichting" : null,
          q.prohibition ? "verbod (art. 5) — een 'ja' is een STOP" : null,
          q.register ? `registerkolom \`${q.register}\`` : null,
        ].filter(Boolean);
        if (marks.length) lines.push(`- **Markering:** ${marks.join(" · ")}`);
        if (q.omnibus) {
          const from = q.omnibus.appliesFrom ? ` (vanaf ${q.omnibus.appliesFrom})` : "";
          lines.push(`- **Omnibus${from}:** ${q.omnibus.note}`);
        }
        if (q.refs?.length) lines.push(`- **Grondslag:** ${refLinks(q.refs)}`);
        const help = helpLines(q.help);
        if (help.length) lines.push("", "**Toelichting:**", ...help);
      }

      lines.push("", `Vragenlijst op de site: ${BASE_URL}/assessment/vragenlijst`);
      return text(lines.join("\n"));
    },
  );

  registerTool(
    server,
    "get_recital_map",
    {
      title: "Overwegingenkaart (overweging ↔ artikel)",
      description:
        "The curated recital↔article map: which operative articles a recital motivates, and which " +
        "recitals bear on an article. Without arguments: the whole map plus its coverage counts. " +
        "With `article` or `recital` (mutually exclusive): that entry only. This is editorial " +
        "metadata, not legal text — it never changes the wording of either — and it is still " +
        'being curated, so a missing entry means "not yet mapped", never "no relevant recital ' +
        'exists". Use get_recital / get_article for the text itself.',
      inputSchema: {
        article: z.string().optional().describe('Article number, e.g. "6" or "75 bis"'),
        recital: z.coerce
          .number()
          .int()
          .min(1)
          .max(180)
          .optional()
          .describe("Recital number (1–180)"),
      },
    },
    async ({ article, recital }) => {
      if (article != null && recital != null) {
        return err(
          "Geef `article` of `recital`, niet allebei — de kaart is in beide richtingen te bevragen, maar per aanroep in één richting.",
        );
      }
      const caveat =
        `> Gecureerde redactionele laag: ${recitalMap.meta.pairCount} paren, ` +
        `${recitalMap.meta.reviewedCount} overwegingen nagelopen, nog niet afgerond ` +
        `(complete: ${recitalMap.meta.complete}). Een lege lijst betekent "nog niet in kaart ` +
        'gebracht", niet "geen relevante overweging".';
      const articleLink = (slug: string) => {
        const display = amendments.newArticles.find((n) => n.slug === slug)?.displayNumber ?? slug;
        return `[Artikel ${display}](${BASE_URL}/artikel/${slug})`;
      };

      if (article != null) {
        const key = normalizeArticleInput(article);
        const resolved = resolveArticle(key);
        if (!resolved) {
          return err(
            `Artikel "${article}" niet gevonden. Basisartikelen: 1–113. Omnibus-artikelen: ${omnibusSlugs()}.`,
          );
        }
        const display =
          resolved.kind === "base" ? String(resolved.article.number) : resolved.spec.displayNumber;
        const title = resolved.kind === "base" ? resolved.article.title : resolved.spec.title;
        const nums = recitalMap.byArticle[key] ?? [];
        return text(
          [
            `# Overwegingen bij artikel ${display} — ${title}`,
            "",
            caveat,
            "",
            nums.length
              ? `${plural(nums.length, "overweging", "overwegingen")}:\n${nums
                  .map((n) => `- [Overweging ${n}](${BASE_URL}/overweging/${n})`)
                  .join("\n")}`
              : "Nog geen overwegingen in kaart gebracht voor dit artikel.",
            "",
            `Artikel: ${BASE_URL}/artikel/${key}`,
          ].join("\n"),
        );
      }

      if (recital != null) {
        const slugs = recitalMap.byRecital[String(recital)] ?? [];
        return text(
          [
            `# Artikelen bij overweging ${recital}`,
            "",
            caveat,
            "",
            slugs.length
              ? `${plural(slugs.length, "artikel", "artikelen")}: ${slugs.map(articleLink).join(" · ")}`
              : "Deze overweging is nog niet aan artikelen gekoppeld.",
            "",
            `Overweging: ${BASE_URL}/overweging/${recital}`,
          ].join("\n"),
        );
      }

      const mapped = Object.keys(recitalMap.byRecital)
        .map(Number)
        .sort((a, b) => a - b);
      const unmapped: number[] = [];
      for (let n = 1; n <= toc.recitalCount; n++) {
        if (!recitalMap.byRecital[String(n)]) unmapped.push(n);
      }
      const lines = [
        `# Overwegingenkaart — ${recitalMap.meta.pairCount} paren`,
        "",
        caveat,
        "",
        `${mapped.length} van de ${toc.recitalCount} overwegingen zijn in kaart gebracht; ` +
          `${Object.keys(recitalMap.byArticle).length} artikelen hebben ten minste één overweging.`,
        "",
        `Nog niet in kaart gebracht: ${unmapped.length ? unmapped.join(", ") : "geen"}.`,
        "",
        "## Overweging → artikelen",
        "",
      ];
      for (const n of mapped) {
        lines.push(
          `- [Overweging ${n}](${BASE_URL}/overweging/${n}) → ${recitalMap.byRecital[String(n)]
            .map(articleLink)
            .join(" · ")}`,
        );
      }
      lines.push("", `Alle overwegingen: ${BASE_URL}/overwegingen`);
      return text(lines.join("\n"));
    },
  );

  // ---------------------------------------------------------------------
  // Roadmap 4.1: the assessment bridge — the only non-read surface here.
  //
  // Registered *only* when AIACT_ASSESSMENT_STATE names a state file, so the
  // public deployment (which sets PORT/BASE_URL and nothing else) keeps
  // advertising exactly the read tools above and gains no write path. The
  // credential is MCP_TOKEN, the same var http.ts checks as a bearer header.
  if (assessmentEnabled()) {
    registerTool(
      server,
      "get_assessment",
      {
        title: "Assessmentstatus ophalen",
        description:
          "Read the assessment state stored on this server: the `aiact-assessments` blob " +
          '(`{"v":1,"systems":[{id,name,answers,createdAt,updatedAt}]}`) — the same bytes the ' +
          "self-assessment's Export JSON produces, so it round-trips through put_assessment " +
          "unchanged. Answers only: risk class, roles and obligation status are never stored, " +
          `they are recomputed (${BASE_URL}/assessment, or get_obligations for the catalog). ` +
          "Use `system` to fetch one application when the state has grown large.",
        inputSchema: {
          system: z
            .string()
            .optional()
            .describe("Restrict to one application: its id, or a substring of its name"),
        },
      },
      async ({ system }) => {
        try {
          return text(renderAssessment(readState(), { system, maxChars: PACK.maxChars }));
        } catch (e) {
          return err(`Assessmentstatus niet leesbaar: ${(e as Error).message}`);
        }
      },
    );

    registerTool(
      server,
      "put_assessment",
      {
        title: "Assessmentstatus opslaan",
        // Not read-only, and honestly destructive: a record already stored
        // under the same id is replaced wholesale, so an answer can be lost by
        // submitting a stale blob. It is idempotent (the same blob twice leaves
        // the same state) and touches nothing outside the state file.
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
        description:
          "Write the assessment state. Requires authentication: the server must run with " +
          "MCP_TOKEN set (over HTTP the connector sends it as `Authorization: Bearer <token>`); " +
          "without it the call is refused, never silently accepted. `blob` is a **full** v1 " +
          'export blob (`{"v":1,"systems":[…]}`, optionally wrapped in a bridge envelope), never ' +
          "a patch. Merge is by system id, incoming wins; a system that is absent from the blob " +
          "is left untouched — this tool cannot delete. Every answer is validated against the " +
          "current questionnaire (get_questionnaire): an unknown question id or an invalid " +
          "option value rejects the whole write, nothing is partially stored.",
        inputSchema: {
          blob: z
            .object({})
            .passthrough()
            .describe(
              'Complete v1 blob, e.g. {"v":1,"systems":[{"id":"sys-1","name":"…","answers":{"1.1":"…"}}]}',
            ),
        },
      },
      async ({ blob }) => {
        if (!writeAuthorized()) {
          return err(
            "Schrijven geweigerd: dit endpoint is niet geauthenticeerd. De server draait zonder " +
              "MCP_TOKEN, dus er is geen inloggegeven om tegen te toetsen. Zet MCP_TOKEN op de " +
              "server (en stuur bij HTTP `Authorization: Bearer <token>` mee) en probeer opnieuw. " +
              "Er is niets opgeslagen.",
          );
        }

        const unwrapped = unwrapEnvelope(blob);
        if ("error" in unwrapped) {
          return err(`Blob geweigerd: ${unwrapped.error} Er is niets opgeslagen.`);
        }

        const validation = validateBlob(unwrapped.blob);
        if (!validation.ok) {
          return err(
            [
              `Blob geweigerd: ${validation.errors.length + validation.more} fout(en) gevonden. Er is niets opgeslagen — een gedeeltelijke schrijfactie zou de status onbetrouwbaar maken.`,
              "",
              ...validation.errors.map((e) => `- ${e}`),
              ...(validation.more ? [`- … en nog ${validation.more} fout(en).`] : []),
              "",
              'Verwacht: een volledige exportblob {"v":1,"systems":[{"id":…,"name":…,"answers":{…}}]}. ' +
                "Geldige vraag-ids en optiewaarden: tool get_questionnaire.",
            ].join("\n"),
          );
        }

        try {
          const stored = readState();
          const { merged, added, updated, untouched } = mergeById(stored, validation.state);
          writeState(merged);
          const list = (ids: string[]) => (ids.length ? ` (${ids.join(", ")})` : "");
          return text(
            [
              `# Assessmentstatus opgeslagen`,
              "",
              `${added.length} toegevoegd${list(added)}, ${updated.length} bijgewerkt${list(updated)}, ` +
                `${untouched.length} ongewijzigd${list(untouched)} — ${merged.systems.length} toepassing(en) in totaal.`,
              "",
              `Statusbestand: \`${statePath()}\` (${STATE_ENV}). Weglaten verwijdert niets: een systeem dat niet in de blob stond, staat er nog.`,
              "",
              `Uitkomsten herberekenen: ${BASE_URL}/assessment · verplichtingen per rol: tool get_obligations.`,
            ].join("\n"),
          );
        } catch (e) {
          return err(`Opslaan mislukt: ${(e as Error).message} Er is niets opgeslagen.`);
        }
      },
    );
  }

  return server;
}
