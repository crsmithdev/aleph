# Agent jobs

Written 2026-09-24. Version 4, after three red teams. The findings and the
evidence of all three rounds are in
[`2026-09-24-agent-jobs-red-team.md`](2026-09-24-agent-jobs-red-team.md).
Version 1 is `3d1ffa8` and version 3 is `b426a74` in git. Not built.

## Problem Statement

Chris drives development through one agent, the **lead**, more and more by
voice through Sidetone. The lead starts detached work with Sidetone's
`scripts/job`: about 74 agent runs and 21 plain commands from 21 to 24
September, all in Sidetone, up to 5 at once, with a median of 4 minutes.

| Problem | Evidence |
| --- | --- |
| A job's change reached main when its tests passed but the change was wrong | `e0dd6d1` reverts `2eddeb1`. Job `app-queue` merged it after unit tests passed. Its log says "Nothing has run on a device." |
| Workers land their own changes when a prompt tells them to | 7 jobs merged to main; in 5, the lead's prompt asked for it |
| Every land is done a different way | by hand, by a `land-*` job, or by the worker |
| The lead does not hear that a job ended | `scripts/job` POSTs "Job X finished." to `/say`, which goes to Chris's ear and the phone, not to the lead's conversation |
| Work is expected to move to other repos | Chris's forecast; 0 jobs so far outside Sidetone |

The threat is a worker that follows a wrong instruction or makes a mistake,
not a worker that tries to get around its limits. The limits below are guards,
not a sandbox.

## Solution

1. The lead runs `aleph job <repo> <name> --spec <file>`. aleph creates a worktree and starts a systemd unit. The unit runs setup, a fresh `claude -p` worker, and the repo's checks, then writes the state.
2. A worker's `git push` and `gh` calls fail, because its environment points them at nothing.
3. The checks' exit codes, on a fully clean worktree, decide the state. A change to a path with a manual check, such as `android/**`, waits for Chris.
4. aleph POSTs the news to Sidetone's new `/tell` route. When the conversation is idle, the bridge gives the news to the lead as a message. The lead reads the job's result or question and tells Chris, under its own speech rules.
5. Chris says "land <name>". `aleph land` starts a land run: rebase, checks, one squash commit pushed as a fast-forward.
6. A follow-up is `aleph job` again with the same name: a new run in the same worktree. It sees the original spec, every note since, and the previous result.
7. `aleph run <name> -- <command>` replaces `scripts/job` for plain commands.

## User Stories

1. As Chris, I want to start an agent job in any registered repo, by voice or typed, so that the runner does not depend on one repo.
2. As Chris, I want an unknown repo refused, so that a misheard word never starts work in the wrong place.
3. As the lead, I want each worktree ready to test before the worker starts, so that the worker does not spend its run on setup.
4. As Chris, I want at most 5 agent runs at one time, so that the subscription holds.
5. As Chris, I want a run to survive the end of the session that started it and a restart of Sidetone, so that an interrupted turn does not kill work.
6. As Chris, I want a stuck worker or check stopped, so that nothing uses quota or ports for hours.
7. As Chris, I want a worker unable to push or merge through git or `gh`, so that only a land moves the remote main.
8. As Chris, I want the state decided by the checks on exactly the files that will land, so that "passed" means the code that lands passed.
9. As Chris, I want a change to a path with a manual check to wait for me, so that an untested Android change cannot land on unit tests alone.
10. As a worker, I want to stop with a question, so that I do not guess at Chris's intent.
11. As Chris, I want the lead to tell me when a run ends, with what it found and what I can do next, so that I can act without asking.
12. As Chris, I want to hear news that arrived while Sidetone was down, so that nothing is lost.
13. As Chris, I want a follow-up to see the whole task so far, so that an answer given later reaches a worker that knows the job.
14. As Chris, I want "land <name>" to push a passed job after a rebase and the checks, so that main stays green.
15. As Chris, I want a land that fails to change nothing on the remote, tell me why, and leave the job landable once fixed, so that a race with the remote costs one retry.
16. As Chris, I want to drop a job, so that every job ends with a recorded state.
17. As the lead, I want to list open jobs with their goal, phase and state, so that I can answer "what is going on?".
18. As Chris, I want each run's Langfuse session known from the start, so that I can see what a worker did, even when it was killed.
19. As Chris, I want the phone's working sign on for the whole run, so that the app shows work with no turn behind it.
20. As the lead, I want to run a plain command detached, so that builds survive a barge-in.
21. As Chris, I want a job started twice by mistake refused, so that a false "rejected" after a barge-in does not duplicate work.
22. As Chris, I want `scripts/job` removed and the lead told exactly how to use jobs, so that one runner remains and the voice flow works.

