# check slots `fetch failed`: not reproduced

Part of aleph-753. Capture added in this child: when either fetch in `agent()` (`jobs/lib/unit.ts`) fails, it appends `## fetch: failed` and git's output to the run's `setup.log`; `cause()` in `jobs/cli.slots-check.test.ts` now prints each run's `setup.log`.

## Result

The git error did **not** reproduce. No fetch site (setup or after the worker) was captured.

`bun run test` was run in the foreground, one run after another, each output kept in a scratch log:

- Runs 1-5 completed: 3 passed (runs 2, 4, 5), 2 failed (runs 1, 3).
- Runs 6-8 were cut off by my `timeout 180` before the suite finished (a full run takes 100-330 s), so they say nothing. I stopped at 8 attempts, not 12, because of the 45 minute time box.
- No log contains `fetch failed`. No `check slots` test failed in any completed run.
- The two failures (runs 1 and 3) were `guards > six starts at once: five run, one is refused`, in `jobs/cli.basic.test.ts` (run 3 hit its 300 s timeout). Neither log contains `fetch failed`.

## jobs/cli.basic.test.ts

`cli.basic.test.ts` failed in runs 1 and 3 (the `guards` test above) but not with `fetch failed`: no log has that text. aleph-744 did not reproduce as `fetch failed`.

## Next

If `check slots` fails with `fetch failed` again, the test output now includes the `## fetch: failed` section from `setup.log` with git's text.

## 2026-10-30: loaded reproduction of the check slots failures (aleph-785)

No `check slots` failure reproduced in 6 attempts of `bun run test`, each run to its end, with a background load running beside them. `jobs/cli.slots-check.test.ts` passed in all 6 runs (3 tests each), and no `check slots` cause was captured, so there is no `cause()` output to quote.

### Runs

Each attempt was `bun run test` in the foreground, one after another, in a worktree at `.worktrees/slots-load`. Full output is in scratch logs under `/tmp` (not committed).

| Run | Duration | Result | Other failed tests |
|-----|----------|--------|--------------------|
| 1 | 293 s | exit 0, 1172 pass, 0 fail | none |
| 2 | 205 s | exit 0, 1172 pass, 0 fail | none |
| 3 | 394 s | exit 0, 1172 pass, 0 fail | none |
| 4 | 216 s | exit 0, 1172 pass, 0 fail | none |
| 5 | 174 s | exit 0, 1172 pass, 0 fail | none |
| 6 | 180 s | exit 1, 1172 pass, 1 fail | `ui/api/_test.ts`: worker crashed, `ModuleNotFound resolving ".../ui/api/_test.ts" (entry point)` |

None of the six runs was cut off. Run 3 took 394 s, longer than the 100 to 350 s the spec expected, and it still finished.

Run 6 is the one failure. `ui/api/_test.ts` is a temp file that `ui/server.test.ts` writes at line 29 and removes at line 35. The load loop also runs `ui/server.test.ts` (it runs `ui hooks`), so both runs can write and remove that file at the same time. This is an inference from the code, not verified: the file was missing when the worker tried to load it.

### Load

The load was a background loop, started before run 1 and stopped after run 6: `bun test ui hooks`, repeated. It ran 18 iterations; 17 completed (8 exited 0, 9 exited 1), and the 18th was killed in flight when the loop was stopped. The log is `/tmp/slots-load.log`. The load's own failures included `(fail) (unnamed)` (15 times, the same unnamed fixtures `beforeAll` as aleph-779), plus `a write fetches in the foreground even with the cache on, and builds on the fresh origin/main`, `links in the clone's fixture are not followed: nothing outside dest is written or copied` (twice), and `project paths come from the project names, never from the fixture's own repos.json`.

### Pass rate

`jobs/cli.slots-check.test.ts`: 6 of 6 passed inside `bun run test`. A standalone `bun test jobs/cli.slots-check.test.ts` also passed (3 of 3).

### Next

No `check slots` failure reproduced, so `fetch failed` and the `setup.log` capture are still unseen in this run. The next step is to run the slots test under load until a failure occurs, and read `cause()` from that run.

## Pass rate after the fixes

Main commit tested: `b794a01` (both the fetch-ttl settle fix and the fetchOrigin retry are on it). `bun run test` ran in the foreground, one run after another, each log kept in a scratch directory.

- Runs: 6 (5 passed, 1 failed; stopped at the fifth pass).
- `ui/fetch-ttl.test.ts` passed in 6 of 6 runs.
- `jobs/cli.slots-check.test.ts` passed in 6 of 6 runs.
- Other failed tests: run 3 only, `jobs/cli.basic.test.ts` > `guards > six starts at once: five run, one is refused` (93 s; the check at line 203 that all five live runs are in `phase: worker` after the 90 s wait received false). No other test failed in any run.
- `jobs/cli.basic.test.ts` did **not** fail with `fetch failed` in any run: no log contains that text (aleph-744 did not reproduce). Its one failure is the six-starts phase wait above.
