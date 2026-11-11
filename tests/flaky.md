# Flaky tests

Each test here is skipped with `// flaky: tests/flaky.md#<anchor>`. A test comes back when
its cause is fixed and it passes 5 runs in a row alone and one run under the full parallel suite. Then its
section goes.

The sources are the flake trackers aleph-1156 and aleph-920 (notes from 2026-10-28 on), the run records whose
`tests` check failed and then passed on the rerun (`~/.aleph/runs/*/state.json`, `rerun: true`), and the
factory monitor of 2026-11-02 and 2026-11-03. The cause column is the likely cause, not a proven one.

Not skipped, because they are no longer in the tree: `check slots > the wait for a slot does not count against
ALEPH_CHECK_TIMEOUT` and `check slots > with one slot two checks started together run one after the other`
(jobs/cli.slots-check.test.ts, rewritten in 17c5cc435), `review browser step > when Chrome's sandbox cannot start`
(review.test.ts, gone), and the tests that moved to acceptance/.

"Fixed after" names a commit that came after the last flake seen and that names the cause. Such a test is the
first to try to bring back.

## hooks-tools-nest
hooks/hooks.test.ts > obs hook > tools nest under the turn in its trace with real duration; Stop completes the same turn span. Fails: once per full run, passes alone. Seen: 2026-11-01, 2026-11-03. Cause: clock (it slept 120 ms to assert a span over 100 ms). Fixed after: 17c5cc435 (ALEPH_NOW).

## basic-follow-up
jobs/cli.basic.test.ts > job > a follow-up runs in the same worktree with the spec, notes and previous result. Fails: once in five full runs (905 ms), passes alone. Seen: 2026-11-01, 2026-11-04. Cause: load.

## basic-jobs-lists
jobs/cli.basic.test.ts > job > jobs lists open jobs; jobs <name> adds the result. Fails: once in five full runs (247 ms), passes alone. Seen: 2026-11-01, 2026-11-04. Cause: load or shared state (it ran in the same full runs as basic-follow-up).

## basic-no-name
jobs/cli.basic.test.ts > job > with no name, jobs lists the open jobs, then the jobs that ended in the last 24 hours, the latest first. Fails: "newer" and "older" in swapped order in a full parallel run. Seen: 2026-11-01. Cause: clock (end times from the wall clock, which stepped back during that burst).

## basic-six-starts
jobs/cli.basic.test.ts > guards > six starts at once: five run, one is refused. Fails: in the full suite, passed on the rerun (4 runs). Seen: 2026-10-28, 2026-10-30. Cause: load (it races six CLI starts and waits up to 150 s with Bun.sleep).

## basic-news
jobs/cli.basic.test.ts > news that Sidetone missed is printed once by jobs --news. Fails: in the full suite, passed on the rerun (4 runs, the same runs as basic-six-starts). Seen: 2026-10-28. Cause: shared state with the other tests of the file.

## dispatch-once-cap-1
jobs/cli.dispatch-once.test.ts > two dispatches at once with a live cap of 1 start only one goal. Fails: in the full suite, passed on the rerun. Seen: 2026-10-28. Cause: load (waitFor with a 3 s limit).

## land-manual-check
jobs/cli.land.test.ts > land > a job with a manual check lands with the check open as a to-do item, until checked. Fails: `condition: "landed"` with no `check: "open"` (expected -1, received +12), full runs 1 and 2; passes 9 of 9 alone. Seen: 2026-11-01. Cause: load. The to-do test after it used the demo-1 item that this test makes; it now makes its own.

## land-autoland
jobs/cli.land.test.ts > land > in a repo that lands by itself, a passed job lands with no aleph land. Fails: once when three files ran together. Seen: 2026-11-01. Cause: load.

## landcheck-two-lands
jobs/cli.landcheck.test.ts > two lands of one job at once start one land run. Fails: in the full suite, passed on the rerun (3 runs). Seen: 2026-10-28, 2026-11-01. Cause: load (a race between two lands).

## milestone-three-branches
jobs/cli.milestone.test.ts > three ready branches land one at a time, in the order their lands were made. Fails: once in 8 baseline suites; main's last 3 commits are not in `made` order. Seen: 2026-11-04. Cause: clock (`made` is Date.now(); the WSL2 wall clock steps back 0.5 to 0.7 s about every 30 s).