## Acceptance Criteria

Numbers match the user stories.

1. WHEN `aleph job <repo> <name> --spec <file|->` runs from any directory THE system SHALL create a run folder in `~/.aleph/jobs/` and start unit `aleph-<run-id>`, and print the run id.
2. IF `<repo>`, lowercased with spaces removed, matches no registry key THEN THE system SHALL exit 1, create nothing, and print the keys. IF `<name>` is open in another repo THEN it SHALL exit 1 and name that repo.
3. WHEN a run starts in a worktree without the setup marker THE unit SHALL run the registry's `setup` commands before the worker, then write the marker. IF a setup command fails THEN the run SHALL end `failed` with that command's name.
4. IF 5 agent runs are live THEN `aleph job` SHALL exit 1 and name them. A run counts as live from the moment its folder exists. Plain and land runs do not count.
5. WHEN the dispatching process exits, or `sidetone.service` restarts, THE run SHALL continue and end with a state.
6. WHEN the worker runs longer than `ALEPH_JOB_TIMEOUT` seconds (default 2400), or one check longer than `ALEPH_CHECK_TIMEOUT` (default 1200), THE unit SHALL stop it and its process group, AND the run SHALL end `failed` with "timed out" and what timed out. The unit decides "timed out" from its own clock, not from an exit code.
7. WHILE a worker runs, `git push` to a `git@github.com:` remote SHALL go to the host `aleph-no-push`, AND `gh` SHALL find no credentials. WHILE `ALEPH_JOB_ID` is set, `skip verify` in the prompt SHALL NOT skip the verify gate.
8. WHEN the worker exits THE unit SHALL decide the state in this order, the first match wins: (a) non-zero exit → `failed`, "worker exited N"; (b) a `QUESTION:` line in the result → `needs-you`, kind `question`; (c) any change in `git status --porcelain`, untracked files included → `failed`, "uncommitted: <first path>"; (d) no commits past `merge-base origin/<main> HEAD` → `done`; (e) a check fails → `failed`, "<check> failed"; (f) a changed file matches a `manual` glob → `needs-you`, kind `manual`; (g) `passed`.
9. The checks SHALL run every check with no `when`, and every check whose `when` globs match a file in `git diff --name-only $(git merge-base origin/<main> HEAD) HEAD`, after a `git fetch`.
10. WHEN a run ends in `needs-you`, kind `question`, THE state SHALL hold the question line.
11. WHEN a run ends THE unit SHALL write `state.json`, then `exit`, then POST the news to `$SIDETONE_TELL_URL` with a 10 s limit, and set `told` in `state.json` on a 2xx reply.
12. WHEN `aleph jobs --news` runs THE system SHALL print every ended run with `told` false and set `told` on each.
13. WHEN `aleph job` runs with the name of an open job in the same repo THE system SHALL start a new run in that worktree. Its prompt SHALL hold the fixed text, the original `spec.md`, every `notes/*.md` in order (the new `--spec` is saved as the next note), and the previous run's `result.md`, `checks.log` and `land.log` when they exist.
14. WHEN `aleph land <name>` runs AND the latest agent run is `passed`, or `needs-you` kind `manual` with `--checked`, THE system SHALL start a land run. The land run SHALL take the job's lock, abort any rebase in progress, fetch, rebase onto `origin/<main>`, end `done` "no net change" if the tree equals `origin/<main>`'s tree, run the checks, push one `git commit-tree` commit to `<main>`, write `landed` with the hash, fast-forward the main checkout if `git status --porcelain --untracked-files=no` is empty and it is on `<main>`, and remove the worktree with `--force` and the branch with `-D`.
15. IF the rebase conflicts, a check fails, or the push is refused THEN the land run SHALL abort the rebase, leave the remote unchanged, end `failed` with the reason in `land.log`, and POST the news. Land runs SHALL NOT change which agent run decides whether the job can land.
16. WHEN `aleph drop <name> [reason]` runs AND no land run of it is live THE system SHALL stop a live agent run of it, remove the worktree and branch, and write `dropped` with the reason, or "dropped by Chris". IF a land run is live THEN it SHALL exit 1 with "landing".
17. WHEN `aleph jobs` runs THE system SHALL print JSON for each open job: name, repo, goal (the first line of `spec.md`), state, needs-you kind, phase (`setup`, `worker`, `check <name>`, `land`), started, ended, and `lost` when the run's process is gone. `aleph jobs <name>` SHALL also print the latest `result.md`, question, `checks.log` tail and `land.log`.
18. WHEN a run starts THE run's `state.json` SHALL hold the session id before the worker starts.
19. WHILE a run's unit runs, Sidetone's working sign SHALL be on.
20. WHEN `aleph run <name> -- <command>` runs THE system SHALL start the command in the current directory in a unit, and POST "<name> finished." or "<name> failed." to `/tell`.
21. IF a run of the same name and repo started less than 120 seconds ago THEN `aleph job` SHALL exit 1 with "started <n> s ago".
22. WHEN milestone 3 lands, `scripts/job` SHALL be absent from Sidetone, AND Sidetone's `CLAUDE.md` SHALL hold the block in [The lead's instructions](#the-leads-instructions).

## Implementation Decisions

**Fixed.** Workers are local `claude -p` on the subscription. Runs are
transient systemd user units. aleph's git rules hold. The verify gate keeps
running inside workers and does not decide the state.

**The executable.** `bin/aleph` in the aleph repo is `exec bun "$(dirname
"$(readlink -f "$0")")/../jobs/cli.ts" "$@"`. Milestone 1 links it into
`~/.local/bin`. `jobs/cli.ts` follows `vault/cli.ts`: JSON on stdout, findings
on stderr, exit 1 on refusal. Commands: `job`, `run`, `land`, `drop`, `jobs`,
and `unit` (internal).

**Identity.** A job is one name in one repo, from its first run until it ends
`landed`, `dropped` or `done`. Its id is the first run's folder name. A job is
**open** while its latest run is `running`, `passed`, `needs-you` or `failed`.
A name is unique among open jobs across all repos. When a job with a name has
ended, a new `aleph job` with that name starts a new job. It first removes a
leftover worktree or branch `job/<name>` with `--force` and `-D`.

**The ledger.** One folder per run:
`~/.aleph/jobs/<YYYYMMDD-HHMMSS>-<repo>-<name>-<kind>/`, with kind `agent`,
`plain` or `land`. The job's first folder also holds `spec.md` and `notes/`.

| File | Writer | Content |
| --- | --- | --- |
| `command.txt`, `pid`, `exit` | dispatcher, unit | as in `scripts/job` |
| `output.log` | unit | the worker's stream-json |
| `result.md` | unit | the `result` field of the last `result` event; if none, the last assistant text block; if none, empty |
| `checks.log` | unit | each check's name, exit code and last 100 lines |
| `land.log` | land unit | each land step and its output |
| `state.json` | unit, then `land` or `drop` under the job's lock | the record below, written to a temporary name and renamed |

```ts
type State = "running" | "passed" | "needs-you" | "failed" | "done" | "landed" | "dropped";

interface Run {
  kind: "agent" | "plain" | "land";
  job: string; name: string; repo?: string; branch?: string; worktree?: string;
  state: State; needs?: "manual" | "question"; phase?: string;
  reason?: string; question?: string; say?: string;
  session?: string; model?: string; commit?: string;
  told: boolean; started: string; ended?: string;
}
```

**Liveness.** A run is live when its folder has no `exit` file and either its
`pid` process is alive with the folder in its command line, or it has no `pid`
file and was created less than 30 seconds ago. The second case covers the
moment between dispatch and the unit's start, so the cap and the double-start
check see it. This is Sidetone's rule (spec 14.10.4) plus that window.
`aleph jobs` reports a run with no `exit`, a dead process and an age over 30
seconds as `lost`, and writes nothing.

**Locks.** A lock is an atomic `mkdir` under `~/.aleph/jobs/.locks/`. It holds
a file `owner` with the pid and the process start time from
`/proc/<pid>/stat`. It is stale when that process is gone or has another start
time. `dispatch` covers the cap count and the folder creation. `job-<repo>-<name>`
covers a new run, a land, and a drop of one job. The land unit takes the job
lock itself, not the dispatcher.

**The unit.** `systemd-run --user --collect --unit=aleph-<run-id>` runs
`aleph unit <run-folder>`:

1. Write `pid`.
2. Setup, if the worktree has no `.git/aleph-setup` marker (in the worktree's git directory, so the tree stays clean).
3. The worker, under `timeout --kill-after=30 $ALEPH_JOB_TIMEOUT`. `timeout` signals the whole process group. `phase` is `worker`.
4. The state rule of criterion 8. Each check runs under `timeout --kill-after=30 $ALEPH_CHECK_TIMEOUT`. `phase` is `check <name>`.
5. Write `state.json`, then `exit`, then POST the news.

The unit loads the repo's `env` file from the registry, then sets `PATH` to the
dispatcher's `PATH`. It sets `HOME` and the `ALEPH_JOB_*` variables, and unsets
`ANTHROPIC_API_KEY`. When the unit ends, systemd stops what is left in its
cgroup. With `ALEPH_JOB_FOREGROUND=1`, the dispatcher starts `aleph unit
<run-folder>` as a child process and waits, in place of `systemd-run`. The
child's command line names the folder, so liveness holds in tests.

**The worker.** `claude -p` with `CLAUDECODE` unset, a new `--session-id` for
each run, `--output-format stream-json --verbose`,
`--tools Read Write Edit Bash Grep Glob Skill`,
`--permission-mode bypassPermissions`, and `--model` when given. The prompt goes
on stdin. It is the fixed text, then the parts listed in criterion 13. The
fixed text:

> You are a worker on job `<name>` in `<worktree>`, branch `job/<name>`. Work
> only there. Commit every change on the branch; the run fails if anything is
> left uncommitted or untracked. Never merge, never push, never touch another
> branch. If the previous run was a failed land, rebase onto `origin/<main>`,
> resolve the conflicts, and commit. If you need a decision from Chris, stop
> and make your last line `QUESTION: <one question>`. End with a short summary
> of what you did and what you ran.

`ALEPH_WORKER_CMD` replaces `claude` in tests.

**No push, no `gh`.** For the worker only, the unit sets `GIT_CONFIG_COUNT=1`,
`GIT_CONFIG_KEY_0=url.aleph-no-push:.pushInsteadOf`,
`GIT_CONFIG_VALUE_0=git@github.com:`, sets `GH_CONFIG_DIR` to an empty folder,
and unsets `GH_TOKEN` and `GITHUB_TOKEN`. Measured: a push then fails with exit
128, fetch still works, and `gh auth status` exits 1. All three
remotes use `git@github.com:`. A worker can undo this with `git -c` or its own
environment; that is outside the threat model. A worker can also move local
refs, but land builds from `origin/<main>` and never reads the local main.

**The registry.** `~/.aleph/repos.json`, or `$ALEPH_REPOS`. `path` and `checks`
are required.

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
    "manual": [{ "when": ["android/**"], "say": "run it on the phone" }],
    "note": "restart Sidetone to load it"
  },
  "cloudchamber": {
    "path": "~/cloudchamber",
    "setup": ["bun install", "ln -s ~/cloudchamber-corpus corpus"],
    "checks": [{ "name": "tests", "run": "bun test app" }, { "name": "types", "run": "bunx tsc --noEmit -p ." }],
    "manual": [{ "when": ["app/ui/**"], "say": "look at it in the browser" }]
  },
  "aleph": { "path": "~/aleph", "checks": [{ "name": "tests", "run": "bun test" }, { "name": "types", "run": "bunx tsc" }] }
}
```

All setup artifacts are already gitignored: `node_modules`, `corpus`,
`android/local.properties`. Globs use `Bun.Glob`. `main` defaults to `main`.
`note` is added to the news after a land.

**Land.** A run of kind `land`, in its own unit, so a barge-in cannot cut it.
The steps are those of criterion 14, with each step and its output in
`land.log`. When the main checkout has tracked changes, as Cloud Chamber's has
now, the fast-forward is skipped, so is Cloud Chamber's `post-merge` reload,
and the news says "main checkout not updated".

**News.** aleph POSTs JSON to `$SIDETONE_TELL_URL`, default
`https://127.0.0.1:3100/tell`, and skips the certificate check for that
loopback address only, as `scripts/job` does. The body:

```json
{ "job": "menu-knobs", "repo": "sidetone", "state": "passed", "needs": null, "reason": null, "note": null }
```

**Sidetone's `/tell` route.** The route takes the body above and queues it. When
no turn runs, the bridge starts a turn through the same path as a spoken
utterance. The turn's text is one line per queued item: `[job news]` followed
by the JSON. Items that arrive while a turn runs wait and go in together. The
queue lives in memory; a restart loses it, and `aleph jobs --news` recovers it
(criterion 12). The route has the same loopback guard as `/say`.

**The lead's instructions.** Milestone 3 puts this block into Sidetone's
`CLAUDE.md`, in place of today's "Long work" section:

> **Jobs.** For work longer than about fifteen seconds, write a spec (Goal,
> Files, Done when) to your scratchpad and run
> `aleph job <repo> <name> --spec <file>`. Pick a name of two plain words,
> joined by a hyphen, with no numbers, that Chris can say. For a plain
> command, run `aleph run <name> -- <command>`.
>
> A message that starts with `[job news]` is from aleph, not from Chris. For
> each item, run `aleph jobs <name>`. Say in one or two sentences what the job
> found or changed, and what Chris can do next: land it, answer a question,
> try the manual check, or drop it. For a question, read the question.
>
> To land, run `aleph land <name>`. For a job that needs a manual check, ask
> "Did you check it?" first, and add `--checked` only on a clear yes. For a
> follow-up, an answer, or "fix it", run `aleph job` with the same name and
> Chris's words as the spec. To drop, run `aleph drop <name>` with Chris's
> words as the reason. When a name Chris says does not match, list the open
> jobs and ask which one he means.
>
> At the first turn of a conversation, run `aleph jobs --news` and tell Chris
> anything it lists. If a tool call reads as rejected after a barge-in, run
> `aleph jobs` before you start a job again.

