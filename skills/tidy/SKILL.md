---
name: tidy
description: Get a repo into a state worth showing: sweep the mechanical junk, prove what code is dead and delete it tier by tier behind a green build, check it survives a cold clone, and publish the findings. Use when the user asks to clean up a repo or codebase, remove dead code, find unused files, exports or dependencies, clear out leftover or stray files, fix where files live, audit what a project still needs, or get a repo ready for someone else to look at. Takes a mode: `sweep` for the mechanical pass alone, `polish` for the inspection gate. Triggers on "clean up this repo", "what is dead here", "remove unused code", "tidy this up", "what junk is in here", "is this ready to show", "open source this", "/tidy". NOT for improving code that should exist (use /aleph:improve-codebase-architecture).
---

# Tidy

Ask **should this exist?** before **how do I improve this?**

The failure mode in cleanup is refactoring code that should be deleted, or wrapping an over-abstracted mess in one more abstraction. Every finding here ends in a deletion, a relocation, or it is not a finding. Removal over refactoring; simplification over restructuring.

Three passes over one baseline, in order:

| Pass | Asks | Acts on | Costs |
|---|---|---|---|
| **1 — Sweep** | Is this junk, or in the wrong place? | A check that answers yes or no | minutes |
| **2 — Prove** | Should this code exist at all? | A proof that rules out every escape hatch | the rest of the run |
| **3 — Polish** | Does this survive someone else looking at it? | A gate that passes or fails | ~an hour |

Sweep first, always. It is cheap, and it clears noise that pass 2 would otherwise raise as candidates to prove.

| Mode | Runs | Reach for it |
|---|---|---|
| `/aleph:tidy` | 1 → 2 | The default. Cleaning up |
| `/aleph:tidy sweep` | 1 | Before a commit |
| `/aleph:tidy polish` | 1 → 3 | Someone is about to look at the repo |

`polish` skips pass 2 because its gate is about the outside of the repo and pass 2 can run for a day. Run the default first when there is time: dead code is something a visitor sees too.

Use the `aleph:codebase-design` vocabulary for what you find, and the **deletion test** in particular: would removing this concentrate complexity, or just move it? Read `CONTEXT.md` for the domain names and `docs/adr/` for decisions you must not re-litigate.

## The line between the passes

**Pass 1 acts only where a check answers yes or no.** The path does not resolve. The ignore rule matches. The command exits non-zero. Nothing in pass 1 turns on whether a thing is worth keeping; the moment it does, the finding moves to pass 2.

That line runs straight through tests and docs, so place each one by where its check falls:

- A test whose subject no longer exists → **pass 1**. The path does not resolve.
- A test that duplicates three others → **pass 2**. That is a judgment.
- A doc naming a command that no longer runs → **pass 1**. The command exits non-zero.
- A doc describing a design the code outgrew → **pass 2**, or `/aleph:docs-writing`.

## Tracked and untracked

Settle this before deleting anything, in either pass. A tracked file is recoverable: `git rm` it and the content stays in history. An untracked file has never been committed, so deleting it destroys the only copy.

**Delete tracked findings once their check or proof passes. List untracked findings and get explicit confirmation, every run.** An untracked file is often exactly the scratch this skill hunts, and it is also the uncommitted work someone left open. No check tells those apart.

## 1. Baseline

Both passes measure against this, so take it once.

- The repo's own build, test and lint commands, run and green. Read them from the manifest; never hardcode a command the repo does not define.
- The starting commit, and `git status --porcelain`. A dirty tree is fine, and it is also why the untracked rule exists: today's edits look like scratch.
- Size: file count and total lines in scope. The report quotes the delta.

A red baseline ends the run. Say so and stop: you cannot prove a deletion safe against a suite that was already failing.

Take the user's direction on scope if they gave one. Otherwise scope pass 2 by `git log --oneline` to find what is cold, since mass accumulates where nobody has looked in a long time. Pass 1 always runs over the whole repo; it is cheap.

# Pass 1 — Sweep

## 2. Find

