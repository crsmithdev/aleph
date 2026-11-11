# Runtime lens

Where does the suite spend its time? A slow suite runs less often, and its failures arrive after the author left
the change.

## Signals

`stats.ts runtime <junit.xml>`:

- **Wall and sum.** `wall` is the run's time, `sum` the time of its tests. A sum far above the wall means the runner
  runs files in parallel; a wall far above the sum means setup outside tests (process start, build, a
  `beforeAll`).
- **Tail.** `p95` and `max`; `topShare` is the part of `sum` the 10 slowest tests take. A large share means a few
  tests are the target.
- **Slowest tests and files.** For each: is the time a sleep or a timeout (then [SMELLS.md](SMELLS.md)), a real
  process or browser, a network call (then [HERMETIC.md](HERMETIC.md)), or work the test does not need (a full
  build, a large fixture, a repeated setup that `beforeAll` could share)?
- **History.** aleph's `suite-history.jsonl` (in `stats.ts growth` `suite`), or CI timings: does the wall time grow
  faster than the test count?

## Proof

Time the test alone before and after the change you propose, three runs each, and give the median. The cause is
the line that takes the time, found by a timer around it or a profile, not by its look.

## Fix

Remove the wait; share an expensive setup that no test changes; replace a real process with an in-process call
where the test does not test the process; move a test that needs a real browser or service to a slower tier that
runs before land, not on each save.

## Hold

A ceiling on the wall time and on one test's time, read from the JUnit report.

## Check

Does a new test start a process, a browser or a server, build the project, or wait? Name its expected time.
