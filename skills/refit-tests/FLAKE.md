# Flake lens

Which tests fail with no change to the code? A flaky test fails on one run and passes on the next at the same
commit. In 201 fixed flakes, 45% were async waits, 20% concurrency and 12% test order (Luo et al., FSE 2014). In
iDFlakies, 50.5% of flakes depended on order (Lam et al., ICST 2019).

## Signals

- **aleph's records.** `stats.ts flakes`: each test that failed and then passed on the rerun, with its count, first
  and last date. Rows with no test named come from runs that did not record names.
- **`tests/flaky.md`.** Each quarantined test, its likely cause and its age.
- **Reruns of step 2 of the retro.** A test that fails at least once in 10 reruns alone is flaky alone; one that
  passes alone and fails in the randomized full run depends on order or load. Record the seed.
- **The cause classes.** For each candidate, read the test for: a wait on time, not on an event (async); shared
  state between tests: a module-level variable, a file, a port, an env var, a database row (order); a race between
  two processes or timers (concurrency); a read of the clock or of random data (time, random); the network.

## Proof

A pass and a fail of the test on the same commit (posthog's bar). Name the cause class and the line. When 30 or
more runs in a row fail, it is a regression, not a flake: report it under the lens that owns the failure.

## Fix

Remove the cause: wait for the event the test needs, inject the clock (aleph: `jobs/lib/infra/clock.ts` or
`setSystemTime`), give each test its own temp dir and port 0, reset shared state in the test that sets it.
Quarantine (a skip that names its `tests/flaky.md` entry) only while the cause is not known, and never as the fix.

## Hold

The clock lint for waits and wall clock; an age limit on each `tests/flaky.md` entry.

## Check

Does a new test wait, read the clock, share a file, port or env var with another test, or start a process? Name
the event it waits for and the state it owns.