| Category | How to find it | The check |
|---|---|---|
| Build output and caches | The build config's output path; `coverage/`, `.cache/`, `*.tsbuildinfo`, `__pycache__`, `target/`, `dist/` | The build regenerates it |
| Scratch and one-off output | `*.log`, `*.tmp`, `*.bak`, `*.orig`, `.DS_Store`, dated or numbered names, `test2.ts`, `foo-copy.py` | No reference in the tree, no manifest or CI entry |
| Ignore-rule gaps | A **tracked** file matching a build-output or machine-local shape | The file rebuilds, or it is local to one machine |
| Orphaned fixtures and tests | For each test and fixture, resolve the subject it names | The subject is absent from the tree **and** from `HEAD` |
| Stale doc references | Every path, command and flag a doc names | The path resolves; the command runs; the flag appears in `--help` |
| Misplaced files | A file whose kind disagrees with its directory | The repo's own convention: the majority of that kind live elsewhere |

Two of these need a stated threshold rather than a guess. For **misplaced files** the convention is the majority: if eleven hooks live in `hooks/` and one lives in `bin/`, the one is misplaced; a two-versus-three split is not a convention and not a finding. For **stale doc references**, resolve the reference rather than reading around it: a command that runs is current even where the prose around it reads dated.

## 3. Apply

Sort every finding into **remove**, **relocate**, or **defer to pass 2**, and say which.

`git rm` for tracked removals, `git mv` for relocations so history follows the file, plain `rm` for untracked ones once confirmed. Fix the imports and config entries a relocation breaks in the same commit as the move. Add the ignore rule alongside any deletion of a file that will come back: an artifact removed without its rule returns on the next build.

Then run the baseline commands and commit. A relocation that breaks a path shows up here, and it is the only category in this pass that can.

**On `/aleph:tidy sweep`, stop here and report.**

# Pass 2 — Prove

## 4. Survey

Detect the stack from the manifest, then run its detectors. Read [DETECTORS.md](DETECTORS.md) for the per-stack tool table, how to run each without touching the repo's dependencies, and what each one's output actually means.

Run a detector only if it is installed or runs from a throwaway cache (`bunx`, `npx -y`, `uvx`). Adding a dev dependency to audit a repo is itself a thing to remove. Where no detector exists, use the grep sweep in DETECTORS.md.

Every candidate carries a `file:line` citation from here on. A finding you cannot cite is a guess.

## 5. Prove

A candidate is dead when every one of these is ruled out. Work the list; do not sample it.

| Escape hatch | What to check |
|---|---|
| Dynamic dispatch | A registry keyed by string, a computed `import()`, reflection, a factory mapping names to constructors |
| Filename registration | Hooks, CLI bins, job handlers, migrations, route files: the framework loads the path, so nothing imports the symbol |
| Config and manifest | `package.json` scripts, CI workflows, Dockerfiles, compose files, systemd units, cron entries |
| Public API | Exported from the package entry point. A consumer you cannot see is still a consumer |
| String lookup | Grep the bare name, not just the symbol. Feature flags, env keys and event names hide here |
| Docs and ops | A runbook that tells a human to call it keeps it alive until the runbook changes too |

Resolve every reference to the module that declares it. Two modules can export the same name, and counting the word then answers for the wrong one.

One hatch does not apply: **test-only reference**. A symbol reached only by its own test is dead, and the test dies with it. Delete both in the same commit.

## 6. Tier

Sort every proven finding into one tier. The tier sets the proof burden and the approval it needs.

| Tier | What it is | Approval | Your time |
|---|---|---|---|
| T1 | Unreferenced files, abandoned experiments, commented-out blocks, unused dependencies, an export nothing imports | The proof table | minutes |
| T2 | An export, flag or branch no live path reaches; a test whose subject moved | The proof table, plus every call site read | ~an hour |
| T3 | A feature nobody uses; a module whose deletion concentrates complexity | The user decides | a day |
| T4 | A layer, an abstraction, a whole subsystem | An ADR | scheduled work, not this run |

Do not let a tier run long: a T1 that takes an hour was a T2 you misjudged. Re-tier it and continue.

