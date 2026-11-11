# Gates lens

Does a red test stop a merge? A suite that does not gate is advice. Every other lens assumes this one holds.

## Signals

- **The gate.** Read the CI workflow, the pre-push and pre-commit hooks, and the merge or land command. Which test
  command runs before a change reaches the default branch, and does a failure stop it?
- **Exit codes.** `|| true`, `continue-on-error`, `set +e`, a test script that ends in `echo`, a wrapper that
  catches the runner's exit code.
- **What runs.** A test file the runner's glob or config does not pick up; a directory left out of the command; a
  test marked `todo` or skipped with no reason; a focused test (`.only`) that turns the rest of its file off.
- **Retries.** An automatic rerun of a failed test that turns its failure into a pass with no record.
- **Skips.** Each skip and its reason. `stats.ts growth` `skipped` per month shows whether the count grows.

## Proof

Show the path: the change that fails a test, the command that runs, and the exit code or the step that lets it
through. For a test the runner does not pick up, list the runner's file set and show the file is not in it.

## Fix

Make the failure stop the merge: remove the swallow, add the file to the glob, put the skipped test back or delete
it. A rerun on failure keeps the record of the first failure (aleph: `~/.aleph/factory/flaky.json`).

## Hold

A lint test that each skip names its reason (an anchor in `tests/flaky.md` or an issue); a shrink-only ratchet on
the skip count.

## Check

Does the change add a skip, a `todo`, an `only`, a retry or a test file? Name its reason, and the command that runs
it on the way to the default branch.
