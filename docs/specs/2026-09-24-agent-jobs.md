# Agent jobs

Written 2026-09-24. Version 3, after two red teams. Round 1 and its evidence
are in [`2026-09-24-agent-jobs-red-team.md`](2026-09-24-agent-jobs-red-team.md),
and round 2 is summarized at its end. Version 1 is `3d1ffa8` in git. Not built.

## Problem Statement

Chris drives development through one agent, more and more by voice through
Sidetone. That agent starts detached work with Sidetone's `scripts/job`: about
74 agent runs and 21 plain commands from 21 to 24 September, all in Sidetone,
up to 5 at once, with a median of 4 minutes.

| Problem | Evidence |
| --- | --- |
| A job's change reached main when its tests passed but the change was wrong | `e0dd6d1` reverts `2eddeb1`. Job `app-queue` merged it after unit tests passed. Its log says "Nothing has run on a device." |
| Workers land their own changes when a prompt tells them to | 7 jobs merged to main. In 5 of them the lead's prompt asked for it. |
| Every land is done a different way | by hand, by a `land-*` job, or by the worker |
| Work is expected to move to other repos | Chris's forecast; 0 jobs so far outside Sidetone |

The threat is a worker that follows a wrong instruction or makes a mistake.
It is not a worker that tries to get around its limits. The limits below are
guards, not a sandbox.

## Solution

1. The lead runs `aleph job <repo> <name>` with a spec. aleph creates a worktree and starts a systemd unit. In the unit, setup, a fresh `claude -p` worker and the repo's checks run, then the state is written.
2. A worker's `git push` fails, because its environment points the remote at an address that does not exist.
3. The checks' exit codes decide the state. A change to a path with a manual check, such as `android/**`, waits for Chris.
4. aleph POSTs one short line to Sidetone's `/say`. The line holds no free text.
5. Chris says "land <name>". `aleph land` runs as a unit too: it rebases, runs the checks again, and pushes one squash commit. It touches the main checkout only after the push.
6. A follow-up is `aleph job` again with the same name: a new run in the same worktree.
7. `aleph run <name> -- <command>` replaces `scripts/job` for plain commands, such as a Gradle build.

## User Stories

1. As Chris, I want to start an agent job in any registered repo by voice or in a typed session, so that the runner does not depend on one repo.
2. As Chris, I want an unknown repo refused, so that a misheard word never starts work in the wrong place.
3. As the lead, I want each worktree ready to test before the worker starts, so that the worker does not spend its run on setup.
4. As Chris, I want at most 4 agent runs at one time, so that the subscription holds.
5. As Chris, I want a run to survive the end of the session that started it and a restart of Sidetone, so that an interrupted turn does not kill work.
6. As Chris, I want a stuck worker or a stuck check stopped, so that nothing uses quota or ports for hours.
7. As Chris, I want a worker unable to push, so that only a land moves the remote main.
8. As Chris, I want the state decided by the repo's checks on the committed branch, so that "passed" means the code that lands passed.
9. As Chris, I want a change to a path with a manual check to wait for me, so that an untested Android change cannot land on unit tests alone.
10. As a worker, I want to stop with a question, so that I do not guess at Chris's intent.
11. As Chris, I want each run's end in one short line with no free text, so that nothing secret is spoken or shown on the phone.
12. As Chris, I want to answer a question or ask for a fix with a new run in the same worktree, so that the branch carries the work so far.
13. As Chris, I want "land <name>" to push a passed job after a rebase and the checks, so that main stays green.
14. As Chris, I want a land that fails to change nothing on the remote and to tell me why, so that I decide what happens next.
15. As Chris, I want to drop a job with a reason, so that every job ends with a recorded state.
16. As the lead, I want to list open jobs and read a run's result and question, so that I can answer "what is running?" and repeat news.
17. As Chris, I want each run's Langfuse session known from the start, so that I can see what a worker did, even when it was killed.
18. As Chris, I want the phone's working sign on for the whole run, checks included, so that the app shows work with no turn behind it.
19. As the lead, I want to run a plain command detached, so that builds and checks survive a barge-in.
20. As Chris, I want `scripts/job` removed, so that one runner remains.

## Acceptance Criteria

Numbers match the user stories.