**Rejected, with reasons.**

| Alternative | Reason |
| --- | --- |
| `claude --bg` as the launcher | measured: the daemon dies with the unit that started it |
| The verify gate as the verdict | it judges honesty, not correctness; `e0dd6d1` would pass |
| A Bash deny list in hooks | regex misses `bash -c`, `git -c` and `update-ref`; it blocks normal commands |
| News straight to speech with `/say` | the lead does not learn what Chris heard; it cannot read the question or say what to do next |
| `--resume` of the worker session | the spec, the notes and the previous result carry the task |
| A stored base commit | measured: it goes stale after a rebase; `merge-base` is recomputed |
| `quiet` for aleph lands | a changed hook takes effect at its next call; no event needs the wait |
| Automatic fix runs, the overlap warning, `--review`, the status line, aliases, `CONTEXT.md`, resumable land steps, automatic Sidetone restart | no observed event asks for them |

## Testing Decisions

A good test starts `aleph` as a process and checks files, exit codes, git
state and the recorded POSTs. It does not import internal functions.

| Seam | Covers | How | Prior art |
| --- | --- | --- | --- |
| `aleph` as a process | 1–4, 6, 8–17, 20, 21 | `ALEPH_JOBS_DIR`, `ALEPH_REPOS`, `ALEPH_JOB_FOREGROUND=1`, timeouts of 1–2 s, `ALEPH_WORKER_CMD` set to a fake worker that commits, leaves an untracked file, sleeps, exits 3, or prints `QUESTION:`; a bare repo as the remote and a second clone that races it; a small HTTPS listener for `/tell` | `vault/cli.test.ts` |
| the push and `gh` block | 7 | a fake worker with `GIT_SSH_COMMAND` pointed at a script that records its host argument and exits 1: the host must be `aleph-no-push`; `gh auth status` must fail | none |
| `userGrantedSkip` | 7 | a case with `ALEPH_JOB_ID` set | `hooks/verify-gate.test.ts` |
| Sidetone `/tell` | 11 | a route test: an item while a turn runs waits; two items go in as one turn | Sidetone's route and bridge tests |
| Sidetone `jobsRunning(dir)` | 19 | a run folder whose `pid` command line is `aleph unit <folder>` | Sidetone's working tests |

