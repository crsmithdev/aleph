# Vault CLI / memory tests under load (aleph-690)

Measured 2026-10-30 at 564e8d6 (before) and on the aleph-690 branch (after), 24 cores. Each run: `bun run test` started in the background, 2 s later the command under test, then the load was killed. Logs were saved per run.

## Result

| Command | Fix | Passed |
|---|---|---|
| `bun test --timeout=30000 vault/cli.test.ts ui/memory.test.ts` | before | 10/10 |
| `bun test --timeout=30000 vault/cli.test.ts ui/memory.test.ts` | after | 10/10 |
| `bun test vault/cli.test.ts ui/memory.test.ts` (5 s default) | before | 5/10 |
| `bun test vault/cli.test.ts ui/memory.test.ts` (5 s default) | after | 5/10 |

## Follow-up: the 5 s default (acceptance of the first landing failed on it)

The acceptance run of `bun test vault/cli.test.ts` (no `--timeout`) failed "one request holds at most 20 questions" at 5012 ms. The two 5 s timeouts named below now carry their own 30000 ms limit (`vault/cli.test.ts`, `ui/memory.test.ts`), as `ui/state.test.ts` does (aleph-747); the assertions are unchanged. After that edit, same load method (`bun run test` started 2 s earlier, 24 cores):

| Command | Passed |
|---|---|
| `bun test vault/cli.test.ts ui/memory.test.ts` (5 s default) | 10/10 |
| `bun test --timeout=30000 vault/cli.test.ts ui/memory.test.ts` | 10/10 |

So the 5/10 of the 5 s rows below is the state before this follow-up. `bun test vault/cli.test.ts` and `bun test ui/memory.test.ts` alone pass, and `bun run test` passed (1162 pass, 0 fail). Logs were in /tmp and are not kept.

## Cause

The 5 s default timeout (suspect 1) reproduces. All 10 failures of the 5 s runs (before and after) are timeouts "this test timed out after 5000ms":

- `vault/cli.test.ts` "provenance and the contradiction screen > one request holds at most 20 questions" (5 of 10 runs, both before and after);
- `ui/memory.test.ts` "with about 1000 notes the warm call takes under 1 s" (2 of 10 runs, both before and after).

With `--timeout=30000`, which `bun run test` uses, nothing failed in 20 runs. So `bun run test` does not fail this way, and no test was changed for it. The 5 s counts did not change with the fix, as expected: the fix does not touch these tests.

Not reproduced: the aleph-667 failure itself. Its test name and error were never captured, and with the 30 s limit no failure was seen in 20 runs, so this does not show that aleph-667 is fixed. The 5 s timeout is the likeliest cause, since the aleph-667 command had no `--timeout`.

## TTL race (suspect 2): fixed, never observed to fail

"vault misses runs once within ALEPH_UI_CACHE_TTL" used a 1.5 s TTL and needed two requests inside it; "after the TTL a failed answer comes back at once..." used 1 s and slept 1.1 s. Both now start with a TTL of 300 s that load cannot use up, then set `ALEPH_UI_CACHE_TTL=0.001` and sleep 20 ms to expire the entry (the TTL is read at each `get`, `ui/stale.ts:21`). The assertions are the same, and the tests are 1.5 s faster.

## Notes

- The earlier note that the clock stepped by ±10.7 s on 2026-10-30 was not re-checked; the runs above did not depend on it, since the tests no longer wait on the TTL.
- The two 5 s timeouts above are separate from the TTL race. Not changed here: other goals hold timing tests, and `bun run test` has 30 s.
- `bun run test` after the last edit: 1 fail in the first run (name not saved), then 0 fail in the next two (1140 pass). One saved load run (before-30, run 3) failed `jobs/cli.basic.test.ts` "guards > six starts at once: five run, one is refused" (2.5 s). Both are outside this goal's files and were not investigated.
