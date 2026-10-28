# Suite time, 2026-10-27

Measured on this machine (24 cores, WSL2, bun 1.4.2). Per-file seconds come from `bun test <file>` run once per file, one after the other. Per-test seconds come from a wrapper around `test()` in a temporary copy of the file (not committed).

## Result

| | before | after |
|---|---|---|
| `bun test` wall time, 534 tests in 41 files (before) / 49 files (after) | 176.9 s | 24.1 to 25.0 s (`bun test --parallel`, five runs: 24.61, 24.98, 24.09, 24.81, 24.06) |
| reduction | | about 86% |
| pass / skip / fail | 518 / 16 / 0 | 518 / 16 / 0 in all five runs |
| `expect()` calls | 3473 | 3473 |

The 16 skips were there before (the live tests); no test was removed, skipped or weakened. `tsc` is clean.

## Where the time went

`jobs/cli.test.ts` took 145 s of the 177 s. Its 118 tests ran one after another in one file against one shared repo, and 139 s of that is the tests themselves: each one starts several `bun jobs/cli.ts` processes plus git, and the median test takes 0.8 s. Only 10 fixed `Bun.sleep` calls exist in the file, and most are waits that assert something (a land reaching the repo lock, nothing starting while paused). The other 40 files took 31 s together; `todo/cli.test.ts` (9 s) and `vault/cli.test.ts` (6 s) are the next largest.

So no single wait dominated. The cost was one 145 s file in a runner that ran files one at a time.

## What changed

- `jobs/cli.test.ts` is split into 9 files by `describe` block, with its shared setup (the fake worker, reviewer, remotes, TLS stub, helpers) moved to `jobs/cli.helpers.ts` and run by each file's `beforeAll`/`afterAll`. Each file builds its own temp directory and uses port 0, so the files do not share state or ports. Every test body is unchanged, except that three module variables the tests assigned (`lfStatus`, `lfPosts`, `onTell`) are now set through `resetLf`, `setLfStatus` and `setOnTell`. One test ("a held path needs Chris...") moved from the factory file to the reviewer file, because the report test that follows it reads its run.
- `jobs/cli.dispatch.test.ts`: the fixed 3 s wait in `afterAll` is now a poll that ends as soon as the released runs have settled, and waits at most 3 s as before.
- `package.json` (held path): `"test"` is now `bun test --parallel`. bun 1.4.2 has no bunfig key for this, so plain `bun test` still runs the files one at a time (177 s, same as before). `bun run test` and `bun test --parallel` give the 24 s figure.

## Per-file seconds, before

| file | seconds |
|---|---|
| jobs/cli.test.ts | 145.44 |
| todo/cli.test.ts | 8.99 |
| vault/cli.test.ts | 6.10 |
| jobs/lib/triage.test.ts | 3.16 |
| ui/timeline.test.ts | 1.98 |
| hooks/hooks.test.ts | 1.75 |
| ui/state.test.ts | 0.73 |
| ui/activity.test.ts | 0.73 |
| hooks/verify-gate.test.ts | 0.55 |
| ui/memory.test.ts | 0.55 |
| ui/issues.test.ts | 0.47 |
| jobs/lib/review2.test.ts | 0.34 |
| ui/skills.test.ts | 0.33 |
| ui/projects.test.ts | 0.32 |
| hooks/vault-recall.test.ts | 0.26 |
| jobs/lib/gate.test.ts | 0.23 |
| ui/fetch-ttl.test.ts | 0.17 |
| hooks/obs-task-type.test.ts | 0.12 |
| ui/jobs.test.ts | 0.12 |
| ui/actions.test.ts | 0.10 |
| hooks/context-gate.test.ts | 0.08 |
| vault/lib/vault.test.ts | 0.05 |
| ui/server.test.ts | 0.05 |
| ui/sessions.test.ts | 0.03 |
| hooks/lib/judge.test.ts | 0.03 |
| todo/lib/triage.test.ts | 0.02 |
| ui/now.test.ts | 0.02 |
| ui/page.test.ts | 0.02 |
| jobs/lib/sandbox.test.ts | 0.02 |
| tests/live/langfuse.test.ts | 0.02 |
| jobs/lib/trace.test.ts | 0.02 |
| jobs/lib/deps.test.ts | 0.01 |
| ui/lib.test.ts | 0.01 |
| jobs/lib/route.test.ts | 0.01 |
| hooks/lib/digest.test.ts | 0.01 |
| tests/live/judge.test.ts | 0.01 |
| tests/live/vault.test.ts | 0.01 |
| tests/live/factory.test.ts | 0.01 |
| hooks/lib/pricing.test.ts | 0.01 |
| tests/live/jobs.test.ts | 0.01 |
| tests/plugin.test.ts | 0.01 |

## Per-file seconds, after (each file alone, one after the other)

