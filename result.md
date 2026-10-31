# aleph-702: why a held start in `six starts at once` ends early

## Cause

Not confirmed from a recorded run. `bun run test` did not reproduce the failure here: 3 runs before the fix passed (1162 pass, 0 fail), so I have no recorded state and reason of an early-ended run from the test. The state and reason are therefore not named here.

What I reproduced is the race in the hypothesis, outside the test. Five shells ran the setup block of `jobs/lib/unit.ts` (`git fetch`, `worktree remove`, `worktree prune`, `branch -D`, `worktree add -b ... origin/main`) at once on one repo, 40 rounds. Failures seen:

- `worktree add`: `error: could not lock config file .git/config: File exists` and `unable to write upstream branch configuration` (9 times); the add exits non-zero, which the unit records as `failed`, reason `worktree add failed: ...`.
- `worktree add`: `fatal: bad object worktrees/wt4/HEAD`, from `worktree prune` in another unit.
- `git fetch`: `did not send all necessary objects` (1 time), which the unit records as `failed`, reason `fetch failed`. `fetchOrigin` retries only on "cannot lock ref".

A unit that fails there returns `code: 1` in `agent()`, and `started()` in `jobs/cli.ts` ignores the exit code, so the start prints its JSON and exits 0. That matches the logged symptom. These are the likely reasons, not a recorded one.

## Changes

- `jobs/cli.basic.test.ts`: the assertion on the first returned start prints the `state` and `reason` of the run when stdout holds a run (`endedRun`). The next failure records the reason. Committed first.
- `jobs/lib/unit.ts`: the fetch / remove / prune / branch -D / worktree add block runs under `lock("setup-<repo key>")`, so one unit of a repo runs it at a time. The lock waits up to 300 s; if it is busy the run fails with `setup lock busy`. No timeout raised, no test retry, no exit code change.

## Verification

`bun run test` (`bun test --timeout=30000 --parallel=$(nproc)`, 24 cores), in the foreground, one after another, after the last edit:

- Run 1: 1159 pass, 1 fail, exit 1. The failure was `(unnamed)` in `jobs/cli.slots-check.test.ts`, a beforeEach/afterEach hook timeout at 31 s, in a run that took 347 s against 82-218 s for the others. `guards > six starts at once` passed. The file passes alone (3 pass). I take it to be load, not this change, but did not prove that.
- Runs 2-6: 1162 pass, 0 fail, exit 0 each.
- `guards > six starts at once`: passed in 6 of 6 runs.
- `bun test jobs/cli.basic.test.ts`: 22 pass, 0 fail (before the lock change; it is in the full runs after).

## Limits

The failure did not reproduce under `bun run test`, before or after the fix, so a pass rate of 6 of 6 does not show the fix works. The fix rests on the git reproduction above. Running 8 copies of the guards test at once gave one 300 s timeout, not an early exit; I take that to be the 5-run live cap shared across copies, not this bug.

---
# aleph-743: why `guards > six starts at once` can hang

## Cause: not reproduced, the hypothesis is a real race
The hang did not reproduce: `bun run test` ran 6 times under the same parallel load (nproc workers) and the
test never hung (it passed each time). `bun test jobs/cli.basic.test.ts` alone also passed (22/22).
No log of the two original hangs was found, so the cause is **not proven**.

The hypothesis holds on the code. `dispatch` (jobs/lib/transitions.ts) waits `pidWaitMs()` for `pid`, warns
`wrote no pid`, and releases the lock. `isLive` does not count a run with no `pid`, so a later start could see
fewer than 5 live runs and pass the cap. With all six started, the held runs never end and no start returns.

## Changes
- Fix: `isStarting` (jobs/lib/ledger.ts) counts a running agent run with no `pid` and no `exit`, made less than
  120 s ago, and `liveEntries` (jobs/lib/factory.ts) includes it, so the live cap and gates count it.
- New test jobs/live-cap-pid.test.ts: a started run with no pid counts against the live cap; ended, exited and
  long-silent starts do not.
- Diagnostics: the test bounds `Promise.race` at 150 s. On a hang it fails with name, state, phase, pid and exit
  of each run, drops every running run, awaits the starts and prints each start's stderr (look for `wrote no pid`).
  No timeout was raised and no retry added. `aleph job` exit codes are unchanged.

## Observed pass rate
`bun run test`, 6 runs: 4 fully green (runs 2-5), run 1 had 2 failures (jobs/lib fetch-cache tests, which pass
alone), run 6 had 2 failures (`check slots`, load-sensitive). `six starts at once` passed in all 6 and never hung:
6/6. Fully green: 4/6; the other failures are in unrelated tests and were not investigated.

# aleph-710: git spawn errors name cwd and PATH

## Scratch check (bun 1.4.2)
- `Bun.spawnSync(["git","--version"], { cwd: "/nonexistent" })` throws `ENOENT: no such file or directory, posix_spawn 'git'`.
- `Bun.spawnSync(["git","--version"], { env: { PATH: "/nonexistent" } })` throws `Executable not found in $PATH: "git"`.

So the text `posix_spawn 'git'` comes from a missing cwd, not from a bad PATH.

## Reproduction
`bun test jobs/lib/plan.test.ts` was run 40 times, one after another, after the edit. All 40 runs passed. No failing run was seen, so this run has no enriched message, stack or failing git call to record, and no cause is guessed here.

