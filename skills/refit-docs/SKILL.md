---
name: refit-docs
description: >
  Refit a repo's docs: find where a doc disagrees with the code, what users
  need that no doc says, sentences with two readings, pages that mix reader
  tasks, docs a reader cannot reach, topics said twice, and docs that no
  longer earn their place. Use when asked to improve, review, audit, lint or
  clean up docs, a README or a docs site, find stale or broken docs or links,
  or before you add a doc page or section (check). NOT for: CLAUDE.md, AGENTS.md
  or skills (use refit-agents); writing a new page (use docs-writing).
---

# Refit docs

[refit-code](../refit-code/SKILL.md) for the docs people read: README, `docs/`, how-tos, references, ADRs, the
changelog, and doc blocks in code. Agent files belong to [refit-agents](../refit-agents/SKILL.md). Seven **lenses**
each ask one question. Read `.refit.json` at the repo root when it exists: its `accepted` list, shared with
refit-code, holds what the repo keeps on purpose, each `{"concept", "copies": ["file[:line]", ...], "reason"}`.

The order of the lenses is the order of harm. In a survey of 323 developers, incorrectness, obsoleteness,
incompleteness and ambiguity were blockers, and bloat, fragmentation and tangled pages were not (Uddin and
Robillard, IEEE Software 2015); in 878 doc issues, completeness (268) and up-to-dateness (190) were the most
frequent (Aghajani et al., ICSE 2019).

## Lenses

| Lens | Asks | File |
|---|---|---|
| **true** | Does each doc agree with the code? | [TRUE.md](TRUE.md) |
| **gaps** | Is everything a user needs documented? | [GAPS.md](GAPS.md) |
| **clear** | Does each sentence have one reading? | [CLEAR.md](CLEAR.md) |
| **shape** | Does each page serve one reader task? | [SHAPE.md](SHAPE.md) |
| **find** | Can a reader reach each doc and find the answer? | [FIND.md](FIND.md) |
| **copies** | Is each topic said in one place? | [COPIES.md](COPIES.md) |
| **rot** | Does each doc still earn its place? | [ROT.md](ROT.md) |

Where they meet: a wrong line is **true**, a missing one is **gaps**; a line with two readings is **clear**, a page
with two jobs is **shape**; a broken link is **find**, a link to a page that says the same thing again is
**copies**; a dated line is **rot** until the date makes it wrong, then **true**; a whole doc for a removed feature
is **rot**. Report a candidate under one lens only.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `retro [lens ...]` (default: all) | Baseline, inventory, hunt, prove, fix and hold, report | Find what to improve |
| `act` | The fix of each finding the user picks | After a retro |
| `lint` | `refs.ts` and the installed tools only, no model judgment, report in the terminal | A quick pass, or before a commit that touches docs |
| `check` | Each new page, section, flag, env var or config key in a plan, spec or diff | Before or during a build |

## Retro

1. **Baseline.** Run the repo's own build and test commands from its manifest; a red baseline ends the run.
   Record the commit. Done when the baseline is green and recorded.
2. **Inventory.** Run `bun <skill dir>/refs.ts <repo>` (broken references, undocumented env vars, orphan docs).
   Run each installed tool of [TOOLS.md](TOOLS.md) and list the ones missing with their install line. Classify
   each doc by its Diátaxis type (`docs-writing` rule `structure-diataxis`). Done when you have the refs JSON, the
   tool output and a type for each doc.
3. **Hunt.** Spawn one Explore subagent per lens in one message, except **true** and **find**, whose mechanical
   part you read from the inventory yourself. Give each its lens file's Signals section verbatim, the inventory,
   and the docs in its scope. Each returns candidates as: lens, file and line, the signal that found it. Done when
   each subagent has returned.
4. **Prove, fix and hold, report.** Run steps 4 to 6 of refit-code's [Retro](../refit-code/SKILL.md#retro) with
   this skill's lens files. The report goes to `<tmpdir>/refit-docs-retro-<timestamp>.html`; its header adds the
   doc count, the `refs.ts` counts and the tools that ran, and a card shows the text before and after. Done when
   refit-code's step 6 is done.

## Act

refit-code's [Act](../refit-code/SKILL.md#act), in this order: true, rot, copies, gaps, find, shape, then clear,
so that a doc is right before it moves and placed before it is reworded. A new page or a rewrite follows
[docs-writing](../docs-writing/SKILL.md)'s writing workflow. After each finding, run `refs.ts` and the tools
again; a new broken reference is red.

## Lint

1. Run `refs.ts` and each installed tool of [TOOLS.md](TOOLS.md).
2. Report in the terminal: each broken reference with `doc:line`, the undocumented env vars, the orphans, each
   tool's counts, and the tools not installed with their install line.

## Check

1. **List the new things.** From the plan, spec or diff: each new page, section, CLI command or flag, env var,
   config key, public symbol and example.
2. **Ask each lens's Check question** of each item. Record the answer.
3. **Judge.** Each item gets one verdict: **keep**, **document** (name the page), **link** (name the page that
   already says it), **cut**, or **fix** (name the lens and the change). Done when every item has a verdict.

## Holds

| Lens | Hold | Kind | Tool |
|---|---|---|---|
| true | A link, anchor, path, env var or own-CLI flag a doc names that does not resolve | tool | `refs.ts` broken list empty, held by `refs.test.ts` on aleph; `aleph doc-claims` in aleph |
| true | An example that does not run | unchecked | the doc-test runner of [TOOLS.md](TOOLS.md) in CI |
| gaps | An env var the code reads that no doc names | unchecked | `refs.ts` undocumented list as a shrink-only ratchet |
| gaps | A public symbol with no doc block | unchecked | the coverage tool of [TOOLS.md](TOOLS.md) with a floor |
| find | An orphan doc | tool | `refs.ts` orphans empty, held by `refs.test.ts` on aleph |
| find | A broken heading order, an image with no alt text | unchecked | `markdownlint-cli2` |
| clear, shape, copies, rot | A judgment | model | `check` |

## Red flags

- **You reworded a page whose facts you did not check.** True first: a clear sentence that is wrong does more harm.
- **You copied a command's usage into a doc.** Point at the CLI's own usage; give it one if it has none.
- **You gated on a readability score.** Flesch-Kincaid counts word and sentence length; it flags hard text less
  than half the time. It is a signal, never a finding.
