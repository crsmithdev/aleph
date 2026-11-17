# Gaps lens

Which code that matters does no test reach? This lens names the untested code and never a percentage.

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

Write the test through the public interface, red first ([write-tests](../write-tests/SKILL.md)). Write one test per behaviour, not per line.

## Guard

See [Guards](SKILL.md#guards).

## Check

Does the change add a behaviour with no test, or fix a bug with no test that fails before the fix?