The earlier run (commit 865c0eb9e, no longer in this repo) saw ENOENT in runs 23 and 27 of 40. It put the cause down to afterEach removing the store directory while a test that had timed out at 5000 ms was still running. That is consistent with the missing-cwd result above, but this run did not reproduce it.

## Change
`spawnGit` in `jobs/lib/git.ts` wraps `gitWith`, `readFiles` and `itemTimes`. A thrown spawn error is rethrown with the original as `cause`. The one-line message names the cwd, `existsSync(cwd)`, `process.cwd()`, the PATH passed, `Bun.which("git", { PATH })`, TMPDIR and `existsSync(tmpdir())`.

# aleph-758: fetch-ttl tests settle before every fetch count

## Changes (ui/fetch-ttl.test.ts)

- Second write test (`with the cache on and warm, ...`): `await settled()` before `start = fetches()`, and `await settled()` replaces `Bun.sleep(300)` after the loop that waits for the fetch line.
- First write test (`a write fetches in the foreground ...`): `await settled()` before `before = fetches()`. The test before it (`the UI fetches the work store at most once per 30 s ...`) ends with a background fetch whose `fetch` line is awaited but whose `done` line is not, so that fetch can still be open.
- No fetch count assertion changed. No timeout raised. `Bun.sleep(300)` is gone.

## Run 1 of aleph-743 vs f5276c4

Not determined. The sandbox has only this repo, and nothing in it names aleph-743 or that run's base commit. f5276c4 (aleph-705) is an ancestor of HEAD. So I cannot say whether run 1 started before or after it, and I have not assumed the first write test still fails. Its `settled()` before the first fetch count is already on this branch (line 97 before the change, and the new line before `before`).

## Verification

- `bun test ui/fetch-ttl.test.ts`: 7 pass, 0 fail.
- `bun run test` (`bun test --timeout=30000 --parallel=$(nproc)`), five runs in the foreground, one after another. Logs in `/tmp/aleph-758-logs/run{1..5}.log`, outside the repo.
  - Run 1: 1152 pass, 0 fail, exit 0
  - Run 2: 1152 pass, 0 fail, exit 0
  - Run 3: 1152 pass, 0 fail, exit 0
  - Run 4: 1152 pass, 0 fail, exit 0
  - Run 5: 1152 pass, 0 fail, exit 0
- `ui/fetch-ttl.test.ts` passed in 5 of 5 runs. No test in that file failed.

## Limits

- The failure reported in aleph-743 run 1 did not reproduce in this sandbox. The five runs show no failure, but they do not show that the load-sensitive failure is gone under the original load of that job. The stated oracle is met, but that is not a reproduction.

---

# aleph-702: land merge with origin/main

Merged `origin/main` (40241a2). Conflicts in `jobs/cli.basic.test.ts` (kept main's version of the guards test and added `endedRun` to its assertion message), `jobs/lib/unit.ts` (setup lock kept; main's `setup.log` entry and fetch error text in the reason kept inside it) and `result.md` (both sections kept). After the merge: `bun test jobs/cli.basic.test.ts` 22 pass; one `bun run test` run: 1172 pass, 0 fail (`six starts at once` passed). Only one full run was made after the merge, so the 5-run pass-rate above is from before it.

---

# aleph-770: fewer work store fetches per dispatch

## Count
Method: a `git` shim on PATH logs each `git fetch` run in the work store's clone. Test: `dispatchGoals` with
checks, three factory repos and no open goals (jobs/lib/factory.test.ts).

- Before: 6 store fetches (3 in `acceptanceStep`, one per repo; 3 in `openGoals`, one per repo).
- After: 2 (one shared reader in `acceptanceStep`; one in `openGoals`).

## Changes
- `reader()` (todo/lib/store.ts) fetches at most once, on its first list; later lists use `readFetched`.
  `goals()` over three repos is one fetch.
- `acceptanceStep` shares one reader for its list reads across repos; the re-read under each acceptance lock
  still makes a new reader and fetches fresh.
- `readList`, `readHidden`, `writeList`, `writeHidden`, the fresh reads in `dispatchGoals`, `fetchOrigin` retries
  and product repo fetches are unchanged. This does not fix aleph-771.
- Tests: store.test.ts (one reader over two repos, `goals()` over three: one fetch each); factory.test.ts
  (at most 2 store fetches).

---

# aleph-742: six starts at once early exit

No code change. The branch already has the fix: bdd3dae (aleph-702) holds `lock("setup-<repo.key>")` around fetch, worktree remove/prune, branch -D and worktree add (jobs/lib/unit.ts:828).

- The assertion message is on main (bdd3dae, jobs/cli.basic.test.ts:~205).
- `bun run test`: 2 full runs finished, 1172 pass / 0 fail each; a third was cut by the time box. `six starts at once` did not end early in any run, so there is no recorded state/reason of an early exit.
- Stress script (scratch, not in the diff): the setup git commands for 5 branches on one repo, concurrent and with no lock, 10 rounds. Collisions in 5 of 10 rounds:
  `could not lock config file .git/config: File exists` / `unable to write upstream branch configuration` (worktree add -b) and
  `could not create directory of '.git/worktrees/w5'` (prune removed another unit's half-made entry).
  Without the lock the hypothesis is reproduced, and `fetch`/`worktree add` failing makes the unit `failed` with code 0 from `started()`. With the lock these run one at a time.
- Not proven: that the lock removes all early exits, since the pre-lock failure never showed in my 2 runs. Pass rate with the lock: 2/2 full runs.