An "unused export" is not an "unused function". Where a symbol is exported but used inside its own file, the finding is to drop the `export`, not the code.

## 7. Negotiate

Present the tiers and let the user set the scope before you touch anything. Explain the findings in prose, with citations and the line count each tier removes, then put the choice in an `AskUserQuestion` with the tiers as options.

T4 findings are reported, never executed.

## 8. Execute

One tier per commit, in tier order, lowest first.

1. Delete the whole finding: the code, its tests, its fixtures, its exports, its docs entry, its dependency line.
2. Run the baseline commands.
3. Green: commit, naming the tier and the finding count. Red: revert that finding, mark it "proof failed", and record which hatch you missed. That is a finding about your proof, not a reason to loosen it.

Never carry a red build into the next tier.

# Pass 3 — Polish

Runs on `polish`. The question is not "is this good code" but "does a stranger get anywhere with it in ten minutes". Read [POLISH.md](POLISH.md) for the cold-clone procedure, the history sweep and the required-files matrix.

## 9. Gate

Each row passes or fails. Nothing here is scored: a number averages a leaked credential against a thin README, and the two are not commensurable.

| Gate | How it passes |
|---|---|
| **Cold clone** | Clone to a temp dir, follow the README's quickstart verbatim, and reach the result it promises. Do not use the working tree; it holds state a stranger will not have |
| **Secrets in history** | No credential in `git log -p`, not merely none in `HEAD`. Deleting a key from the working tree leaves it in every clone |
| **Personal artifacts** | No absolute path carrying a username, no machine-local config, no `.env`, no editor or agent directory the repo does not mean to ship |
| **License** | A `LICENSE` file exists, the manifest's license field agrees with it, and no vendored file carries an incompatible one |
| **Required files** | The ones this repo's kind implies are present and say something. POLISH.md has the matrix |
| **CI** | Green on the current commit, and running the same commands the README tells a human to run |

## 10. Act, or stop

Fix what a check settles: add the missing `LICENSE`, correct the quickstart command that fails, delete the `.env`, point CI at the real test command.

Flag what needs judgment, and leave it: whether the README leads with what the project does, whether the file tree reads to someone who has never seen it, whether an error message tells the reader what to do next.

**One gate never auto-fixes. A secret in history is a stop.** Report it, name the commits, and leave the decision to the user: rewriting history breaks every clone and fork, and the credential has to be rotated whether or not the history changes. Removing it from `HEAD` and calling the gate passed is worse than failing it, because it reads as fixed.

# 11. Report

Publish the run as an artifact. Load the `artifact-design` skill, write the page, publish it with the Artifact tool, and give the user the link. A run produces a judgment about every candidate it touched, and that judgment is worth more than the diff; in terminal scrollback it is gone by the next session.

The page carries five things:

- **The delta.** Files and lines removed against the baseline, split by pass and by tier.
- **The sweep**, one row per finding, grouped by outcome rather than by category. The reader wants to know what changed; the category is how you found the file, not what you did to it. Include the ignore rules added, so a reader can tell why the next run will be quieter.
- **Every finding** from pass 2: tier, `file:line`, what it was, which detector raised it.
- **The survivors.** Each candidate you did not delete and the escape hatch that saved it. This is the most useful part of the page: it maps the entry points, dynamic dispatch and string lookups the codebase relies on, which is exactly what the next reader cannot see.
- **The gate**, when pass 3 ran: each row pass or fail, the cold clone's actual outcome, and every judgment call left open.
- **Follow-ups.** T4 items, anything re-tiered upward, a secret in history, and untracked files the user declined — those survive into the next run, and the page is what keeps that from being a surprise.

Then write the vault page (`/aleph:vault`) for what the run taught you about how this codebase actually behaves.

## Red flags

- **You are writing more lines than you delete.** Stop. The work turned into `/aleph:improve-codebase-architecture`.
- **You reached for a new abstraction.** Same stop. This skill never adds a layer.
- **You loosened the proof table to keep a finding.** The finding goes; the table stays.
- **A deletion "should be safe".** It is proven or it is not a finding.
