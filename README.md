# AI-verordening Explorer (NL)

Doorzoekbare Nederlandse tekst van de **AI-verordening (EU) 2024/1689** — 113 artikelen,
180 overwegingen en 13 bijlagen. Geïnspireerd op
[artificialintelligenceact.eu/ai-act-explorer](https://artificialintelligenceact.eu/ai-act-explorer/).

Volledig statische Next.js-site (`output: 'export'`), geen database. Zoeken gebeurt
client-side met MiniSearch over een build-time index (Ctrl+K / ⌘K).

## Structuur

- `data/source/aiact_nl.html` — officiële NL OJ-tekst van EUR-Lex (eenmalig opgehaald via
  `~/law-tracker/lib/fetch_blocked_doc.py`; EUR-Lex zit achter een AWS-WAF).
- `scripts/parse-aiact.ts` — deterministische HTML→JSON-parser (cheerio); geen handmatige
  transcriptie.
- `scripts/verify-data.ts` — assertions op volledigheid (aantallen, structuur, spot-checks),
  draait vóór elke build.
- `data/generated/*.json` — gecommitteerde parseroutput; `public/search-docs.json` is de
  zoekcorpus (lazy geladen in de browser).

## Ontwikkelen

```bash
npm install
npm run dev            # of: tmux new-session -d -s aiact-dev 'npm run dev'
npm run build          # parse → verify → next build (statische export in out/)
```

## Deeplinks

Elk lid en punt is deeplinkbaar: `/artikel/5#lid-1-a`, `/artikel/6#lid-2`, `/bijlage/iii`.
Let op: het PB bevat een eigen nummerfout in artikel 73 (geen lid 10, tweemaal lid 11); de
tweede staat op `#lid-11-bis`.

## Bron

Publicatieblad van de Europese Unie, L-serie, 2024/1689 (13 juni 2024), Nederlandse
taalversie. Geen officiële weergave; raadpleeg
[EUR-Lex](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/nld) voor de authentieke tekst.
Het corrigendum en latere geconsolideerde versies zijn niet verwerkt.
