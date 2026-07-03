---
name: transcribe-amendments
description: Transcribe a chunk of amending instructions from PE-CONS 30/26 (digitale omnibus inzake AI) into data/source/amendments/pe-cons-30-26.json, with page-image cross-check and pipeline verification. Use when transcribing new instructions, correcting a transcribed instruction, or reviewing transcription fidelity.
---

# Transcribe amendments (PE-CONS 30/26)

Turns instructions from `data/source/amendments/PE-30-2026-INIT_nl.pdf`
(official final Dutch text, 18 Jun 2026) into entries of the curated source
file `data/source/amendments/pe-cons-30-26.json`. This file is the approved
carve-out from golden rule 2 (see AGENTS.md): hand-verified legal text,
page-image cross-checked, scheduled for replacement by a deterministic
CELEX parse after OJ publication.

**Scope guard: Article 1 of the amending act only** (instructions amending
Regulation 2024/1689) plus its annex instructions. Articles 2–3 (amending
2018/1139 and 2023/1230) are out of scope — never transcribe past the end of
Article 1's instruction list.

## Why not pdftotext alone

The text layer is lossy: soft hyphens vanish (`AIsystemen`), Bijlage XIV
table columns dislocate, instruction numbers merge with page furniture.
pdftotext output is the *first draft only*; every instruction must be
cross-checked against page images before commit. The Bijlage XIV table must
be transcribed from page images exclusively.

## Procedure (one chunk = ~10 instructions)

1. **First draft**: extract the chunk's pages to the scratchpad:
   `pdftotext -f <first> -l <last> -layout data/source/amendments/PE-30-2026-INIT_nl.pdf <scratchpad>/chunk.txt`
2. **Page images**: render the same pages:
   `PYTHONPATH=/tmp/pylib python3 .claude/skills/transcribe-amendments/render_pdf.py data/source/amendments/PE-30-2026-INIT_nl.pdf --pages <first>-<last> --outdir <scratchpad>`
   Read each PNG. For dense passages or the Bijlage XIV table use
   `--crop "<page>:<y0frac>:<y1frac>:320"` and transcribe from the crop.
3. **Transcribe** each instruction into `pe-cons-30-26.json` (schema below),
   wording from the draft text but **verified word-by-word against the page
   image** — fix soft-hyphen joins, guillemets, list markers, diacritics.
4. **Pipeline check**: `npm run parse:amendments && npm run verify:amendments`.
   Fix anchors/schema until green. The verifier resolves every `scope.anchor`
   against the base corpus and re-checks the diff reconstruction invariant.
5. **Sanity-read the diff**: for one amended article in the chunk, run the dev
   server and eyeball `/artikel/<n>?diff=1` — a mostly-red/green diff usually
   means a wrong anchor or an accidental paraphrase.
6. **Commit** the chunk: source JSON + regenerated `data/generated/*` +
   `public/amendment-search-docs.json` together. Message cites instruction
   range and PDF pages, e.g. `data: transcribe PE-CONS 30/26 instr. 12-21 (pp. 18-30)`.

## Source schema (one entry per (sub-)instruction)

See `Amendment` in `src/lib/types.ts`. Conventions:

- `seq`/`sub`: instruction "2), a)" → `seq: 2, sub: "a"`. Ids must be unique.
- `target.article`: base article as string (`"2"`) or new-article slug
  (`"4bis"`); `target.annex`: roman (`"III"`).
- `scope.anchor`: existing anchor in the base corpus — `lid-2`, `lid-2-g`,
  `punt-14` (art 3 definitions), `inhoud`. Pseudo-anchor `lid-2-aanhef` =
  chapeau text before the paragraph's first list. `scope.title: true` =
  article-title replacement (newContent = single text node).
  `scope.wholeArticle: true` + `newParagraphs` = full-article replacement.
- Content nodes mirror the base model (`text` / `list` / `heading` /
  `table`). **Omit anchors in transcribed content** — the parser derives
  them (`lid-5`, `lid-5-a`, `punt-14`) with the same logic as the base parser.
- Inserted leden: `newParagraphs` after `scope.anchor`; bis-numbered leden get
  `number: null` + `displayNumber: "5 bis"`. Inserted points: `newItems`
  (marker + content) after an existing item's `scope.anchor`.
- New articles: `newArticle: { slug: "4bis", displayNumber: "4 bis", title,
  insertAfter: 4, paragraphs }`. New annexes: `newAnnex: { roman: "XIV",
  title, insertAfter: "XIII", content }` (table rows as
  `{ type: "table", rows: string[][] }`, first row = header).
- Staggered application dates or similar remarks: `note` (free text) — never
  extra schema.

## Verification stages

`meta.complete` in the source JSON stays `false` during transcription —
`verify-amendments.ts` then runs structural checks only. The final chunk
commit flips it to `true` AND pins `EXPECTED.instructions` /
`EXPECTED.affectedArticles` in `scripts/verify-amendments.ts` (count them from
the PDF's instruction list, sub-instructions included).

Cross-check the instruction inventory against the English analysis of the
same file: `~/ai-omnibus-2025-0359/extracts/agreed/PE-789081_*.md` (structure
and instruction→article mapping only — never copy wording; that text is
English and one document generation older).

## Provisioning PyMuPDF (no pip on this VPS)

If `/tmp/pylib` is missing (it is wiped on reboot):

```bash
pip download pymupdf --no-deps -d /tmp \
  || curl -L -o /tmp/pymupdf.whl "https://files.pythonhosted.org/.. latest manylinux_x86_64 wheel from pypi.org/project/PyMuPDF/#files"
mkdir -p /tmp/pylib && unzip -q -o /tmp/pymupdf*.whl -d /tmp/pylib
PYTHONPATH=/tmp/pylib python3 -c "import fitz; print(fitz.__doc__)"
```

Run from the repo root, not from /tmp (a stray `inspect.py` there shadows the
stdlib). `pdftotext` is at `/usr/bin/pdftotext`.
