# Pass 2 — Prove

Steps 4–8 of [tidy](SKILL.md). Pass 1 has run and its commit is in.

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
