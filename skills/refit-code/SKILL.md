---
name: refit-code
description: >
  Refit a codebase: find code done more than one way, shallow or leaky
  modules, code bigger than its job, dead or wasted work, and files not where a
  reader looks, and sweep junk files. Use when asked to improve, review, clean
  up, simplify, deslop or tidy code, find duplication, drift, dead code or
  architecture problems, reorganize files, or when the refit-code Stop hook
  blocks. NOT for: writing code (use write-code).
---

Takes in Matt Pocock's `improve-codebase-architecture` (github.com/mattpocock/skills @4ae2317), aleph's `tidy`
and `one-way`. Vocabulary: call the Skill tool with `aleph:codebase-design` and use its words (module,
interface, depth, seam, adapter, leverage, locality) exactly.

# Refit code

One skill for the quality of a codebase. Seven **lenses** each ask one question of the code. Follow
[refit/PROCESS.md](../refit/PROCESS.md) for the modes, the steps and the Act loop. This file holds what differs.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **one-way** | Is one concept done in more than one place? | [ONE-WAY.md](ONE-WAY.md) |
| **depth** | Does this module earn its interface? | [DEPTH.md](DEPTH.md) |
| **seams** | Does code reach past a module's interface? | [SEAMS.md](SEAMS.md) |
| **slop** | Is this code bigger than its job? | [SLOP.md](SLOP.md) |
| **dead** | Does this code run at all, and does anything read what it writes? | [DEAD.md](DEAD.md) |
| **waste** | Does this code do work it does not need? | [WASTE.md](WASTE.md) |
| **layout** | Are files and directories where a reader looks for them? | [LAYOUT.md](LAYOUT.md) |

Where they meet: a pass-through module is **depth**, not slop; code that never runs is **dead**, code that runs
but is too big is **slop**, code that runs more than it needs is **waste**; once one-way merges copies, the owner's interface is a **depth** question; a seams
leak is often a missing depth module; the dead part of a partly dead file is **dead**, and where its live rest
goes is **layout**; a file in the wrong place by the repo's own majority is the **sweep**, and whether that
convention is right is **layout**. Report a candidate under one lens only.

## Modes

`scan`, `fix` and `fix <run dir>` of PROCESS.md. The scope is lens names. The report's unit is a module.

## Find

1. **Sweep.** In `fix`, follow [SWEEP.md](SWEEP.md): remove junk files, build output and orphaned fixtures, and
   move misplaced files, each where a yes-or-no check passes. In `scan`, run SWEEP.md's Find only and list its
   results in the Overview. Done when SWEEP.md's own bar is met.
2. **Scope.** Take the scope the user named. Else run `bun <skill dir>/cochange.ts seed --since 90.days` (files fixed
   most, pairs that change together, jscpd's copies of code) and take its directories, the files changed most in
   the last 30 days, and `docs/`. Done when you have a list of directories and the seed output.
3. **Hunt** by PROCESS.md, with one subagent per lens per two or three directories, each with the seed lines for
   its directories. The layout lens gets one subagent over the whole repo, with the full seed. Prove with
   [EXAMPLES.md](EXAMPLES.md). The Overview adds the seed's top files, pairs and copies.

## Act order

Lowest risk first: dead, slop, one-way, waste, seams, depth, then layout, so that files move once their contents
are final. A finding that needs a new interface is **ask**: follow [DEEPEN.md](DEEPEN.md) before its fix. It
designs the interface with the user, then hands the design back to the Act loop.


## Guards

The kinds are those of PROCESS.md. The hook runs each **tool** guard.

| Lens | Guard | Kind | Repo config |
|---|---|---|---|
| one-way | A copy of code an owner keeps, outside the owner | tool | `.jscpd.json` `boundaries` |
| one-way | A new copy of code, renamed copies too, that the base did not have | tool | `.jscpd.json` |
| one-way | A file left out that history changes with a changed file | tool | none (git history) |
| one-way | A literal, env name or query parameter outside its owner | tool | a lint test like `tests/clock-lint.test.ts` |
| seams | An import or read past an owner's interface | unchecked | dependency-cruiser rules, not yet wired |
| slop | An impossible fallback or a needless assertion | unchecked | typescript-eslint, not yet wired |
| slop | An empty or swallowing `catch`, an `any` | unchecked | a shrink-only ratchet, not yet wired |
| dead | An export or file nothing uses | unchecked | knip, not yet wired |
| dead | A new store with a writer and no reader | rule | write-code `RULES.md` |
| waste | A path a user or test waits on grows slower | unchecked | a timing test with a ceiling, not yet wired |
| depth | A one-line pass-through | rule | write-code `RULES.md` |
| layout | A new file outside the directory of its callers and kind | rule | write-code `RULES.md` |
| layout | An import between directories that the tree does not allow | unchecked | dependency-cruiser rules, not yet wired |
| layout | A file that grows past the repo's size limit | unchecked | a shrink-only ratchet, not yet wired |

## The hook

`hook.ts` runs at each Stop on the change since the branch left the default branch, plus the working tree. It
runs every **tool** guard of the table. The same set of findings blocks only once, and a session blocks at most 3
times in all, across all finding sets; past that it stays silent even when it finds something new. It blocks on a
stop another hook already continued (`stop_hook_active`) too; a retry after its own block passes. When it blocks,
for each finding: change the companion, call the owner, or add the pair to `.refit.json` `accepted` with its
reason. [ONE-WAY.md](ONE-WAY.md) has the rules of its checks.

## Red flags

- **You are writing more lines than you delete, outside [DEEPEN.md](DEEPEN.md).** Stop: the work is a design question.