1. WHEN `aleph job <repo> <name> <spec-file>` runs from any directory THE system SHALL create a run folder in `~/.aleph/jobs/` and start unit `aleph-<run-id>`.
2. IF `<repo>`, lowercased with spaces removed, matches no registry key THEN THE system SHALL exit 1, create nothing, and print the keys.
3. WHEN the first run of a name starts THE system SHALL create branch `job/<name>` and worktree `<repo>/.worktrees/<name>` from `origin/<main>`, record that commit as the base, and run the registry's `setup` commands in the unit before the worker. IF a setup command fails THEN the run SHALL end `failed` with that command in the reason.
4. IF 4 agent runs are live THEN `aleph job` SHALL exit 1 and name them. Plain runs and land runs do not count.
5. WHEN the dispatching process exits, or `sidetone.service` restarts, THE run SHALL continue and end with a state.
6. WHEN the worker passes `ALEPH_JOB_TIMEOUT` seconds (default 2400), or one check passes `ALEPH_CHECK_TIMEOUT` seconds (default 1200), THE system SHALL stop it and its process group, AND the run SHALL end `failed` with the reason "timed out" and what timed out.
7. WHEN a worker runs `git push` THE push SHALL fail. WHILE `ALEPH_JOB_ID` is set, `skip verify` in the prompt SHALL NOT skip the verify gate.
8. WHEN the worker exits 0 THE system SHALL first check that the worktree has no tracked changes. IF it has THEN the run SHALL end `failed` with "uncommitted changes". ELSE it SHALL run every check whose `when` globs match a file changed since the base, or that has no `when`, and the run SHALL be `passed` only when all exit 0.
9. IF the checks pass AND a changed file matches a `manual` glob THEN the run SHALL end `needs-you` with kind `manual` and the registry's sentence.
10. IF the worker's last message has a line that starts with `QUESTION:` THEN the run SHALL end `needs-you` with kind `question`, and no checks SHALL run.
11. WHEN a run ends THE system SHALL POST one line to `/say`, built only from the job name, the state, the needs-you kind, and a failed check's name.
12. WHEN `aleph job <repo> <name> <spec-file>` runs AND the name has an open job THE system SHALL start a new run in the same worktree. Its prompt SHALL hold the new spec and the previous run's `result.md`. IF a run of that name is live, or a land of it runs, THEN it SHALL exit 1.
13. WHEN `aleph land <name>` runs on a `passed` job, or on a `needs-you` `manual` job with `--checked`, THE system SHALL start a land run. It SHALL abort any rebase in progress, fetch, rebase onto `origin/<main>`, run the checks, and push one commit built with `git commit-tree` to `<main>`. It SHALL then write `landed` with the hash, fast-forward the main checkout if it has no tracked changes and is on `<main>`, and remove the worktree with `--force` and the branch with `-D`.
14. IF the rebase conflicts, a check fails, or the push is refused THEN the land run SHALL abort the rebase, leave the remote unchanged, and end `failed` with the reason. IF the branch's tree equals `origin/<main>`'s tree THEN the land SHALL end `done` with "no net change".
15. WHEN `aleph drop <name> <reason>` runs THE system SHALL stop a live unit of that name, remove the worktree with `--force` and the branch with `-D`, and write `dropped` with the reason. IF no reason is given THEN it SHALL exit 1.
16. WHEN `aleph jobs` runs THE system SHALL print JSON for each open job: name, repo, state, needs-you kind, age, and live or lost. `aleph jobs <name>` SHALL also print the latest run's `result.md` and question.
17. WHEN a run starts THE run's `state.json` SHALL hold the session id before the worker starts.
18. WHILE a run's unit runs setup, the worker or the checks, Sidetone's working sign SHALL be on.
19. WHEN `aleph run <name> -- <command>` runs THE system SHALL start the command in the current directory in a unit, and POST "<name> finished." or "<name> failed." at the end.
20. WHEN milestone 3 lands, `scripts/job` SHALL be absent from Sidetone, AND Sidetone's `CLAUDE.md` SHALL name `aleph job` and `aleph run`.

## Implementation Decisions

**Fixed.** Workers are local `claude -p` on the subscription. Runs are
transient systemd user units. aleph's git rules hold. Sidetone's `/say` holds
news until a turn ends. The verify gate keeps running inside workers.

