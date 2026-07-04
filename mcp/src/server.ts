import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Amendment } from "../../src/lib/types.js";
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
  recitalMap,
  resolveArticle,
  slugRank,
  toc,
} from "./data.js";
import { renderAnnex, renderArticle, renderSegments, renderText } from "./render.js";

const text = (md: string) => ({ content: [{ type: "text" as const, text: md }] });
const err = (md: string) => ({ content: [{ type: "text" as const, text: md }], isError: true });

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

  return server;
}
