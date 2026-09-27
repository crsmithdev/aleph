---
name: cull
description: Survey a codebase for what should not exist, prove each candidate dead, rank the findings into tiers, then delete tier by tier with a verified build between each. Use when the user asks to clean up a codebase, remove dead code, find unused exports or dependencies, audit tech debt, or decide what a project still needs. Triggers on "clean up this codebase", "what is dead here", "remove unused code", "tech debt audit", "/cull". NOT for improving code that should exist (use /aleph:improve-codebase-architecture), or for build artifacts and scratch files (use /aleph:tidy).
---

# Cull

Ask **should this exist?** before **how do I improve this?**

The failure mode in cleanup is refactoring code that should be deleted, or wrapping an over-abstracted mess in one more abstraction. Every finding here ends in a deletion or it is not a finding. Removal over refactoring; simplification over restructuring.

A scanner does not find dead code. It finds **candidates**. Turning a candidate into a deletion is the judgment this skill exists to apply, and step 3 is where the value sits: steps 2 and 6 are mechanical.

Use the `aleph:codebase-design` vocabulary when you talk about what you found, and the **deletion test** in particular: would removing this concentrate complexity, or just move it? Read `CONTEXT.md` for the domain names and `docs/adr/` for decisions you must not re-litigate.

## Process

### 1. Scope and baseline

Take the user's direction if they gave one, a path, a subsystem, a suspicion. Otherwise scope by `git log --oneline` to find what is cold: code nobody has touched in a long time is where mass accumulates, the mirror of `/aleph:improve-codebase-architecture`, which follows the hot spots.

Then record a **baseline** you can compare against and return to:

- The repo's own build, test and lint commands, run and green. Read them from the manifest; never hardcode a command the repo does not define.
- `git status` clean, and the commit you started from.
- Size: file count and total lines in scope. The report quotes the delta.

A red baseline ends the run. Say so and stop: you cannot prove a deletion safe against a suite that was already failing.

### 2. Survey

Detect the stack from the manifest, then run the detectors for it. Read [DETECTORS.md](DETECTORS.md) for the per-stack tool table, how to run each one without touching the repo's dependencies, and what its output actually means.

Run a detector only if it is installed or runs from a throwaway cache (`bunx`, `npx -y`, `uvx`). Adding a dev dependency to audit a repo is itself a thing to cull. Where no detector exists, fall back to the grep sweep in DETECTORS.md.

Every candidate carries a `file:line` citation from here on. A finding you cannot cite is a guess.

### 3. Prove

A candidate is dead when every one of these is ruled out. Work the list; do not sample it.

| Escape hatch | What to check |
|---|---|
| Dynamic dispatch | A registry keyed by string, a computed `import()`, reflection, a factory that maps names to constructors |
| Filename registration | Hooks, CLI bins, job handlers, migrations, route files: the framework loads the path, so nothing imports the symbol |
| Config and manifest | `package.json` scripts, CI workflows, Dockerfiles, compose files, systemd units, cron entries |
| Public API | Exported from the package entry point. A consumer you cannot see is still a consumer |
| String lookup | Grep the bare name, not just the symbol. Feature flags, env keys and event names hide here |
| Docs and ops | A runbook that tells a human to call it keeps it alive until the runbook changes too |

One hatch does not apply: **test-only reference**. A symbol reached only by its own test is dead, and the test dies with it. Delete both in the same commit.

### 4. Tier

Sort every proven finding into one tier. The tier sets the proof burden and the approval it needs.

| Tier | What it is | Approval | Your time |
|---|---|---|---|
| T1 | Unreferenced files, abandoned experiments, commented-out blocks, unused dependencies | The proof table | minutes |
| T2 | An export, flag or branch no live path reaches; a test whose subject moved | The proof table, plus every call site read | ~an hour |
| T3 | A feature nobody uses; a module whose deletion concentrates complexity | The user decides | a day |
| T4 | A layer, an abstraction, a whole subsystem | An ADR | scheduled work, not this run |

Do not mix tiers in one batch, and do not let a tier run long: a T1 that takes an hour was a T2 you misjudged. Re-tier it and continue.

### 5. Negotiate

Present the tiers and let the user set the scope before you touch anything. Explain the findings in prose, with citations and the line count each tier removes, then put the choice in an `AskUserQuestion` with the tiers as options.

T4 findings are reported, never executed. Write them up as follow-ups.

### 6. Execute

One tier per commit, in tier order, lowest first.

1. Delete the whole finding: the code, its tests, its fixtures, its exports, its docs entry, its dependency line.
2. Run the baseline commands.
3. Green: commit, with the tier and the finding count in the message. Red: revert that finding, mark it "proof failed", and record which hatch you missed. That is a finding about your proof, not a reason to loosen it.

Never carry a red build into the next tier.

### 7. Report

- Lines and files removed, per tier, against the baseline.
- Every finding you left, and which escape hatch saved it.
- T4 items and anything re-tiered upward, as follow-ups.
- What the vault should remember (`/aleph:vault`) about how this codebase actually behaves.

## Red flags

- **You are writing more lines than you delete.** Stop. The work turned into `/aleph:improve-codebase-architecture`.
- **You reached for a new abstraction.** Same stop. Culling never adds a layer.
- **You loosened the proof table to keep a finding.** The finding goes; the table stays.
- **A deletion "should be safe".** It is proven or it is not a finding.
