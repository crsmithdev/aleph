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
