---
name: extend-parser
description: Safely extend scripts/parse-aiact.ts or the crossref grammar (src/lib/crossrefs.ts) - diagnose resolver throws from the source sentence, validate new dialect handling against a dual-dialect oracle, guard against silent data loss and vacuous comparisons. Use when the parser throws "unresolvable cross-reference/chapter ref", when a source's markup has unhandled constructs (annexes, data tables, enumerations), or when changing ref grammar.
---

# Extend the parser or crossref grammar

The corpus is legal text: a parser bug is a wording bug (AGENTS.md golden
rule). Two invariants make extension safe — **the resolver throws instead
of guessing**, and **the existing verify pins are your regression oracle**.
(Method proven in the dora-explorer-nl port, epic 10; this is the adapted
copy.)

Division of labor: reference **grammar** (what counts as a citation, how
qualifiers distribute) lives in `src/lib/crossrefs.ts`; **dialect/markup
parsing** and href **validation** (the throws) live in
`scripts/parse-aiact.ts`.

## 1. A resolver throw is a feature — read the source sentence first

`parse-aiact.ts` throws `unresolvable cross-reference target` when a ref
resolves to something that doesn't exist. Do NOT weaken the throw. Instead:

```bash
python3 -c "
import re, html
s = open('data/source/<file>.html').read()
t = html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',s)))
for m in re.finditer(r'<the failing phrase>', t):
    print('...' + t[max(0,m.start()-160):m.end()+160] + '...')
"
```

Then classify:
- **New grammar construct** → extend `src/lib/crossrefs.ts` minimally.
  Constructs the DORA sibling repo already hit (check its crossrefs.ts as
  a reference implementation before inventing): comma-chained article
  series whose closing qualifier distributes over the whole chain,
  parenthesized follow-up lid ("lid 2, en (3),"), range variant
  "punten a), b) en met c)", conjunction distribution of a trailing
  instrument qualifier (see the eu-citation memory / allowedHere()).
- **Genuinely unlinkable** → drop or exclude explicitly, with a comment —
  never a silent fall-through.
- **Parser bug** → fix the parser, never the assertion.

## 2. Existing pins are the regression oracle

Before and after ANY grammar/parser change, run the full parse and compare
the summary counts. Parts your change shouldn't touch must stay identical
(article/recital/annex/ref/doc counts, and — extra pin surface in this
repo — the amendment-layer counts in `verify-amendments.ts`). Any drift:
audit it in `git diff data/generated/` change by change; either it's an
intended improvement (document it in the re-pin history comment) or a
regression. The `update-source` skill's corpus-diff script is the tool for
big diffs.

## 3. Oracle for new dialect handling

This repo holds the act in BOTH EUR-Lex dialects:
`data/source/aiact_nl_consolidated.html` (consolidated; articles/annexes)
and `data/source/aiact_nl.html` (OJ; recitals — but it contains the full
act). Any new capability in one dialect can be validated against the other
parser as ground truth:

1. Point the relevant parse path at the other file **with sed, both
   ways** — never revert with git (see traps).
2. Parse; **confirm the parse actually succeeded and the output file
   changed** before copying the result aside.
3. Swap back, parse again, deep-compare the two outputs.
4. Compare **full structures** — node types in order, table dimensions AND
   cell text, heading/text sequences. Count-equality is not enough: in the
   DORA repo, equal table counts hid 2x row inflation from nested layout
   mini-tables (fix: take direct `tbody > tr` children only; nested-table
   text belongs to the containing cell).
5. Divergence is not automatically failure — judge which representation is
   better and document the choice in the commit.

## 4. Silent data loss checks

- Any element the parser deliberately skips must be an explicit, commented
  branch.
- Cross-check element counts in the source (`grep -oc '<table'` etc.)
  against emitted nodes.
- When a heuristic discriminates between shapes (point row vs data table),
  the "reject" outcome must produce the OTHER shape, not nothing.

## 5. Traps (each one happened in this repo family)

1. **Never `git checkout --` a file carrying uncommitted work** during A/B
   oracle runs — it reverts your parser changes along with the swap. Swap
   with targeted sed, forward and back.
2. **Vacuous oracle pass**: if one side's parse crashes, its output file
   still holds the previous run's data and you compare X with X — a
   perfect, meaningless match. Check the parse's own success output before
   trusting any comparison.
3. **tsx does not typecheck** — `npx tsx scripts/…` runs with type errors
   that `next build` later rejects. Run the build before calling it done.

## 6. Finish

Re-pin consciously (ref counts, totals, search docs, amendment pins) with
a history comment stating what changed and why; full `npm run verify`;
commit parser + source + generated together.
