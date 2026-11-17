---
name: refit-docs
description: >
  Refit a repo's docs: find where a doc disagrees with the code, what users
  need that no doc says, sentences with two readings, pages that mix reader
  tasks, docs a reader cannot reach, topics said twice, and docs that no
  longer earn their place. Use when asked to improve, review, audit, lint or
  clean up docs, a README or a docs site, or find stale or broken docs or
  links. NOT for: CLAUDE.md,
  AGENTS.md or skills (use refit-agents); a new page (use write-docs).
---

# Refit docs

[refit-code](../refit-code/SKILL.md) for the docs people read: README, `docs/`, how-tos, references, ADRs, the
changelog, and doc blocks in code. Agent files belong to [refit-agents](../refit-agents/SKILL.md). Seven **lenses**
each ask one question. Follow [refit/PROCESS.md](../refit/PROCESS.md) for the modes, the steps and the Act loop.
This file holds what differs.

The lenses run in the order of harm. In a survey of 323 developers, incorrectness, obsoleteness, incompleteness
and ambiguity were blockers. Bloat, fragmentation and tangled pages were not (Uddin and Robillard, IEEE Software
2015). In 878 doc issues, completeness (268) and up-to-dateness (190) were the most frequent (Aghajani et al.,
ICSE 2019).

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

Where they meet: a wrong line is **true**, a missing one is **gaps**. A line with two readings is **clear**, a page
with two jobs is **shape**. A broken link is **find**, a link to a page that repeats the same thing is **copies**.
A dated line is **rot** until the date makes it wrong, then **true**. A whole doc for a removed feature is **rot**.
Report a candidate under one lens only.

## Modes

`scan`, `fix` and `fix <run dir>` of PROCESS.md. The scope is lens names. The report's unit is a doc page.

## Find

1. **Inventory.** Run `bun <skill dir>/refs.ts <repo>` (broken references, undocumented env vars, orphan docs).
   Run each installed tool of [TOOLS.md](TOOLS.md) and list the ones missing with their install line. Classify
   each doc by its Diátaxis type (`write-docs` rule `structure-diataxis`). Done when you have the refs JSON, the
   tool output and a type for each doc.
2. **Hunt** by PROCESS.md. Read the mechanical part of **true** and **find** from the inventory yourself. Each
   subagent gets the inventory and the docs in its scope. The Overview adds the doc count, the `refs.ts` counts
   and the tools that ran. A card shows the text before and after.

## Act order

true, rot, copies, gaps, find, shape, clear. A doc is then right before it moves and placed before it is
reworded. A new page or a rewrite follows [write-docs](../write-docs/SKILL.md)'s writing workflow. After each
finding, run `refs.ts` and the tools again. A new broken reference is red.


## Guards

| Lens | Guard | Kind | Tool |
|---|---|---|---|
| true | A link, anchor, path, env var or own-CLI flag a doc names that does not resolve | tool | `refs.ts` broken list empty, held by `refs.test.ts` on aleph; `aleph doc-claims` in aleph |
| true | An example that does not run | unchecked | the doc-test runner of [TOOLS.md](TOOLS.md) in CI |
| gaps | An env var the code reads that no doc names | unchecked | `refs.ts` undocumented list as a shrink-only ratchet |
| gaps | A public symbol with no doc block | unchecked | the coverage tool of [TOOLS.md](TOOLS.md) with a floor |
| find | An orphan doc | tool | `refs.ts` orphans empty, held by `refs.test.ts` on aleph |
| find | A broken heading order, an image with no alt text | unchecked | `markdownlint-cli2` |
| clear, shape, copies, rot | A judgment | rule | write-docs RULES.md |

## Red flags

- **You reworded a page whose facts you did not check.** True first: a clear sentence that is wrong does more harm.
- **You copied a command's usage into a doc.** Point at the CLI's own usage. Give the CLI one if it has none.
- **You gated on a readability score.** Flesch-Kincaid counts word and sentence length. It flags hard text less
  than half the time. It is a signal, never a finding.
