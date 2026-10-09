import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Amendment, ParagraphDiff } from "../../src/lib/types.js";
import { APPLICATION_CAVEAT, actLabel, dutchDate, inForceSince, statusText } from "../../src/lib/amendment-meta.js";
import { PRECISION_SEARCH_OPTIONS, makeSnippet, searchDocs } from "../../src/lib/search-core.js";
import {
  BASE_URL,
  amendmentDiffs,
  amendments,
  annexes,
  getAnnex,
  getArticle,
  getRecital,
  index,
  isNewAnnex,
  isNewArticle,
  normalizeArticleInput,
  recitalMap,
  resolveArticle,
  toc,
} from "./data.js";
import { renderAnnex, renderArticle, renderSegments, renderText } from "./render.js";

const text = (md: string) => ({ content: [{ type: "text" as const, text: md }] });
const err = (md: string) => ({ content: [{ type: "text" as const, text: md }], isError: true });

const OP_LABEL: Record<Amendment["operation"], string> = {
  replace: "vervangen",
  insert: "ingevoegd",
  add: "toegevoegd",
  delete: "geschrapt",
};
const STATUS_LABEL: Record<ParagraphDiff["status"], string> = {
  modified: "gewijzigd",
  inserted: "ingevoegd",
  deleted: "geschrapt",
  unchanged: "ongewijzigd",
};

/** "Status: in werking sinds 27 juli 2026; verwerkt in de geldende tekst (…). In werking ≠ van toepassing …" */
const statusLine = () =>
  `Status: ${inForceSince(amendments.meta)}; verwerkt in de geldende tekst (geconsolideerd ${amendments.meta.current}). ${APPLICATION_CAVEAT}`;

/** "**Instructie 2) a)** (vervangen): artikel 2 wordt als volgt gewijzigd: … lid 2 wordt vervangen door:" */
const instructionLine = (am: Amendment) =>
  `- **Instructie ${am.seq})${am.sub ? ` ${am.sub})` : ""}** (${OP_LABEL[am.operation]}): ` +
  `${am.parentIntro ? `${am.parentIntro} … ` : ""}${am.intro}`;

const articleLabel = (slug: string) => `Artikel ${getArticle(slug)?.displayNumber ?? slug}`;