**The CLI.** `jobs/cli.ts`, beside `vault/cli.ts`, with its conventions: JSON
on stdout, findings on stderr, exit 1 on refusal. Commands: `job`, `run`,
`land`, `drop`, `jobs`, and `unit` (the unit's entry point, internal).

**The ledger.** One folder per run: `~/.aleph/jobs/<MMDD-HHMMSS>-<name>/`. A
job is the runs that share a name and a repo. Its state is the state of its
latest run. Each folder holds `command.txt`, `pid`, `exit`, `output.log`
(stream-json), `result.md` (the worker's last message), and `state.json`.

A run is live when `pid` exists, `exit` does not, and the pid's command line
names the run folder. That is Sidetone's rule (spec 14.10.4), so Sidetone's
`jobsRunning(dir)` reads this ledger unchanged. The unit writes `exit` last,
after setup, the worker, the checks and `state.json`. So a run is live for its
whole length. A folder with `pid`, no `exit`, and a dead process is "lost".
`aleph jobs` reports that and writes nothing.

Each `state.json` has one writer at a time: the unit while it runs, then
`land` or `drop` under the job's lock. It is written to a temporary name and
renamed.

```ts
type State = "running" | "passed" | "needs-you" | "failed" | "done" | "landed" | "dropped";

interface Run {
  kind: "agent" | "plain" | "land";
  name: string; repo?: string; branch?: string; worktree?: string; base?: string;
  state: State; needs?: "manual" | "question";
  reason?: string; question?: string; say?: string;   // say: the manual check's sentence
  session?: string; model?: string; commit?: string;
  started: string; ended?: string;
}
```

**The unit.** `systemd-run --user --collect --unit=aleph-<run-id>` runs
`jobs/cli.ts unit <run-folder>`, which is live from start to end:

1. Write `pid`.
2. Setup, on the first run of a job only.
3. The worker, under `timeout --kill-after=30 $ALEPH_JOB_TIMEOUT`. `timeout` signals its whole process group.
4. The checks, each under `timeout --kill-after=30 $ALEPH_CHECK_TIMEOUT`.
5. Write `state.json`, POST the line, write `exit`.

The unit loads the repo's `env` file from the registry, then sets `PATH` to
the dispatcher's `PATH`, because an env file can hold its own `PATH`. It sets
`HOME` and the `ALEPH_JOB_*` variables, and unsets `ANTHROPIC_API_KEY`. When
the unit ends, systemd stops what is left in its cgroup, such as a dev server.
`ALEPH_JOB_FOREGROUND=1` runs the unit command in the foreground for tests.

**The worker.** `claude -p` with `CLAUDECODE` unset, a new `--session-id` for
each run, `--output-format stream-json --verbose`,
`--tools Read,Write,Edit,Bash,Grep,Glob,Skill`,
`--permission-mode bypassPermissions`, and `--model` when the lead gives one.
28 of 61 past agent jobs ran in bypass mode. The prompt is fixed text in aleph,
then `spec.md`, then the previous run's `result.md` if one exists. The fixed
text says: work in this worktree, commit all your changes on the branch, never
merge or push, and end with a `QUESTION:` line when a decision is needed.
`ALEPH_WORKER_CMD` replaces `claude` in tests.

**No push from a worker.** The unit sets `GIT_CONFIG_COUNT`,
`GIT_CONFIG_KEY_0=url.aleph-no-push:.pushInsteadOf` and
`GIT_CONFIG_VALUE_0=git@github.com:` for the worker only. A worker's push then
goes to an address that does not exist. All three remotes use
`git@github.com:`. The land run does not set these variables. Hooks do not
change, except that `userGrantedSkip` returns false when `ALEPH_JOB_ID` is
set. A worker can still move local refs, for example with `git update-ref`.
Land builds from `origin/<main>`, so a moved local main never reaches the
remote, and step 6 reports it.

**The registry.** `~/.aleph/repos.json`, or `$ALEPH_REPOS`. `path` and
`checks` are required.

```json
{
  "sidetone": {
    "path": "~/sidetone",
    "env": "~/.sidetone/env",
    "setup": ["bun install", "cp ~/sidetone/android/local.properties android/"],
    "checks": [
      { "name": "tests", "run": "bun test" },
      { "name": "types", "run": "bunx tsc --noEmit -p ." },
      { "name": "android tests", "run": "cd android && ./gradlew testDebugUnitTest", "when": ["android/**"] },
      { "name": "android build", "run": "cd android && ./gradlew assembleDebug", "when": ["android/**"] }
    ],
    "manual": [{ "when": ["android/**"], "say": "run it on the phone" }]
  },
  "aleph": { "path": "~/aleph", "quiet": true, "checks": [{ "name": "tests", "run": "bun test" }, { "name": "types", "run": "bunx tsc" }] }
}
```

The Sidetone checks are the ones its lead already writes into every worker
prompt. `main` defaults to `main`. `quiet: true` marks aleph: its hooks run in
every worker, so a land of aleph waits until no agent run is live.

**Locks.** A lock is an atomic `mkdir` that holds the owner's pid. A lock whose
pid is dead is stale and is removed. `~/.aleph/jobs/.dispatch` covers the cap
count and the creation of a run folder. `~/.aleph/jobs/.job-<repo>-<name>`
covers a new run, a land and a drop of one job.

**Land.** A land is a run of kind `land`, started by `aleph land`, so a
barge-in or a tool time limit cannot cut it. Under the job's lock:

1. If a rebase is in progress in the worktree, `git rebase --abort`.
2. `git fetch`, then rebase `job/<name>` onto `origin/<main>`. On a conflict, abort and end `failed`.
3. If the branch's tree equals `origin/<main>`'s tree, end `done`, "no net change".
4. Run the checks.
5. `git commit-tree`: the branch's tree, `origin/<main>` as parent, and the subject of the branch's first commit.
6. `git push origin <commit>:<main>`. The remote refuses anything that is not a fast-forward.
7. Write `landed` with the hash. This happens at once after the push.
8. If the main checkout has no tracked changes and is on `<main>`, `git merge --ff-only`. If not, or if it fails, add "main checkout not updated" to the line.
9. `git worktree remove --force`, then `git branch -D`.

Cloud Chamber's `post-merge` hook reloads it on step 8. When its main checkout
has tracked changes, as it does now, step 8 is skipped and so is the reload.
The line says so. Sidetone does not restart after a land. The line says
"landed; restart Sidetone to load it", and Chris decides when.

**The spoken line.**

| State | Line |
| --- | --- |
| `passed` | "Job <name> passed." |
| `needs-you`, manual | "Job <name> needs you to <say>." |
| `needs-you`, question | "Job <name> has a question." |
| `failed` | "Job <name> failed: <check name or reason>." |
| `done` | "Job <name> finished with no change." |
| `landed` | "Job <name> landed." plus the notes of land step 8 |

The `say` sentence comes from the registry. A worker's question is never
spoken by aleph. The lead reads it with `aleph jobs <name>` and speaks it under
its own rule against reading secrets aloud. aleph POSTs to
`$SIDETONE_SAY_URL`, default `https://127.0.0.1:3100/say`, and skips the
certificate check for that loopback address only, as `scripts/job` does. A
failed POST is ignored, and `aleph jobs` repeats the state.

**Rejected, with reasons.**

| Alternative | Reason |
| --- | --- |
| `claude --bg` as the launcher | measured: the daemon dies with the unit that started it |
| The verify gate as the verdict | it judges honesty, not correctness; `e0dd6d1` would pass |
| A Bash deny list in hooks | regex rules miss `bash -c`, `git -c`, `update-ref`; they block normal commands; they cost a `bun` start on every Bash call |
| Deny writes outside the worktree | real workers write scratch summaries and the vault |
| `--resume` of the worker's session | no past follow-up used it; the branch and `result.md` carry the work |
| Speak the worker's question | free text can hold a secret; the lead already filters speech |
| Automatic fix runs, the overlap warning, `--review`, the status line, the 24-hour reminder, aliases, `CONTEXT.md` | no observed event asks for them |
| Resumable land steps | a land before the push changes nothing; `landed` is written right after the push |
| Automatic Sidetone restart | a restart cuts the conversation that hears the news |

## Testing Decisions

A good test starts `jobs/cli.ts` as a process and checks files, exit codes,
git state and the recorded POSTs. It does not import internal functions.

| Seam | Covers | How | Prior art |
| --- | --- | --- | --- |
| `jobs/cli.ts` as a process | 1–4, 6, 8–17, 19 | `ALEPH_JOBS_DIR`, `ALEPH_REPOS`, `ALEPH_JOB_FOREGROUND=1`, short timeouts, `ALEPH_WORKER_CMD` set to a fake worker that commits, leaves changes, sleeps, or prints `QUESTION:`; a bare repo as the remote; a small listener for `/say` | `vault/cli.test.ts` |
| the push block | 7 | a fake worker that runs `git push` against a `git@github.com:` URL and must fail before any network call | none |
| `userGrantedSkip` | 7 | a digest test with `ALEPH_JOB_ID` set | `hooks/hooks.test.ts` |
| Sidetone `jobsRunning(dir)` | 18 | the existing test, on a run folder in the new format | Sidetone's working tests |

One live test in `tests/live`: a real `systemd-run` and a real `claude -p` on
a trivial spec in a scratch repo. It checks criteria 5 and 17 and ends
`passed`. Criterion 20 is checked by reading the Sidetone repo.

## Out of Scope

- Persistent roles, daemons, tmux, YAML teams; sessions per repo (Sidetone item 22); pull requests; cloud sessions; a jobs dashboard (Sidetone item 21).
- A sandbox against a worker that tries to get around its limits.
- Checks that take turns on the GPU or on ports. No clash is recorded yet.
- Cleaning up the worktrees of failed jobs. `drop` does it, and `aleph jobs` lists them.
- A job tag in Langfuse. The session id links the trace.

## Open Questions

None.

## Further Notes

| # | Repo | Content | Done when | My time |
| --- | --- | --- | --- | --- |
| 1 | aleph | registry; `job`, `run`, `jobs`, `drop`, `unit`; locks; push block; skip fix; live test | CLI tests pass; the live test ends `passed` | ~3 h |
| 2 | aleph | `land` as a run | CLI tests for land, conflict, refused push, no net change and a dirty main checkout pass; a real Cloud Chamber job lands | ~1.5 h |
| 3 | sidetone | `JOBS_DIR` is `~/.aleph/jobs`; `CLAUDE.md`; spec 14.10.4; remove `scripts/job` | Sidetone tests pass; a spoken job goes to "land it" from the phone | ~30 min |
