# Smells lens

Which tests wait, focus, print or guess where they should assert? Each smell is a line pattern from the tsDetect
catalog (Peruma et al., 2020) and its kin; most are cheap to fix and cheap to hold.

## Signals

`stats.ts smells`, lens `smells`:

| Rule | Why it is a smell |
|---|---|
| sleep | The test waits for a time, not for the event. Too short flakes, too long wastes |
| timer wait | `setTimeout` with a delay, `setInterval`: the same wait, hidden |
| poll until a deadline | `waitFor`, `until`: a wait with a timeout. Fine when the event has no signal; a smell when it has one |
| focused test | `.only` runs one test and skips the rest of its file |
| skipped test | `.skip`, `.todo`, `xit`: code no run checks |
| print in a test | `console.log` in a test is a debug line left in, or an assertion a human reads |
| random with no seed | A failure that a rerun cannot reproduce |
| always-true assertion | Asserts a constant; see [HOLLOW.md](HOLLOW.md) |
| snapshot | Compare its size and its update history with the code's |

Also read for: a test longer than 50 lines that tests many behaviours (eager test); conditional logic or a loop
in a test body; a shared fixture that each test uses only part of; a magic number with no name; a test name that
does not say the behaviour.

## Proof

Open the line. A sleep, a timer or a poll proves itself when the event it waits for has a signal the test can
await (a promise, an event, a file, a log line). `Math.random` for a unique temp name, and a pattern inside a fixture
string, drop with that reason.

## Fix

Await the event. Remove `.only` and debug prints. Seed random data or use fixed data. Split an eager test by
behaviour.

## Hold

A shrink-only lint test over test files with an exceptions list, the shape of `tests/clock-lint.test.ts`, for
each rule that the repo fixes.

## Check

Does a new test sleep, poll, focus, print, use unseeded random data, or test more than one behaviour?