## tick-one-run-per-goal
jobs/lib/transitions/factory.tick.test.ts > a factory run > a tick starts one run per open goal, lands it, and then has nothing to start. Fails: in the full suite, passed on the rerun (2 runs). Seen: 2026-11-01, 2026-11-04. Cause: load.

## batch-member-failed
jobs/lib/land/landing.batch.test.ts > a member that failed in attempt 1 does not take the leader out when main moves twice. Fails: the 60 s test limit. Seen: 2026-10-28. Cause: load.

## checks-commit-added
jobs/lib/land/landing.checks.test.ts > a commit added to the branch after its checks gets the checks on land. Fails: the 60 s test limit (2 runs). Seen: 2026-10-28. Cause: load.

## conflict-records-paths
jobs/lib/land/landing.conflict.test.ts > a conflict records its paths, sends the job back to the worker, and the passed follow-up lands. Fails: in 2 full runs, passes alone. Seen: 2026-11-03. Cause: load.

## merge-lost-race
jobs/lib/land/landing.merge.test.ts > a push that loses a race merges again in the same land, and lands. Fails: run kinds come back as land, build instead of build, land. Seen: 2026-11-01. Cause: clock (runs sorted by a wall-clock stamp).

## launch-detached-unit
jobs/lib/transitions/launch.test.ts > detached starts its verb in a unit of its own, a different one per call. Fails: both calls get the same unit name (CI). Seen: 2026-11-01. Cause: clock (the unit name used only Date.now() and the pid). Fixed after: jobs/lib/transitions/launch.ts now adds a per-process count to the name.

## review-held-path
jobs/lib/roles/review.flow.test.ts > a factory run > the reviewer > a held path the reviewer holds is a fix round, not an Ask. Fails: in the full suite, passed on the rerun. Seen: 2026-11-04. Cause: load.

## review-stuck-follow-up
jobs/lib/land/review.land.test.ts > a follow-up on a stuck job starts from the job's previous branch. Fails: at 5007 ms, the 5 s hook or test limit. Seen: 2026-10-28. Cause: load.

## auth-password-gate
ui/auth.test.ts > password gate: login, session across servers, logout. Fails: under load, passes on the quiet rerun. Seen: 2026-10-31. Cause: load.

## fixture-factory-folder
ui/fixtures/review/build.test.ts > the fixture environment points the factory folder under its dest, and a factory log line lands there, not in the live factory. Fails: in a full-suite run; passes alone. Seen: 2026-11-03. Cause: shared state (environment variables of the test process).

## browser-memory-row
ui/browser.test.ts > the UI in Chrome > Memory: a row opens in the inspector. Fails: failed once in a run of ui/browser.test.ts alone, after passing the run before; passed in the other runs. Seen: 2026-11-11. Cause: unknown; four different tests failed together in one full run, so likely load.

## browser-deny-enter
ui/browser.test.ts > the UI in Chrome > Enter in the reason box confirms a Deny, and the card leaves before any reload of the state. Fails: failed once in four full runs with ALEPH_BROWSER_TESTS=1 (76 ms); passed in the other runs. Seen: 2026-11-11. Cause: unknown; four different tests failed together in one full run, so likely load.

## browser-dead-blocker
ui/browser.test.ts > the UI in Chrome > a dead blocker shows on the Issue page, and Stop waiting removes it. Fails: failed once in four full runs with ALEPH_BROWSER_TESTS=1, at the 30 s limit; passed in the other runs. Seen: 2026-11-11. Cause: unknown; four different tests failed together in one full run, so likely load.

## browser-logout-gate
ui/browser.test.ts > the UI in Chrome > Log out shows only behind the password gate. Fails: failed once in four full runs with ALEPH_BROWSER_TESTS=1 (111 ms); passed in the other runs. Seen: 2026-11-11. Cause: unknown; four different tests failed together in one full run, so likely load.

## browser-401-reload
ui/browser.test.ts > the UI in Chrome > a 401 reloads the page. Fails: failed once in four full runs with ALEPH_BROWSER_TESTS=1 (0.3 ms); passed in the other runs. Seen: 2026-11-11. Cause: unknown; four different tests failed together in one full run, so likely load.