| file | seconds |
|---|---|
| jobs/cli.factory.test.ts | 23.07 |
| jobs/cli.land.test.ts | 22.47 |
| jobs/cli.reviewer.test.ts | 18.87 |
| jobs/cli.item.test.ts | 17.87 |
| jobs/cli.dispatch.test.ts | 16.53 |
| jobs/cli.recheck.test.ts | 12.13 |
| jobs/cli.batch.test.ts | 12.08 |
| jobs/cli.milestone.test.ts | 9.47 |
| todo/cli.test.ts | 8.86 |
| jobs/cli.basic.test.ts | 6.94 |
| vault/cli.test.ts | 6.03 |
| jobs/lib/triage.test.ts | 3.04 |
| ui/timeline.test.ts | 1.77 |
| hooks/hooks.test.ts | 1.70 |
| ui/activity.test.ts | 0.70 |
| ui/state.test.ts | 0.64 |
| hooks/verify-gate.test.ts | 0.53 |
| ui/memory.test.ts | 0.52 |
| ui/issues.test.ts | 0.44 |
| jobs/lib/review2.test.ts | 0.33 |
| ui/skills.test.ts | 0.32 |
| ui/projects.test.ts | 0.27 |
| jobs/lib/gate.test.ts | 0.24 |
| hooks/vault-recall.test.ts | 0.22 |
| ui/fetch-ttl.test.ts | 0.15 |
| hooks/obs-task-type.test.ts | 0.11 |
| ui/jobs.test.ts | 0.10 |
| ui/actions.test.ts | 0.09 |
| vault/lib/vault.test.ts | 0.06 |
| hooks/context-gate.test.ts | 0.05 |
| ui/server.test.ts | 0.05 |
| ui/sessions.test.ts | 0.03 |
| hooks/lib/judge.test.ts | 0.03 |
| todo/lib/triage.test.ts | 0.02 |
| ui/page.test.ts | 0.02 |
| jobs/lib/sandbox.test.ts | 0.02 |
| ui/now.test.ts | 0.02 |
| jobs/lib/trace.test.ts | 0.01 |
| tests/live/langfuse.test.ts | 0.01 |
| jobs/lib/route.test.ts | 0.01 |
| ui/lib.test.ts | 0.01 |
| hooks/lib/digest.test.ts | 0.01 |
| tests/live/judge.test.ts | 0.01 |
| jobs/lib/deps.test.ts | 0.01 |
| tests/live/jobs.test.ts | 0.01 |
| tests/live/vault.test.ts | 0.01 |
| tests/live/factory.test.ts | 0.01 |
| tests/plugin.test.ts | 0.01 |
| hooks/lib/pricing.test.ts | 0.01 |

Run in parallel the suite takes as long as its slowest file plus contention: 24 s against 23 s for `jobs/cli.factory.test.ts` alone.

## The 20 slowest tests, before

| s | test (jobs/cli.test.ts, before the split) |
|---|---|
| 12.93 | a dispatch while paused or with main red starts nothing, and adding a goal starts its run with no tick |
| 5.42 | a worker that keeps printing is not stalled |
| 4.99 | three ready branches land one at a time, in the order their lands were made |
| 4.95 | a conflict the worker cannot resolve goes back twice, then stops and leaves the remote alone |
| 4.58 | a conflict in one run takes only that run out |
| 3.63 | two lands at once in one repo both reach main, neither undoing the other |
| 3.00 | a branch that changes the list is refused, goes back to the worker, and lands without the change |
| 2.99 | a conflict records its paths, sends the job back to the worker, and the passed follow-up lands |
| 2.75 | a stuck job holds the factory: no start, no land by itself; Chris's land works; pause is separate; a drop clears it |
| 2.68 | a follow-up on a stuck job starts from the job's previous branch |
| 2.65 | a worker silent for ALEPH_STALL_SECONDS is stuck as stalled, with no fix round |
| 2.39 | the fix round's note has the line and the failing test names, and the job lands once it passes |
| 2.37 | a batch of three: one check call, one push, three commits, each run landed with its own Item and Job trailers |
| 2.13 | a worker that keeps failing is stuck after 2 fix rounds, in 3 runs |
| 2.12 | a failed check goes back to the worker, whose note names it with the log; the job passes after 1 fix round |
| 2.11 | a run that breaks the check fails with the check's name; the others land; at most 1 + 2 + 2 checks |
| 2.08 | a failed restart leaves the land landed, and a later land restarts for an earlier ui/ commit |
| 2.01 | aleph-ui restarts when an aleph land changes ui/, and only then |
| 2.00 | a run whose checked base is origin/main lands with no check call; one behind main runs the checks |
| 1.89 | a tick skips a goal due tomorrow, and one that waits on an open item, until it is ready |

All other tests in the suite (todo, vault, hooks, ui, jobs/lib) take 1.2 s or less each.
