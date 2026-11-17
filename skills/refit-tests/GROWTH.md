# Growth lens

Does the suite grow with the code, or faster? A suite that grows faster than the code grows its runtime and upkeep, often through copies and hollow tests.

## Signals

`stats.ts growth [--months 12]`, per month: test files, test cases, skipped cases, test and source lines, the
ratio of the two, and test files added and deleted. `suite` gives aleph's last full-suite record per month (ran,
failed, skipped, rerun passed).

- **Ratio.** The test-to-source line ratio climbs month on month.
- **Cases per file.** Cases rise while files stay flat: files grow into catch-alls.
- **Skips.** The skipped count rises.
- **Churn.** Many test files added and deleted in one month: a rewrite, or tests written to be thrown away.
- **Wall time.** The suite's time rises faster than its case count ([RUNTIME.md](RUNTIME.md)).

## Proof

The numbers of two months and the commits that moved them most (`git log --stat` on the test files of the month).
Growth with the code is not a finding; growth with no matching code, or with copies, is.

## Fix

Growth has no fix of its own: name the lens the growth comes from (merge, hollow, runtime) and report it there.

## Guard

Rule: write-tests RULES.md 7 and 16.

