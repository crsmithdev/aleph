# Loaded `bun test ui hooks` runs: the unnamed (fail) (aleph-755)

Measured 2026-10-30 at b794a01 (origin/main, the branch was level with it), 24 cores (`nproc`). The machine's load average was already about 62 when the runs began, so the load below was on top of other work. Every run's complete output, with Bun's file header lines, was kept in `/tmp/aleph779/scratch` (`run-N.log`, `load-N.log`, `alone-N.log`, `loaded-N.log`); those files are not in the repo.

## Load method

Each measured run: `bun run test` (`bun test --timeout=30000 --parallel=24`) started in the background in its own process group (`setsid`), 2 s later `bun test ui hooks 2>&1 | tee run-N.log` in the foreground, then the load's process group was killed. The loop was meant to stop at the first `(fail) (unnamed)` line. Runs 3 and 4 were started in the same batch as run 2 before the output was read, so they ran past that point; the table reports all four.

## Per-run table

| Run | Pass | Fail | Tests run | `(fail) (unnamed)` line, file above it | Duration |
|---|---|---|---|---|---|
| 1 | 472 | 0 | 472 | none | 113 s |
| 2 | 468 | 1 | 469 | `(fail) (unnamed) [5003.88ms]`, under `ui/fixtures.test.ts:` | 98 s |
| 3 | 468 | 1 | 469 | `(fail) (unnamed) [5000.17ms]`, under `ui/fixtures.test.ts:` | 70 s |
| 4 | 472 | 0 | 472 | none | 69 s |

Both failures print "a beforeEach/afterEach hook timed out for this test." The named review-fixture test in `ui/fixtures.test.ts` did not fail by name in any run, so no aleph-747 failure was seen. The run prints `killed 1 dangling process` near its top in runs 2 and 3; it was not investigated.

The counts differ from the job's 462: `bun test ui hooks` ran 472 tests in a clean run here. The deduction holds on the one file: `ui/fixtures.test.ts` is the only file under `ui/` or `hooks/` with exactly four tests (`grep -c '^test('`) and a hook (`beforeAll`, line 9). `ui/stale.test.ts` and `hooks/lib/pricing.test.ts` have four tests and no hook. When `beforeAll` fails, the file's tests do not run, which accounts for the 472 - 469 = 3 fewer tests in runs 2 and 3.

## Phase durations

Temporary `performance.now()` marks around the whole `beforeAll` body, the `build.ts` spawn and the wait for the server's first stdout line, printed with `console.error`. Command: `bun test --timeout=30000 ui/fixtures.test.ts`, 3 runs alone and 3 runs under the load above. The marks were reverted; `git diff` of `ui/fixtures.test.ts` is empty.

| Phase | Alone, min | Alone, max | Under load, min | Under load, max |
|---|---|---|---|---|
| whole `beforeAll` | 2103 ms | 3164 ms | 1883 ms | 4568 ms |
| `build.ts` spawn | 2007 ms | 2842 ms | 1743 ms | 3967 ms |
| wait for server's first line | 94 ms | 404 ms | 136 ms | 600 ms |

All six timed runs passed (4/4 each), exit 0 for `build.ts`, and the server printed `http://127.0.0.1:<port>/` each time. The phase that takes the time is the `build.ts` spawn, not the server wait. The two failing runs in the table were not timed with the marks, so which phase held the 5000 ms there is not measured.

## Cause

`ui/fixtures.test.ts:9` gives its `beforeAll` no timeout argument, so Bun's default 5000 ms hook timeout applies. Under load the hook took up to 4568 ms when it completed, which is near 5 s, and the two failing runs reached 5000 ms and were cut off by it. The 30 s limit that `bun run test` uses kept the hook from failing in all six timed runs.

## Hook

Hook: ui/fixtures.test.ts beforeAll at line 9; verdict: slow
