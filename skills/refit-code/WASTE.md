# Waste lens

Does this code do work it does not need? Slop is code bigger than its job; waste is code that runs more than its
job. A slow path that a user or a test waits on is a finding; one nobody waits on is not.

## Signals

- **Repeated work.** The same file read, query, parse, spawn or network call inside a loop, or once per item where
  once per run does.
- **Recomputation.** A value computed again from raw data on each call when its inputs have not changed.
- **Work for nothing.** A whole collection loaded, sorted or serialized to use one element; a result computed and
  dropped.
- **Polling** where the source pushes an event; a sleep that waits for something the code could await.
- **Blocking on the hot path.** Sync file or process calls in a request handler, a hook or a UI render.
- **Unbounded growth.** A cache, log, map or listener list that only grows.
- **Hot spots from history.** Commits that say "slow", "timeout", "perf"; tests with long timeouts.

## Proof

A measurement or a count: time the path before and after (`hyperfine`, `bun test` timings, a trace), or count the
calls for an input of size n and show the order. "Could be faster" with no one waiting is dropped. A slow path
that is a bug or a regression goes to `/aleph:diagnosing-bugs`.

## Fix

Hoist the work out of the loop, batch the calls, cache with a key that changes with the inputs, await the event,
bound the growth. Keep the change only when the measurement moves.

## Hold

A timing test or benchmark with a ceiling on the path; unchecked until one exists.

## Check

Does each new loop, call or cache run once per what it needs, and does anything wait on it?
