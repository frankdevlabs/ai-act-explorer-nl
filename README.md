# AI-verordening Explorer (NL)

Doorzoekbare Nederlandse tekst van de **AI-verordening (EU) 2024/1689** zoals die geldt
sinds 27 juli 2026 — 119 artikelen, 180 overwegingen en 14 bijlagen — met de wijzigingen
van de digitale omnibus (Verordening (EU) 2026/1744) als wijzigingsweergave. Geïnspireerd op
[artificialintelligenceact.eu/ai-act-explorer](https://artificialintelligenceact.eu/ai-act-explorer/).

Volledig statische Next.js-site (`output: 'export'`), geen database. Zoeken gebeurt
client-side met MiniSearch over een build-time index (Ctrl+K / ⌘K).

## Structuur

- `data/source/corpus.json` — welke EUR-Lex-bestanden gelden:
  - `consolidated/02024R1689-20260727.html` — geconsolideerde NL tekst per 27.7.2026
    (incl. Verordening (EU) 2026/1744 en rectificaties); bron voor artikelen, bijlagen en
    inhoudsopgave;
  - `consolidated/02024R1689-20240712.html` — de geconsolideerde tekst daarvóór; alleen
    gebruikt voor de wijzigingsweergave;
  - `aiact_nl.html` — oorspronkelijke NL OJ-tekst; geconsolideerde versies bevatten geen
    preambule, dus de 180 overwegingen komen hieruit;
  - `amending/32026R1744.html` — de OJ-tekst van de digitale omnibus (wijzigingsinstructies
    en datum van inwerkingtreding).

  Alles opgehaald met headless Chromium (EUR-Lex zit achter een AWS-WAF; zie de
  `update-source`-skill).
- `scripts/parse-aiact.ts` + `scripts/lib/consolidated.ts` — deterministische
  HTML→JSON-parser (cheerio); geen handmatige transcriptie.
- `scripts/parse-amendments.ts` — wijzigingslaag: verschil tussen de twee geconsolideerde
  versies, per paragraaf toegeschreven aan de instructies van de omnibus.
- `scripts/verify-*.ts` — assertions op volledigheid (aantallen, structuur, spot-checks) en
  op de wijzigingslaag (diff-invariant, EUR-Lex-markeringen, instructietekst); draaien vóór
  elke build.
- `data/generated/*.json` — gecommitteerde parseroutput; `public/search-docs.json` is de
  zoekcorpus (lazy geladen in de browser).

## Ontwikkelen

```bash
npm install
npm run dev            # of: tmux new-session -d -s aiact-dev 'npm run dev'
npm run build          # parse → verify → next build (statische export in out/)
```

## Voor ontwikkelaars

Zie [`AGENTS.md`](AGENTS.md) (werkinstructies, conventies) en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (parser, de twee
EUR-Lex-HTML-dialecten, datamodel, zoekindex). Herhaalbare procedures —
brontekst bijwerken, app verifiëren — staan in `.claude/skills/`. Features
(gerealiseerd en gepland) staan uitgewerkt in [`docs/epics/`](docs/epics/);
hergebruik voor een andere wet: [`docs/PORTING.md`](docs/PORTING.md).

## Deeplinks

Elk lid en punt is deeplinkbaar: `/artikel/5#lid-1-a`, `/artikel/6#lid-2`, `/bijlage/iii`.

## Bron

Geconsolideerde tekst van Verordening (EU) 2024/1689 per 27.7.2026 (CELEX
02024R1689-20260727): gewijzigd bij Verordening (EU) 2026/1744 van 8 juli 2026 (digitale
omnibus inzake AI; PB L, 2026/1744, 24.7.2026; in werking sinds 27 juli 2026), met
rectificaties verwerkt. De wijzigingsweergave vergelijkt met CELEX 02024R1689-20240712.
Overwegingen uit het oorspronkelijke Publicatieblad (L-serie, 2024/1689). Geen officiële
weergave; raadpleeg [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/nld) voor de
authentieke tekst. Let op: in werking ≠ van toepassing — de toepassingsdata staan in
artikel 113.
