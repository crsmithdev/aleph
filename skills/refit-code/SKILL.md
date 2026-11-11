---
name: refit-code
description: >
  Refit a codebase: find where it does one thing more than one way, where a
  module is shallow or leaks, where code is bigger than its job, dead or does
  work it does not need, where
  files and directories are not where a reader looks, and sweep or polish the
  repo. Use when asked to improve, review, clean up, simplify, deslop or tidy code,
  find duplication, drift, dead code or architecture problems, reorganize or
  restructure files and directories, get a repo ready to show, before you add a function, module,
  parser, constant, route or doc section (check), or when the refit-code Stop
  hook blocks.
---

Takes in Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills @4ae2317), aleph's `tidy`
and `one-way`. Vocabulary: call the Skill tool with `aleph:codebase-design` and use its words (module,
interface, depth, seam, adapter, leverage, locality) exactly.

# Refit code

One skill for the quality of a codebase. Seven **lenses** each ask one question of the code; the modes below
decide where and how they run. Read `PRINCIPLES.md`, `GLOSSARY.md`, `docs/naming.md` and `docs/adr/` first when
they exist: they name owners and settled decisions. Read `.refit.json` at the repo root when it exists: its
`accepted` list holds what the repo keeps on purpose, each `{"concept", "copies": ["file[:line]", ...],
"reason"}`, and an accepted candidate is reported as accepted, not as a finding.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **one-way** | Is one concept done in more than one place? | [ONE-WAY.md](ONE-WAY.md) |
| **depth** | Does this module earn its interface? | [DEPTH.md](DEPTH.md) |
| **seams** | Does code reach past a module's interface? | [SEAMS.md](SEAMS.md) |
| **slop** | Is this code bigger than its job? | [SLOP.md](SLOP.md) |
| **dead** | Does this code run at all? | [DEAD.md](DEAD.md) |
| **waste** | Does this code do work it does not need? | [WASTE.md](WASTE.md) |
| **layout** | Are files and directories where a reader looks for them? | [LAYOUT.md](LAYOUT.md) |

Where they meet: a pass-through module is **depth**, not slop; code that never runs is **dead**, code that runs
but is too big is **slop**, code that runs more than it needs is **waste**; once one-way merges copies, the owner's interface is a **depth** question; a seams
leak is often a missing depth module; the dead part of a partly dead file is **dead**, and where its live rest
goes is **layout**; a file in the wrong place by the repo's own majority is the **sweep**, and whether that
convention is right is **layout**. Report a candidate under one lens only.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `retro [lens ...]` (default: all) | Baseline, scope, hunt, prove, owner, hold, report | Find what to improve |
| `act` | The fix of each finding the user picks | After a retro |
| `deepen <finding>` | [DEEPEN.md](DEEPEN.md): grill the design, design it twice, glossary and ADRs | A depth, seams or one-way finding that needs a new interface |
| `check` | Each new thing in a plan, spec or diff, under every lens | Before or during a build |
| `sweep` | [SWEEP.md](SWEEP.md): junk files, build output, orphaned fixtures, misplaced files | Before a commit, or first in any retro |
| `polish` | `sweep`, then [POLISH.md](POLISH.md): the ready-to-show gate | Someone is about to look at the repo |
| hook | Every tool hold, at each Stop, with no model | Automatic |

## Retro

1. **Baseline.** Run the repo's own build, test and lint commands from its manifest; a red baseline ends the
   run. Record the commit, `git status --porcelain`, and the file and line count. Done when the baseline is
   green and recorded.