/** Per-paragraph word diffs as markdown. */
function diffSection(diffs: ParagraphDiff[]): string[] {
  const lines = [
    "",
    `## Wijzigingen per lid t.o.v. de tekst vóór ${dutchDate(amendments.meta.inForce)} (~~geschrapt~~ / **ingevoegd**)`,
  ];
  for (const d of diffs) {
    if (d.status === "unchanged") continue;
    const label = d.anchor === "inhoud" ? "inhoud" : d.displayNumber ? `lid ${d.displayNumber}` : d.anchor.replace(/^lid-/, "lid ");
    lines.push("", `### ${label} (${STATUS_LABEL[d.status]})`, "");
    if (d.segments) lines.push(renderSegments(d.segments).replace(/\n+/g, " "));
  }
  return lines;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "ai-act-explorer-nl", version: "0.1.0" });

  server.registerTool(
    "search_ai_act",
    {
      title: "Zoek in de AI-verordening",
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
      description:
        'Full Dutch text of an article as in force (consolidated text incl. the digital omnibus, ' +
        'Regulation (EU) 2026/1744): "1"–"113" plus the inserted "4 bis", "60 bis", "75 bis"–"75 quinquies".',
      inputSchema: {
        number: z.string().describe('Article number, e.g. "6" or "75 bis"'),
      },
    },
    async ({ number }) => {
      const key = normalizeArticleInput(number);
      const resolved = resolveArticle(key);
      if (!resolved) {
        return err(
          `Artikel "${number}" niet gevonden. Artikelen: 1–113 en ${amendments.newArticles.map((a) => a.displayNumber).join(", ")}.`,
        );
      }
      let md = renderArticle(resolved);
      if (amendmentDiffs.articles[key] || amendments.titleChanges[key]) {
        md += `\n\n> Let op: dit artikel is gewijzigd bij ${actLabel(amendments.meta)}, ${inForceSince(amendments.meta)}. Hierboven staat de geldende tekst; de wijzigingen: get_amendments of ${BASE_URL}/artikel/${key}?diff=1. ${APPLICATION_CAVEAT}`;
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
              return `${articleLabel(s)} — ${BASE_URL}/artikel/${s}`;
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
      description:
        "Full Dutch text of an annex (bijlage) as in force, by Roman numeral, e.g. \"III\" (I–XIV; XIV added by Regulation (EU) 2026/1744).",
      inputSchema: {
        roman: z.string().describe('Annex Roman numeral, e.g. "III"'),
      },
    },
    async ({ roman }) => {
      const key = roman.trim().replace(/^bijlage\s*/i, "");
      const a = getAnnex(key);
      if (!a) {
        return err(`Bijlage "${roman}" niet gevonden. Beschikbaar: ${annexes.map((x) => x.roman).join(", ")}.`);
      }
      return text(renderAnnex(a));
    },
  );

  server.registerTool(
    "get_structure",
    {
      title: "Structuur (inhoudsopgave)",
      description:
        "Compact table of contents of the text in force: chapters, sections, articles (marking those inserted by Regulation (EU) 2026/1744), annexes, recital count.",
      inputSchema: {},
    },
    async () => {
      const lines: string[] = [
        `# Verordening (EU) 2024/1689 — structuur (geldende tekst, ${amendments.meta.current})`,
        "",
      ];
      const act = amendments.meta.document.replace(/^Verordening/, "Vo.");
      for (const ch of toc.chapters) {
        lines.push(`## Hoofdstuk ${ch.roman} — ${ch.title}`);
        const pushArticle = (a: { slug: string; displayNumber: string; title: string }) => {
          const mark = isNewArticle(a.slug) ? ` (ingevoegd bij ${act})` : "";
          lines.push(`- Artikel ${a.displayNumber}${mark}: ${a.title} — ${BASE_URL}/artikel/${a.slug}`);
        };
        for (const a of ch.articles) pushArticle(a);
        for (const sec of ch.sections) {
          lines.push(`### Afdeling ${sec.number} — ${sec.title}`);
          for (const a of sec.articles) pushArticle(a);
        }
        lines.push("");
      }
      lines.push("## Bijlagen");
      for (const a of toc.annexes) {
        const mark = isNewAnnex(a.roman) ? ` (toegevoegd bij ${act})` : "";
        lines.push(`- Bijlage ${a.roman}${mark}: ${a.title} — ${BASE_URL}/bijlage/${a.roman.toLowerCase()}`);
      }
      lines.push("", `${toc.recitalCount} overwegingen — ${BASE_URL}/overwegingen`);
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "get_amendments",
    {
      title: "Omnibus-wijzigingen",
      description:
        "Changes made to the AI Act by the digital omnibus, Regulation (EU) 2026/1744 — in force since " +
        "27 July 2026 and already part of the text the other tools return. Without arguments: status, source " +
        "and overview of all changed articles/annexes. With an article or annex: the verbatim amending " +
        "instructions plus a word-level diff against the text before entry into force " +
        "(~~deleted~~ / **inserted**).",
      inputSchema: {
        article: z.string().optional().describe('Article number, e.g. "6" or "75 bis"'),
        annex: z.string().optional().describe('Annex Roman numeral, e.g. "I"'),
      },
    },
    async ({ article, annex }) => {
      const meta = amendments.meta;
      const header = [`# Wijzigingen bij ${actLabel(meta)}`, "", statusLine(), `Bron: ${statusText.publication(meta)} — ${meta.eli}`];
      if (!article && !annex) {
        const changedArticles = Object.keys(amendmentDiffs.articles).length;
        const changedAnnexes = Object.keys(amendmentDiffs.annexes).length;
        const topLevel = new Set(amendments.amendments.map((a) => a.seq)).size;
        const lines = [
          ...header,
          "",
          `${topLevel} instructies (${amendments.amendments.length} incl. subinstructies); ${changedArticles} gewijzigde artikelen; ` +
            `${amendments.newArticles.length} ingevoegde artikelen; ${changedAnnexes} gewijzigde bijlagen; ` +
            `${amendments.newAnnexes.length} toegevoegde bijlage(n).`,
          "",
          "Gewijzigde onderdelen in documentvolgorde:",
          ...amendments.orderedTargets.map((t) => {
            if (t.kind === "article") {
              return isNewArticle(t.slug)
                ? `- ${articleLabel(t.slug)} (ingevoegd) — ${BASE_URL}/artikel/${t.slug}`
                : `- ${articleLabel(t.slug)} — ${BASE_URL}/artikel/${t.slug}?diff=1`;
            }
            return isNewAnnex(t.slug)
              ? `- Bijlage ${t.slug.toUpperCase()} (toegevoegd) — ${BASE_URL}/bijlage/${t.slug}`
              : `- Bijlage ${t.slug.toUpperCase()} — ${BASE_URL}/bijlage/${t.slug}?diff=1`;
          }),
          "",
          `Volledig overzicht: ${BASE_URL}/wijzigingen`,
        ];
        return text(lines.join("\n"));
      }

      const byId = (ids: string[]) => amendments.amendments.filter((a) => ids.includes(a.id));
      if (annex) {
        const roman = annex.trim().replace(/^bijlage\s*/i, "").toLowerCase();
        const a = getAnnex(roman);
        if (!a) return err(`Bijlage "${annex}" niet gevonden. Beschikbaar: ${annexes.map((x) => x.roman).join(", ")}.`);
        const ids = amendments.byAnnex[roman] ?? [];
        if (!ids.length)
          return text(`Bijlage ${a.roman} is niet gewijzigd bij ${actLabel(meta)}.`);
        const lines = [`# Wijzigingen aan bijlage ${a.roman} bij ${meta.document}`, "", statusLine(), "", ...byId(ids).map(instructionLine)];
        if (isNewAnnex(roman)) lines.push("", `Bijlage ${a.roman} is in zijn geheel toegevoegd; de volledige tekst: get_annex.`);
        const diffs = amendmentDiffs.annexes[roman];
        if (diffs) lines.push(...diffSection(diffs), "", `Diff-weergave op de site: ${BASE_URL}/bijlage/${roman}?diff=1`);
        return text(lines.join("\n"));
      }

      const key = normalizeArticleInput(article!);
      const target = getArticle(key);
      if (!target) return err(`Artikel "${article}" niet gevonden.`);
      const ids = amendments.byArticle[key] ?? [];
      if (!ids.length) {
        return text(
          `Artikel ${target.displayNumber} is niet gewijzigd bij ${actLabel(meta)}. ` +
            `Gewijzigde artikelen: ${Object.keys(amendments.byArticle).map((s) => getArticle(s)?.displayNumber ?? s).join(", ")}.`,
        );
      }
      const lines = [
        `# Wijzigingen aan artikel ${target.displayNumber} bij ${meta.document}`,
        "",
        statusLine(),
        "",
        ...byId(ids).map(instructionLine),
      ];
      if (isNewArticle(key)) {
        lines.push("", `Artikel ${target.displayNumber} is in zijn geheel ingevoegd; de volledige tekst: get_article.`);
        return text(lines.join("\n"));
      }
      const title = amendments.titleChanges[key];
      if (title) lines.push("", `Titel: ~~${title.previous}~~ **${title.title}**`);
      const diffs = amendmentDiffs.articles[key];
      if (diffs) lines.push(...diffSection(diffs));
      lines.push("", `Diff-weergave op de site: ${BASE_URL}/artikel/${key}?diff=1`);
      return text(lines.join("\n"));
    },
  );

  return server;
}
