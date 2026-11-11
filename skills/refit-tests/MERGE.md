# Merge lens

Which tests check the same behaviour twice? A copy costs runtime and a second edit at each change, and it gives no
second protection.

## Signals

- **Same name.** Tests with the same or near-same name in two files.
- **Same body.** `jscpd` over the test files (refit-code's `clones.ts`): a clone between two tests.
- **Same lines.** Two tests whose lcov lines are the same set: run each file alone with coverage and compare.
- **Table candidates.** Three or more tests that differ only in their input and expected value: one table test.
- **Layers.** A unit test and an integration test that assert the same result of the same code.

## Proof

`stats.ts lcov <with both> <with one removed>` lists no lost line, and a break of the code the removed test checks
turns the kept test red. Name the assertion that moves, if any.

## Fix

Keep the test nearest the user's view, move any assertion only the other has into it, then delete the other. Fold
input-only variants into one table test.

## Hold

Model: `check`.

## Check

Does a new test assert what an existing test asserts? Name the existing test, or extend it.
