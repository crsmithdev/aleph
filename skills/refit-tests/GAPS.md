# Gaps lens

Which code that matters does no test reach? Coverage shows what no test runs; it does not show what a test checks,
so this lens names the untested code and never a percentage.

## Signals

- **lcov of the baseline.** Files with no covered line; functions with no covered line; branches of an error path
  with no hit.
- **Weight.** Rank the uncovered code by churn (`git log --format= --name-only | sort | uniq -c`), by the bugs
  fixed in it (`git log --grep='fix'` on the file), and by what fails if it is wrong: data written, money, auth, a
  user-facing command.
- **Test kinds.** A module with only unit tests where its value is in how it meets another (a CLI, a parser and its
  store); a public command with no test that runs it.
- **Fixed bugs.** A `fix` commit that added no test.

## Proof

The lcov line and its zero, and the reason the code matters: the churn count, the bug commit, or the effect of a
wrong result. Generated code, a type, and a log line drop with that reason.

## Fix

Write the test through the public interface, red first ([tdd](../tdd/SKILL.md)). One test per behaviour, not one
per line.

## Hold

`stats.ts lcov` on the base and the branch: a branch that drops a covered line names why.

## Check

Does the change add a behaviour with no test, or fix a bug with no test that fails before the fix?