2. **Scope.** Take the scope the user named. Else run `bun <skill dir>/cochange.ts seed --since 90.days` (files
   fixed most, pairs that change together, jscpd's copies of code) and take its directories, the files changed
   most in the last 30 days, and `docs/`. Done when you have a list of directories and the seed output.
3. **Hunt.** Spawn one Explore subagent per lens per two or three directories, in one message. Give each its
   lens file's Signals section verbatim, the scope, and the seed lines for its directories. The layout lens gets
one subagent over the whole repo, with the full seed. Each returns
   candidates as: lens, concept or module, every location with `file:line`, the signal that found it. Done when
   each subagent has returned.
4. **Prove.** Open every location of every candidate and apply its lens's proof bar. Read
   [EXAMPLES.md](EXAMPLES.md) first to calibrate. A candidate that meets the bar is a finding; one that does not
   is dropped with the reason; one `.refit.json` accepts is marked accepted. Where a lens has no hard proof,
   rate 1-5: 4-5 is a finding, 3 is a finding with the doubt stated, 1-2 is dropped. Done when each candidate
   has a verdict.
5. **Owner and hold.** For each finding, its lens's Fix section names what changes, and its Hold section names
   what keeps it from coming back. Done when every finding has both.
6. **Report.** Write the HTML report of [REPORT.md](REPORT.md), strongest first, then accepted and dropped.
   Give the user its absolute path. Then ask which findings to act on, in an `AskUserQuestion`. File issues
   only when the user asks. Done when the report is written and the question asked.

## Act

For each finding the user picks, in the order lowest risk first: dead, slop, one-way, waste, seams, depth, then layout, so that files move once
their contents are final.

1. Make the lens's fix. Delete or change whole: the code, its tests, fixtures, exports, docs entry and
   dependency line. Edit only lines the branch owns or the user named; report the rest.
2. Add the finding's hold when its tool exists in the repo.
3. Run the baseline commands. Green: commit, naming the lens and the finding. Red: revert that finding and
   record which proof step missed; never carry a red build into the next finding.

A finding that needs a new interface goes to `deepen` instead.

## Check

1. **List the new things.** From the plan, spec or diff: each new function, module, type, parser, constant,
   literal, route, CLI flag, record field, dependency, guard, option, comment and doc section.
2. **Ask each lens's Check question** of each item ([ONE-WAY.md](ONE-WAY.md) and the other lens files), with
   the searches it names. Record the searches and hit counts.
3. **Judge.** Each item gets one verdict: **new**, **reuse** (name the path), **extend** (name the path),
   **cut** (no case reaches it), or **second way** (on purpose: add it to `.refit.json` `accepted` with the
   reason). Done when every item has a verdict with `file:line` or its search record.
4. **Holds.** When the change makes one copy the owner of a concept or a module the owner of a seam, add its
   hold in the same change.

## Holds

A hold keeps a fixed finding fixed. Each one has a kind: **tool** (the hook runs it), **model** (`check` asks
it) or **unchecked** (only a retro finds it). A finding that comes back moves up: unchecked, then model, then
tool.

| Lens | Hold | Kind | Repo config |
|---|---|---|---|
| one-way | A copy of code an owner keeps, outside the owner | tool | `.jscpd.json` `boundaries` |
| one-way | A new copy of code, renamed copies too, that the base did not have | tool | `.jscpd.json` |
| one-way | A file left out that history changes with a changed file | tool | none (git history) |
| one-way | A literal, env name or query parameter outside its owner | tool | a lint test like `tests/clock-lint.test.ts` |
| seams | An import or read past an owner's interface | unchecked | dependency-cruiser rules, not yet wired |
| slop | An impossible fallback or a needless assertion | unchecked | typescript-eslint, not yet wired |
| slop | An empty or swallowing `catch`, an `any` | unchecked | a shrink-only ratchet, not yet wired |
| dead | An export or file nothing uses | unchecked | knip, not yet wired |
| waste | A path a user or test waits on grows slower | unchecked | a timing test with a ceiling, not yet wired |
| depth | A one-line pass-through | model | `check` |
| layout | A new file outside the directory of its callers and kind | model | `check` |
| layout | An import between directories that the tree does not allow | unchecked | dependency-cruiser rules, not yet wired |
| layout | A file that grows past the repo's size limit | unchecked | a shrink-only ratchet, not yet wired |

## The hook

`hook.ts` runs at each Stop on the change since the branch left the default branch, plus the working tree. It
runs every **tool** hold of the table and blocks once per session for one set of findings; it never blocks a
stop a hook already continued. When it blocks, for each finding: change the companion, call the owner, or add
the pair to `.refit.json` `accepted` with its reason. [ONE-WAY.md](ONE-WAY.md) has the rules of its checks.

## Red flags

- **You are writing more lines than you delete, outside `deepen`.** Stop: the work is a design question.
- **You loosened a proof bar to keep a finding.** The finding goes; the bar stays.
- **A change "should be safe".** It is proven by a green baseline, or it is not done.
