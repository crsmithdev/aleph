# Dead lens

Ask **should this exist?** before **how do I improve this?** Dead code never runs: refactoring it, or wrapping
it in one more abstraction, is work on code that should be deleted.

## Signals

Detect the stack from the manifest, then run its detectors. [DETECTORS.md](DETECTORS.md) has the per-stack tool
table, how to run each without touching the repo's dependencies, and what each one's output actually means.
Run a detector only if it is installed or runs from a throwaway cache (`bunx`, `npx -y`, `uvx`). Where no
detector exists, use the grep sweep in DETECTORS.md.

Scope by `git log`: mass accumulates where nobody has looked in a long time, so the cold files are the first
candidates here, unlike the other lenses.

## Proof

A candidate is dead when every one of these is ruled out. Work the list; do not sample it.

| Escape hatch | What to check |
|---|---|
| Dynamic dispatch | A registry keyed by string, a computed `import()`, reflection, a factory mapping names to constructors |
| Filename registration | Hooks, CLI bins, job handlers, migrations, route files: the framework loads the path, so nothing imports the symbol |
| Config and manifest | `package.json` scripts, CI workflows, Dockerfiles, compose files, systemd units, cron entries |
| Public API | Exported from the package entry point. A consumer you cannot see is still a consumer |
| String lookup | Grep the bare name, not just the symbol. Feature flags, env keys and event names hide here |
| Docs and ops | A runbook that tells a human to call it keeps it alive until the runbook changes too |

Resolve every reference to the module that declares it. Two modules can export the same name, and counting the
word then answers for the wrong one.

One hatch does not apply: **test-only reference**. A symbol reached only by its own test is dead, and the test
dies with it.

An "unused export" is not an "unused function". Where a symbol is exported but used inside its own file, the
finding is to drop the `export`, not the code.

## Tiers

Each finding gets one tier; the tier sets the proof burden and the approval `act` needs.

| Tier | What it is | Approval | Your time |
|---|---|---|---|
| T1 | Unreferenced files, abandoned experiments, commented-out blocks, unused dependencies, an export nothing imports | The proof table | minutes |
| T2 | An export, flag or branch no live path reaches; a test whose subject moved | The proof table, plus every call site read | ~an hour |
| T3 | A feature nobody uses; a module whose deletion concentrates complexity | The user decides | a day |
| T4 | A layer, an abstraction, a whole subsystem | An ADR | scheduled work, not this run |

A T1 that takes an hour was a T2 you misjudged: re-tier it and continue. T4 findings are reported, never acted
on.

## Fix

Delete the whole finding in one commit per tier, lowest first: the code, its tests, its fixtures, its exports,
its docs entry, its dependency line. A red baseline reverts the finding, marked "proof failed" with the hatch
you missed: that is a finding about the proof, not a reason to loosen it.

## Report

The survivors matter most: each candidate you did not delete and the escape hatch that saved it. They map the
entry points, dynamic dispatch and string lookups the codebase relies on, which the next reader cannot see.

## Hold

knip with the repo's real entry points, as a shrink-only ratchet on unused files and exports. Not wired yet:
the holds table lists it as unchecked.

## Check

Does a new export, file or dependency have a caller? Does the change leave something without one?
