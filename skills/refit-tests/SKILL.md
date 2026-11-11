---
name: refit-tests
description: >
  Refit a test suite: find tests that do not gate a merge, flake, pass when
  the code is wrong, reach the network or clock, sleep, miss code, run slow,
  repeat each other, or grow faster than the code. Use when asked to audit,
  speed up, clean up or deflake tests, or before you add tests (check). NOT
  for: writing tests (use tdd); one failing test (use diagnosing-bugs).
---

# Refit tests

[refit-code](../refit-code/SKILL.md) for the test suite. Nine **lenses** each ask one question. Read `.refit.json`
at the repo root when it exists: its `accepted` list, shared with refit-code, holds what the repo keeps on purpose,
each `{"concept", "copies": ["file[:line]", ...], "reason"}`.

The order of the lenses is the order of harm. A suite that does not gate, or that cries wolf, teaches people to
ignore it; flakes come mostly from async waits, concurrency and test order (Luo et al., FSE 2014), and half of the
flakes in iDFlakies depend on order (Lam et al., ICST 2019). A slow or large suite costs time, not trust.

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

Where they meet: a skipped or focused test is **gates** when it hides a failure from the merge, else **smells**; a
sleep is **smells**, and **flake** when a flake record names the test; a test that reads the clock is **hermetic**
until it flakes, then **flake**; a test that asserts nothing is **hollow**, a test that asserts what another test
asserts is **merge**; a slow test is **runtime**, and **smells** when the time is a sleep; a test-only seam in the
production code is **hollow**. Report a candidate under one lens only.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `retro [lens ...]` (default: all) | Baseline, measure, hunt, prove, fix and hold, report | Find what to improve |
| `act` | The fix of each finding the user picks | After a retro |
| `check` | Each new test, helper, fixture, skip and wait in a plan, spec or diff | Before or during a build |

`stats.ts` in this directory gives the numbers; `bun <skill dir>/stats.ts` prints its commands. It reads a report,
the tree or git, and never runs the suite.

## Retro

1. **Baseline.** Run the repo's full test command from its manifest, with the JUnit reporter and lcov coverage
   where the runner has them (bun: `--reporter=junit --reporter-outfile=<tmp>/junit.xml --coverage
   --coverage-reporter=lcov --coverage-dir=<tmp>/cov`). A red baseline ends the run. Done when the baseline is
   green and its commit, JUnit file and lcov file are recorded.
2. **Measure.** From the repo root, run `stats.ts runtime <junit.xml>`, `growth`, `smells` and `flakes`. Read
   `tests/flaky.md` and each skip marker that points at it. For each test in `flakes` or `flaky.md`, and each
   file `smells` flags as sleep or timer wait, rerun the file alone 10 times (`--rerun-each=10`) and once in the
   full suite with `--randomize --seed=<n>`. Record each seed. Done when every command's JSON is saved and each
   rerun has a pass count.
3. **Hunt.** Spawn one Explore subagent per lens in one message, except **runtime** and **growth**, which you read
   from the measures yourself. Give each its lens file's Signals section verbatim, the measures for its lens, and
   the test files in its scope. Each returns candidates as: lens, file and line, the signal that found it. Done
   when each subagent has returned.
4. **Prove, fix and hold, report.** Follow refit-code's [PROVE.md](../refit-code/PROVE.md) with this skill's lens
   files. A `stats.ts` hit is a candidate, never a finding: a pattern inside a fixture string, or random data for
   a unique temp name, drops with that reason. The report goes to `<tmpdir>/refit-tests-retro-<timestamp>.html`;
   its header adds the test count, wall time, p95, the flake count, and the growth rows as a small chart; a card
   shows the test before and after. Done when PROVE.md's step 3 is done.

## Act

refit-code's [Act](../refit-code/SKILL.md#act), in this order: gates, smells, hermetic, flake, runtime, hollow,
merge, then gaps, so that the suite gates and runs the same each time before a test goes, and goes before a test
comes.

- **Delete or merge** a test only with two proofs. First, run the baseline's coverage command with the test
  removed, then `stats.ts lcov <before.lcov> <after.lcov>`. Each line it lists lost the only test that reached
  it: keep the test, or move its assertion into the survivor first. Second, break the code the test checks and
  show that a kept test goes red. Line coverage alone can pass: bun marks a one-line function covered when its
  file loads. A **hollow** test, proven to pass when the code is wrong, needs neither proof.
- **Fix a flake** at its cause. Reproduce it first, under the parallel load of the full suite, and report the
  pass rate from that run before and after. Done when the test passes 10 reruns alone and one full randomized
  run.

## Check

1. **List the new things.** From the plan, spec or diff: each new test, helper, fixture, mock, skip, `only`, wait,
   timeout, port, temp path and env read in a test, and each export or parameter that only a test uses.
2. **Ask each lens's Check question** of each item. Record the answer.
3. **Judge.** Each item gets one verdict: **keep**, **reuse** (name the helper or test), **fix** (name the lens and
   the change), or **cut**. Done when every item has a verdict.

## Holds

| Lens | Hold | Kind | Tool |
|---|---|---|---|
| smells | A sleep, timer wait or wall clock read in a test file | tool | a shrink-only lint test like `tests/clock-lint.test.ts` |
| smells | A focused test (`.only`) | unchecked | the same lint test, or the runner's CI mode |
| gates | A skip with no linked reason | unchecked | a lint test: each skip names its `tests/flaky.md` anchor or issue |
| gates | The skip count grows | unchecked | a shrink-only ratchet on `stats.ts growth` skipped |
| flake | A quarantined test stays out | unchecked | a lint test on the age of each `tests/flaky.md` entry |
| hermetic | A network call, fixed port or shared path in a test | unchecked | a shrink-only lint test like the clock lint |
| gaps | Coverage of the changed lines falls | unchecked | `stats.ts lcov` on the base and the branch |
| runtime | The suite or one test grows slower | unchecked | a ceiling on wall time from the JUnit report |
| hollow, merge, growth | A judgment | model | `check` |

## Red flags

- **You fixed a flake with a sleep, a retry or a longer timeout.** That hides the race. Wait for the event, inject
  the clock, or isolate the state.
- **You deleted a test because it looked redundant.** Without the lcov proof, the deletion is a guess.
- **You set a coverage percentage as a goal.** Coverage shows what no test reaches; it does not show what a test
  checks.
