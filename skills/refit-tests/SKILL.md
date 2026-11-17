---
name: refit-tests
description: >
  Refit a test suite: find tests that do not gate a merge, flake, pass when
  the code is wrong, reach the network or clock, sleep, miss code, run slow,
  repeat each other, or grow faster than the code. Use to audit, speed up,
  clean up or deflake tests. NOT for:
  writing tests (use write-tests); one failing test (use diagnosing-bugs).
---

# Refit tests

[refit-code](../refit-code/SKILL.md) for the test suite. Nine **lenses** each ask one question. Follow
[refit/PROCESS.md](../refit/PROCESS.md) for the modes, the steps and the Act loop. This file holds what differs.

The lenses run in the order of harm. A suite that does not gate, or that cries wolf, teaches people to ignore it.
A slow or large suite costs time, not trust.

## Lenses

| Lens | Asks | File |
|---|---|---|
| **gates** | Does a red test stop a merge? | [GATES.md](GATES.md) |
| **flake** | Which tests fail with no change to the code? | [FLAKE.md](FLAKE.md) |
| **hollow** | Which tests pass when the code is wrong? | [HOLLOW.md](HOLLOW.md) |
| **hermetic** | Which tests reach past their own process and temp dir? | [HERMETIC.md](HERMETIC.md) |
| **smells** | Which tests wait, focus, print or guess where they should assert? | [SMELLS.md](SMELLS.md) |
| **gaps** | Which code that matters does no test reach? | [GAPS.md](GAPS.md) |
| **runtime** | Where does the suite spend its time? | [RUNTIME.md](RUNTIME.md) |
| **merge** | Which tests check the same behaviour twice? | [MERGE.md](MERGE.md) |
| **growth** | Does the suite grow with the code, or faster? | [GROWTH.md](GROWTH.md) |

Report a candidate under one lens only. Where lenses meet:

- A skipped or focused test is **gates** when it hides a failure from the merge, else **smells**.
- A sleep is **smells**, and **flake** when a flake record names the test.
- A test that reads the clock is **hermetic** until it flakes, then **flake**.
- A test that asserts nothing is **hollow**. A test that asserts what another test asserts is **merge**.
- A slow test is **runtime**, and **smells** when the time is a sleep.
- A test-only seam in the production code is **hollow**.

## Modes

`scan`, `fix` and `fix <run dir>` of PROCESS.md. The scope is lens names. The report's unit is a test file.

`stats.ts` in this directory gives the numbers (`bun <skill dir>/stats.ts` prints its commands). It reads a
report, the tree or git, and never runs the suite.

## Find

The baseline runs the repo's full test command with the JUnit reporter and lcov coverage where the runner has them
(bun: `--reporter=junit --reporter-outfile=<tmp>/junit.xml --coverage --coverage-reporter=lcov
--coverage-dir=<tmp>/cov`), and records the JUnit file and the lcov file.

1. **Measure.** From the repo root, run `stats.ts runtime <junit.xml>`, `growth`, `smells` and `flakes`. Read
   `tests/flaky.md` and each skip marker that points at it. For each test in `flakes` or `flaky.md`, and each
   file `smells` flags as sleep or timer wait, rerun the file alone 10 times (`--rerun-each=10`) and once in the
   full suite with `--randomize --seed=<n>`. Record each seed. Done when every command's JSON is saved and each
   rerun has a pass count.
2. **Hunt** by PROCESS.md. Read **runtime** and **growth** from the measures yourself. Each subagent gets the
   measures for its lens and the test files in its scope. A `stats.ts` hit is a candidate, never a finding: a
   pattern inside a fixture string, or random data for a unique temp name, drops with that reason. The Overview
   adds the test count, wall time, p95, the flake count, and the growth rows as a small chart. A card shows the
   test before and after.

## Act order

gates, smells, hermetic, flake, runtime, hollow, merge, then gaps. The suite then gates and runs the same each
time before a test goes, and a test goes before a test comes.

- **Delete or merge** a test only with two proofs. First, run the baseline's coverage command with the test
  removed, then `stats.ts lcov <before.lcov> <after.lcov>`. Each line it lists lost the only test that reached
  it: keep the test, or move its assertion into the survivor first. Second, break the code the test checks and
  show that a kept test goes red. Line coverage alone can pass, because bun marks a one-line function covered when
  its file loads. A **hollow** test, proven to pass when the code is wrong, needs neither proof.
- **Fix a flake** at its cause. Reproduce it first, under the parallel load of the full suite, and report the
  pass rate from that run before and after. Done when the test passes 10 reruns alone and one full randomized
  run.


## Guards

| Lens | Guard | Kind | Tool |
|---|---|---|---|
| smells | A sleep, timer wait or wall clock read in a test file | tool | a shrink-only lint test like `tests/clock-lint.test.ts` |
| smells | A focused test (`.only`) | unchecked | the same lint test, or the runner's CI mode |
| gates | A skip with no linked reason | unchecked | a lint test: each skip names its `tests/flaky.md` anchor or issue |
| gates | The skip count grows | unchecked | a shrink-only ratchet on `stats.ts growth` skipped |
| flake | A quarantined test stays out | unchecked | a lint test on the age of each `tests/flaky.md` entry |
| hermetic | A network call, fixed port or shared path in a test | unchecked | a shrink-only lint test like the clock lint |
| gaps | Coverage of the changed lines falls | unchecked | `stats.ts lcov` on the base and the branch |
| runtime | The suite or one test grows slower | unchecked | a ceiling on wall time from the JUnit report |
| hollow, merge, growth | A judgment | rule | write-tests RULES.md |

## Red flags

- **You fixed a flake with a sleep, a retry or a longer timeout.** That hides the race. Wait for the event, inject
  the clock, or isolate the state.
- **You deleted a test because it looked redundant.** Without the lcov proof, the deletion is a guess.
- **You set a coverage percentage as a goal.** Coverage shows what no test reaches, not what a test checks.
