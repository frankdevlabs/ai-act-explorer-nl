/**
 * Shared corpus index for verify scripts: article anchors, annex romans and
 * recital numbers built from data/generated/, plus the ref-href checker that
 * validates curated deep links (questionnaire refs, obligation catalog,
 * register export). Extracted verbatim from verify-assessment.ts (card #176) —
 * keep the assert messages stable, two gates depend on them.
 *
 * One href grammar, one implementation: duplicating the checker would let a
 * new href form pass in one gate and fail in the other.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmendmentsGenerated, Annex, Article, ContentNode, Recital } from "../../src/lib/types";

export interface Corpus {
  articles: Article[];
  annexes: Annex[];
  recitals: Recital[];
  amendments: AmendmentsGenerated;
}

export function loadCorpus(root: string): Corpus {
  const load = <T>(rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf-8"));
  return {
    articles: load<Article[]>("data/generated/articles.json"),
    annexes: load<Annex[]>("data/generated/annexes.json"),
    recitals: load<Recital[]>("data/generated/recitals.json"),
    amendments: load<AmendmentsGenerated>("data/generated/amendments.json"),
  };
}

export function collectAnchors(nodes: ContentNode[], into: Set<string>): void {
  for (const node of nodes) {
    if (node.type === "list") {
      for (const item of node.items) {
        if (item.anchor) into.add(item.anchor);
        collectAnchors(item.content, into);
      }
    }
  }
}

export function articleAnchors(paragraphs: { anchor: string; content: ContentNode[] }[]): Set<string> {
  const anchors = new Set<string>();
  for (const p of paragraphs) {
    anchors.add(p.anchor);
    collectAnchors(p.content, anchors);
  }
  return anchors;
}

/** Curated internal info pages the questionnaire may link to (exact match, no fragments). */
export const INTERNAL_PAGES = new Set([
  "/gpai-praktijkcode",
  "/conformiteitsbeoordeling",
  "/transparantie-art50",
]);

/** `checkRef(owner, href)`: asserts the href resolves against the corpus. */
export function makeCheckRef(corpus: Corpus) {
  const { articles, annexes, recitals, amendments } = corpus;
  const annexRomans = new Set([
    ...annexes.map((a) => a.roman.toLowerCase()),
    ...amendments.newAnnexes.map((a) => a.roman.toLowerCase()),
  ]);
  const recitalNumbers = new Set(recitals.map((r) => r.number));

  return function checkRef(owner: string, href: string): void {
    const [pathWithQuery, fragment] = href.split("#");
    const path = pathWithQuery.split("?")[0];
    const art = path.match(/^\/artikel\/(\d+)$/);
    if (art) {
      const a = articles.find((x) => x.number === Number(art[1]));
      assert.ok(a, `${owner}: artikel ${art[1]} bestaat`);
      if (fragment)
        assert.ok(articleAnchors(a!.paragraphs).has(fragment), `${owner}: anchor ${href}`);
      return;
    }
    const newArt = path.match(/^\/artikel\/(\d+(?:bis|ter|quater|quinquies))$/);
    if (newArt) {
      const spec = amendments.newArticles.find((n) => n.slug === newArt[1]);
      assert.ok(spec, `${owner}: omnibus-artikel ${newArt[1]} bestaat`);
      if (fragment)
        assert.ok(articleAnchors(spec!.paragraphs).has(fragment), `${owner}: anchor ${href}`);
      return;
    }
    const anx = path.match(/^\/bijlage\/([a-z]+)$/);
    if (anx) {
      assert.ok(annexRomans.has(anx[1]), `${owner}: bijlage ${anx[1]} bestaat`);
      assert.ok(!fragment, `${owner}: geen fragmenten op bijlagen (${href})`);
      return;
    }
    const rct = path.match(/^\/overweging\/(\d+)$/);
    if (rct) {
      assert.ok(recitalNumbers.has(Number(rct[1])), `${owner}: overweging ${rct[1]} bestaat`);
      return;
    }
    if (INTERNAL_PAGES.has(path)) {
      assert.ok(!fragment, `${owner}: geen fragmenten op interne pagina's (${href})`);
      return;
    }
    assert.fail(`${owner}: onbekend ref-pad ${href}`);
  };
}
