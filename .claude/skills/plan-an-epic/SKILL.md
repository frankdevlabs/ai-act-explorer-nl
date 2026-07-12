---
name: plan-an-epic
description: Working method for any multi-step feature ("epic") in this explorer family - explore the existing spine before building, generalize behavior-neutrally first, pilot the smallest case end-to-end, batch by difficulty, audit-then-pin, ship in verify-green increments, drafter-refuter for editorial layers. Use when starting or planning an epic-sized change (new corpus content, structural refactor, new feature area), or when unsure how to sequence a large task.
---

# Plan and run an epic

The method behind the explorer-family epics (proven across this repo and
dora-explorer-nl's epics 0-10). It exists because the failure modes it
prevents all occurred and were caught: architecture rebuilt that already
existed, data pinned without being looked at, oracle comparisons that
compared a file with itself, e2e runs skipped "because verify was green".

## 1. Explore before you build

- First question: **does the spine already support this?** In the DORA
  repo, a 10-instrument expansion looked like an architecture project;
  exploration showed rendering, search, crossrefs and MCP were already
  generic — the real work was slot-filling a registry plus one parser gap.
  Budget exploration agents before design, and have them report what is
  already generic vs actually hard-coded (grep the literal unions).
- External facts (act numbers, dates, empowerment articles, whether a
  consolidation exists) come from research agents but are **verified
  against the primary source** before anything is built on them — an act's
  own preamble beats any tracker or summary.
- Ask the user the scope questions that change the plan's shape (which
  subset, naming schemes, editorial depth) before designing, not after.

## 2. Generalize first, behavior-neutrally

Hard-coded unions, regexes and label ternaries become data-driven in a
dedicated commit **while the system still has its current N** — verify must
stay green with zero output drift before the first new case lands. This
separates "the machinery can hold N+10" from "case N+1 is correct".

## 3. Pilot smallest, then batch by difficulty

- One smallest, cleanest case end-to-end through the WHOLE pipeline
  (including editorial layers, MCP, deploy) before any batch. The pilot
  proves the generalized machinery and calibrates the per-case effort.
- Batch the easy middle; keep the known-hard case (the parser gap, the
  worst data) for last, when the pipeline is boring and the diff is small.
- Order batches dependency-light first: cases that reference each other
  create pin churn when landed out of order.

## 4. Verify-green increments

- Every increment ends with the full verify chain green and is committed
  with source + generated + code together. No "fix the pins later".
- URL/naming breakage ships FIRST as its own deploy with redirects, so the
  dead-link window closes before the long tail of work starts.

## 5. Audit, then pin

Never pin a count you haven't looked at. Small output: read all of it.
Large output: structured summary (group by kind/target) + a seeded random
sample read in full + targeted probes of the known-risky spots. Every pin
carries a history comment saying what was audited and why the value is
right. Existing pins double as the regression oracle for later changes —
that only works if they were true when written.

## 6. Editorial layers: drafter → refuter → human

Interpretive metadata (maps, curated overlays, transcriptions) is produced
by parallel file-grounded drafter agents (strict JSON out), then attacked
by independent refuter agents. Verify disputed items yourself against the
source text, apply the better-grounded version, and mark it `REVIEW:` for
the human pass. Zero-dispute batches are normal; a dispute is signal, not
noise.

## 7. End with the e2e run — and expect a find

A green verify chain tests the data, not the product. Close every epic
with the repo's `verify-app` skill (curl smoke + Playwright), extended
with checks for the new surface. Expect it to find something real that
verify could never see (layout overflow, hydration timing, dead client
paths). Fix, re-run to a clean pass, then deploy.

## Executable sub-procedures in this repo

`update-source` (consolidation swap), `extend-parser` (parser/grammar
changes with oracle validation), `transcribe-amendments` (amendment
layer), `curate-recital-map` (editorial layer), `verify-app` (end-to-end
checks). Strategic background: `docs/PORTING.md` in dora-explorer-nl for
porting the codebase to another law.