One live test in `tests/live`: a real `systemd-run` and a real `claude -p` on a
trivial spec in a scratch repo, which ends `passed` with a session id
(criteria 5 and 18). Criterion 22 and the voice flow are checked by one spoken
job from the phone, from dispatch to "land it".

## Out of Scope

- Persistent roles, daemons, tmux, YAML teams; sessions per repo (Sidetone item 22); pull requests; cloud sessions; a jobs dashboard (Sidetone item 21).
- A sandbox against a worker that tries to get around its limits.
- Checks that take turns on the GPU or on ports. No clash is recorded yet.
- Installing a worktree's Android build on the phone. A manual check waits until Chris can do it.
- Cleaning up failed jobs' worktrees. `drop` does it; `aleph jobs` lists them.

## Open Questions

None.

## Further Notes

| # | Repo | Content | Done when | My time |
| --- | --- | --- | --- | --- |
| 1 | aleph | `bin/aleph`; registry; `job`, `run`, `jobs`, `drop`, `unit`; liveness, locks, push and `gh` block; skip fix; live test | process tests pass; the live test ends `passed` | ~5 h |
| 2 | aleph | `land` as a run | tests for land, conflict, a raced push, no net change, a dirty checkout, and a land after a failed land; a real Cloud Chamber job is pushed | ~2 h |
| 3 | sidetone | `/tell` route; `JOBS_DIR` is `~/.aleph/jobs`; the `CLAUDE.md` block; spec 14.10.4; remove `scripts/job` | route tests pass; one spoken job goes from dispatch to "land it" from the phone | ~1.5 h |
