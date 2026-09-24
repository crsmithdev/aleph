# Agent jobs

Written 2026-09-24 from a grill in the same session. The decisions are in the
vault note `Aleph Owns Jobs And Sidetone Watches The Ledger`. The evidence is
in `Sidetone Job Floor 2026-09-24`. Not built.

**Red-teamed the same day.** [`2026-09-24-agent-jobs-red-team.md`](2026-09-24-agent-jobs-red-team.md)
replaces the state table, launcher, land, verdict and news sections. Read
it first.

## Problem Statement

Chris drives development through one agent, more and more by voice through
Sidetone. That agent already starts detached workers with Sidetone's
`scripts/job`: 63 finished jobs from 21 to 24 September, 61 with exit 0,
median 4.1 minutes, up to 5 at once.

The runner has four limits:

| Limit | Effect |
| --- | --- |
| It lives in the Sidetone repo | A typed session in another repo cannot use it. Chris expects most work to move to other repos as Sidetone matures. |
| The end of a job says only "Job X finished." | Chris cannot tell a verified change from an unverified one. He lands by trust. |
| Landing is free-form | The lead agent lands with git by hand, or starts a `land-*` job. Each run is different, and the lead spends voice turns on git. |
| A job has no end state | A job that Chris never lands or drops stays as a worktree and a branch with no recorded reason. |

Outside evidence says that review, not generation, sets the throughput. As
the queue grows, reviewers approve more and check less (arXiv 2606.22721).
Same-agent concurrent PRs conflict 19.8% of the time (arXiv 2607.04697).

## Solution

aleph owns agent jobs in every repo. The lead session writes a spec, and
`aleph job` starts a fresh `claude -p` worker in a new worktree of the named
repo. The worker ends with a report. The verify gate judges the worker's last
turn and writes its outcome to the job folder. Together these give the job a
verdict.

Chris says "land <name>". `aleph land` merges only a job whose verdict
passes, runs the repo's tests, pushes, and cleans up. On a conflict or a
failed test, it starts a `land-fix` job. `aleph drop` ends a job with a
reason.

Sidetone does not start jobs. It watches the ledger, speaks each new verdict
at the next turn boundary, and reads out a blocked worker's question. In a
typed session, the status line shows the job counts.

## User Stories

1. As Chris, I want to say "start a job in cloud chamber to …" to Sidetone, so that work starts in another repo without a typed session.
2. As Chris, I want a typed session in any repo to dispatch a job, so that the runner is not tied to the voice bridge.
3. As Chris, I want a scheduled routine to dispatch a job, so that a scheduled task can use the same runner.
4. As the lead agent, I want to name a repo by its spoken name or its key, so that a spoken request resolves to one path.
5. As Chris, I want an unknown repo name refused, so that a misheard word never starts work in the wrong place.
6. As the lead agent, I want to write a spec with Goal, Files, Done when and Checks, so that every worker gets the same form.
7. As the lead agent, I want each job in its own new worktree and branch, so that jobs cannot edit one another's files.
8. As Chris, I want at most 4 jobs to run at one time across all repos, so that the subscription is not exhausted.
9. As Chris, I want a warning when a new job's files overlap a running job's files in the same repo, so that I hear about a likely conflict before it happens.
10. As Chris, I want a job to continue past an overlap warning, so that the warning does not block work that I accept.
11. As the lead agent, I want to choose a model for one job, so that mechanical work can run on a cheaper model.
12. As Chris, I want a worker to inherit my default model when no model is given, so that the proven default applies.
13. As Chris, I want a job to keep running when the session that started it ends or the bridge restarts, so that an interrupted turn does not kill work.
14. As Chris, I want a job killed after 40 minutes, so that a stuck worker does not use quota for hours.
15. As a worker, I want to stop with a question when I need a decision, so that I do not guess at Chris's intent.
16. As Chris, I want to hear a blocked worker's question, so that I can answer it by voice.
17. As a worker, I want to end with a report block of the checks I ran, their output and the files I touched, so that the verdict has evidence.
18. As Chris, I want the verify gate's outcome on the worker's last turn in the job folder, so that the verdict does not trust the worker's own word.
19. As Chris, I want a forced pass spoken as "forced", never as "verified", so that I know when the gate gave up.
20. As Chris, I want a research job that changes no file to end as "no change", so that it does not look like a failure.
21. As the lead agent, I want to ask for a code-review job after a worker, so that a risky change gets a second check.
22. As Chris, I want to hear each verdict once, at the next turn boundary, so that news never interrupts an answer and never repeats.
23. As Chris, I want to hear the verdicts that ended while the bridge was down, so that no news is lost.
24. As Chris, I want the phone's working sign to count aleph jobs, so that the app still shows work with no turn behind it.
25. As Chris, I want the status line in a typed session to show running, verified and blocked counts, so that I see the state of the jobs without asking.
26. As the lead agent, I want to list jobs with their state, repo and verdict line, so that I can answer "what is running?"
27. As Chris, I want to say "land <name>", so that a verified job reaches the repo's main branch by voice.
28. As Chris, I want land refused for a job whose verdict did not pass, so that an unverified change never reaches main by accident.
29. As Chris, I want land to rebase onto main and run the repo's tests before it merges, so that main stays green.
30. As Chris, I want land to squash-merge, push, and remove the worktree and branch, so that it follows aleph's git rules.
31. As Chris, I want a failed land to start a `land-fix` job that returns with its own verdict, so that a conflict needs no git work from me.
32. As Chris, I want to drop a job with a reason, so that every job ends with a recorded state.
33. As Chris, I want to hear once about jobs that have waited 24 hours, so that forgotten work comes back to me.
34. As Chris, I want job folders kept after land or drop, so that the ledger stays a record I can measure.
35. As a worker, I want to be unable to dispatch a job, so that jobs never start jobs and the cap holds.
36. As a worker, I want the aleph skills available, so that I can use `tdd` and `diagnosing-bugs`.
37. As Chris, I want each job's Langfuse trace linked from its folder, so that I can see what the worker did.
38. As Chris, I want `scripts/job` to keep working until the bridge reads the new ledger, so that Sidetone work does not stop during the change.
39. As Chris, I want `scripts/job` removed and Sidetone's instructions pointed at `aleph job` at the end, so that one runner remains.

## Acceptance Criteria

Numbers match the user stories.

1. WHEN Chris asks Sidetone for a job in "cloud chamber" THE lead SHALL run `aleph job` with repo `cloudchamber`, AND a folder SHALL appear in the ledger whose worktree is under `~/cloudchamber/.worktrees/`.
2. WHEN `aleph job` runs from a typed session whose working directory is any repo THE system SHALL create the job in the repo named by the arguments, not in the working directory.
3. WHEN `aleph job` runs with no Claude Code session (plain shell, `CLAUDECODE` unset) THE system SHALL create and start the job.
4. WHEN the repo argument matches a key or an alias in the registry, compared case-insensitively and with spaces removed, THE system SHALL resolve it to that entry's path.
5. IF the repo argument matches no key or alias THEN THE system SHALL exit 1, create no folder, and print the known keys.
6. IF the spec lacks any of Goal, Files or Done when THEN THE system SHALL exit 1 and name the missing section. Checks is optional.
7. WHEN a job starts THE system SHALL create the branch `job/<name>` and the worktree `<repo>/.worktrees/<name>` from the repo's main branch, AND the worker's working directory SHALL be that worktree.
8. IF 4 jobs are in state `running` THEN `aleph job` SHALL exit 1 with the names of the running jobs, and create no folder.
9. WHEN a new job's Files share a path or a path prefix with the Files of a running job in the same repo THE system SHALL print a warning that names both jobs and the shared paths.
10. WHEN the overlap warning prints THE system SHALL still start the job, and exit 0.
11. WHEN `--model <m>` is given THE worker command SHALL include `--model <m>`.
12. WHEN `--model` is not given THE worker command SHALL include no `--model` flag.
13. WHEN the dispatching process exits, or `sidetone.service` restarts, THE running worker SHALL continue, AND its folder SHALL get an `exit` file when it ends.
14. WHEN a worker runs for 40 minutes THE system SHALL stop it, AND the job state SHALL be `timed-out`.
15. WHEN a worker's report has a non-empty Question field THE job state SHALL be `blocked`, AND the state file SHALL hold the question.
16. WHEN a job becomes `blocked` THE bridge SHALL say the job name and the question at the next turn boundary.
17. WHEN a worker ends THE job folder SHALL hold `report.md`, taken from the worker's last message, with Checks run, Output seen, Files touched and Question. IF the last message has no report block THEN the state SHALL be `unverified` with the reason "no report".
18. WHEN the verify gate runs on a Stop event with `ALEPH_JOB_DIR` set THE gate SHALL write `gate.json` to that folder with `verdict`, `kind` and `reason`, for every kind, `unchanged` included.
19. IF the gate kind is `forced` THEN the job state SHALL be `forced`, AND the spoken line SHALL contain the word "forced" and not the word "verified".
20. IF the gate kind is `unchanged` AND the worker exit is 0 THEN the job state SHALL be `no-change`.
21. WHEN `aleph job --review` runs AND the worker's state is `verified` THE system SHALL start a review job on the worker's branch, AND the first job's state SHALL change to `verified` or `review-failed` only after the review ends.
22. WHILE a turn runs THE bridge SHALL hold job news. WHEN the turn ends THE bridge SHALL say each unheard verdict once and write a `heard` file in its folder.
23. WHEN the bridge starts THE bridge SHALL say, at the first turn boundary, every verdict that has no `heard` file and ended in the last 24 hours.
24. WHILE an aleph job is in state `running` THE app's working sign SHALL be on.
25. WHEN `aleph jobs --summary` runs THE system SHALL print one line of the form `jobs 2▶ 1✓ 1?` for running, verdict-passed and blocked counts, and print nothing when all three are zero.
26. WHEN `aleph jobs` runs THE system SHALL print JSON with one entry per job that is not landed or dropped: name, repo, state, age, and the verdict line.
27. WHEN Chris says "land <name>" THE lead SHALL run `aleph land <name>`, AND the bridge SHALL speak the outcome line.
28. IF the job state is not `verified` or `no-change` THEN `aleph land` SHALL exit 1 and leave the repo unchanged.
29. WHEN `aleph land` runs THE system SHALL rebase the branch onto main and run the registry's test command in the worktree, before it merges.
30. WHEN the rebase and the tests pass THE system SHALL squash-merge to main in the main checkout, push, remove the worktree and the branch, and set the state to `landed` with the merge commit hash.
31. IF the rebase conflicts or the tests fail THEN THE system SHALL leave main unchanged, start a job named `land-fix-<name>` on the same branch, and set the first job's state to `landing`. WHEN the land-fix job ends `verified` THE first job SHALL return to `verified`, ready for a new land.
32. WHEN `aleph drop <name> <reason>` runs THE system SHALL remove the worktree and the branch, and set the state to `dropped` with the reason. IF no reason is given THEN it SHALL exit 1.
33. WHEN a job has had a passing verdict for 24 hours with no land or drop THE bridge SHALL name it once in a "waiting" line at the next conversation start, AND write a `reminded` file.
34. WHEN a job is landed or dropped THE folder SHALL remain.
35. IF `ALEPH_JOB_ID` is set THEN `aleph job` SHALL exit 1 with "a worker cannot start a job".
36. THE worker command SHALL allow the tools Read, Write, Edit, Bash, Grep, Glob and Skill, and no other.
37. WHEN a worker starts THE folder's state file SHALL record the Claude Code session id, from which the Langfuse trace link follows.
38. WHILE milestones 1 to 3 are not landed, `scripts/job` in Sidetone SHALL run unchanged.
39. WHEN milestone 4 lands, `scripts/job` SHALL be absent from Sidetone, AND Sidetone's `CLAUDE.md` SHALL name `aleph job` as the way to run long work.

## Implementation Decisions

**The CLI.** A new entry, `jobs/cli.ts`, beside `vault/cli.ts`, with the same
conventions: JSON on stdout, findings on stderr, exit 1 on refusal. The
lead runs it with bun. Commands: `job`, `land`, `drop`, `jobs` (list, and
`--summary` for the status line). A small `aleph` wrapper on the PATH is
optional and not part of this spec.

**The ledger.** `~/.aleph/jobs/<id>/`, with `<id>` = `MMDD-HHMMSS-<name>`,
the format that `scripts/job` uses. The folder format is the contract with
Sidetone:

| File | Written by | Content |
| --- | --- | --- |
| `spec.md` | `aleph job` | Goal, Files, Done when, Checks |
| `command.txt` | `aleph job` | the worker command |
| `pid` | launcher | the process id, while it runs |
| `exit` | launcher | the exit status |
| `output.log` | launcher | the worker's output |
| `report.md` | `aleph job`, after exit | the report block from the worker's last message |
| `gate.json` | verify gate | `{verdict, kind, reason}` |
| `state.json` | `aleph` only | the state record below |
| `heard`, `reminded` | bridge | empty marker files |

```ts
type JobState =
  | "running" | "verified" | "unverified" | "forced" | "no-change"
  | "blocked" | "timed-out" | "failed" | "review-failed"
  | "landing" | "landed" | "dropped";

interface StateRecord {
  name: string; repo: string; branch: string; worktree: string;
  state: JobState; line: string;          // the sentence the bridge speaks
  question?: string; reason?: string;     // blocked, dropped
  model?: string; review?: boolean; session?: string; merged?: string;
  started: string; ended?: string;        // ISO times
}
```

The state after a worker ends comes from the exit, `gate.json` and `report.md`:

| Exit | gate kind | report | State |
| --- | --- | --- | --- |
| killed at 40 min | any | any | `timed-out` |
| non-zero | any | any | `failed` |
| 0 | any | Question set | `blocked` |
| 0 | `judged` pass or `skip` | present | `verified` |
| 0 | `forced` | present | `forced` |
| 0 | `judged` deny | any | `unverified` |
| 0 | `unchanged` | present | `no-change` |
| 0 | `fail-open` or no `gate.json` | any | `unverified` |
| 0 | any | absent | `unverified` ("no report") |

A `blocked` job is resumed by a new job on the same branch that carries
Chris's answer. That keeps the one-worker-one-run model.

**The launcher.** `systemd-run --user --collect` with a unit name
`aleph-job-<id>`, the same approach as `scripts/job`, for the same reason: a
`setsid` process dies with its parent's cgroup. The unit sets
`RuntimeMaxSec=2400` for the 40-minute limit. After the worker exits, the
unit runs `jobs/cli.ts finish <id>`. That command reads the exit status,
`gate.json` and the last message, and writes `report.md` and `state.json`.
`ALEPH_JOB_FOREGROUND=1` runs the same steps in the foreground, with no
systemd, for tests.

**The worker.** `claude -p` with `CLAUDECODE` unset, the tool list of
criterion 36, `--output-format json` so that `finish` can read the last
message and the session id, and a prompt that the aleph wrapper builds from
`spec.md`: the job's rules, the spec, and the required report block.
`ALEPH_JOB_ID` and `ALEPH_JOB_DIR` are set in the worker's environment.
`ALEPH_WORKER_CMD` replaces `claude` in tests, the same way `ALEPH_JUDGE_CMD`
does for the judge.

**The verify gate.** One change: when `ALEPH_JOB_DIR` is set, write
`gate.json` on every Stop outcome, `unchanged` included. Nothing else in the
gate changes. Measured in this session: the gate judged every worker turn
that edited or committed. The 30 traces without a record changed nothing in
the repo.

**The registry.** `~/.aleph/repos.json`, or `$ALEPH_REPOS`:

```json
{ "cloudchamber": { "path": "~/cloudchamber", "test": "bun test", "aliases": ["cloud chamber"], "main": "main" } }
```

`test` defaults to `bun test`. `main` defaults to `main`.

**Concurrency.** The cap is 4 jobs in state `running`, counted across the
whole ledger. A running job is one whose `pid` process is alive and has the
job folder in its command line. That is the rule of Sidetone spec 14.10.4.
The overlap check compares the Files lists of running jobs in the same repo.
It warns and does not block.

**Land.** Run in the repo's main checkout: rebase the job branch onto main in
the worktree, run the test command in the worktree, `git merge --squash`,
commit with the subject of the branch's first commit, push, remove the worktree, and
delete the branch. `land-fix-<name>` works on the same branch and worktree.
It does not count against the name check, but it does count against the cap.

**Sidetone.** A ledger reader beside `working.ts`. It gives the running count
for the working sign, the unheard verdict lines, and the waiting line.
`Bridge.announce` speaks the lines, as `/say` does now. `JOBS_DIR` becomes
`~/.aleph/jobs`, and the reader also counts `~/.sidetone/jobs` until
milestone 4. Spec 14.10.4 changes to describe the aleph ledger.

**The status line.** A ccstatusline custom command runs
`jobs/cli.ts jobs --summary`.

**Rejected alternatives.** The grill rejected these:

| Alternative | Reason |
| --- | --- |
| Keep the runner in Sidetone and add `--repo` | per-repo git policy would live in the voice bridge |
| aleph POSTs news to Sidetone | a verdict sent while the bridge is down is lost; the folder already is the contract |
| Auto-land on a verified verdict | main would move with no word from Chris; habituation research |
| A code-review job on every worker | about 2× cost for 4-minute jobs; opt-in with `--review` |
| Persistent roles, a daemon, tmux | fresh workers with aleph skills do the same job |
| Locks before each write | they serialize the work (arXiv 2608.00947) |
| Workers that dispatch jobs | break the cap and the overlap check |
| A spec file in each repo | spoken names need a central list anyway |

## Testing Decisions

A good test starts the CLI as a process against a temporary ledger, a
temporary registry and temporary git repos, and checks the files and the
exit codes. It does not import internal functions.

| Seam | Covers | How | Prior art |
| --- | --- | --- | --- |
| `jobs/cli.ts` as a process | criteria 2–12, 14–15, 17, 19–21, 25–26, 28–35 | `ALEPH_JOBS_DIR`, `ALEPH_REPOS`, `ALEPH_JOB_FOREGROUND=1`, and `ALEPH_WORKER_CMD` pointing at a fake worker script that edits, commits, prints a chosen last message and writes a chosen `gate.json`. A bare repo is the push remote. | `vault/cli.test.ts` |
| the verify gate Stop hook | criterion 18 | the existing test, plus `ALEPH_JOB_DIR` and a check for `gate.json` for each outcome kind | `hooks/verify-gate.test.ts` |
| Sidetone's ledger reader | criteria 22–24, 33 | a temporary folder of job folders; checks the count, the unheard lines, and the `heard` and `reminded` files | the `jobsRunning(dir)` tests |

One live test in `tests/live`, gated like the others. It covers criteria
1, 13, 36 and 37: a real `systemd-run` and a real `claude -p` on a trivial
spec in a scratch repo, which ends `verified` with a session id. Criteria 16
and 27 are checked by a spoken run from the phone at the end of milestone 3.
Criteria 38 and 39 are checked by reading the Sidetone repo at each
milestone.

## Out of Scope

- Persistent agent roles, a daemon, tmux panes, YAML team files.
- Sessions per repo reached with `SendMessage` (Sidetone todo item 22). That covers conversation, not dispatch.
- Pushing a branch or opening a pull request for a job.
- Cloud sessions or routines as workers.
- A dashboard of jobs. Sidetone todo item 21 can read the ledger later.
- Moving the old `~/.sidetone/jobs` folders into the new ledger.
- An `aleph` binary on the PATH.
- Republishing the Sidetone Job Floor infographic.

## Open Questions

- **The spoken form of a land-fix.** It is not decided whether a `land-fix` verdict is spoken on its own or folded into the original job's line. The first real conflict in milestone 2 settles it.
- **The waiting-line limit.** 24 hours is a guess. The ledger's data after two weeks of use settles it.

## Further Notes

Milestones, each landed separately:

| # | Repo | Content | Done when | My time |
| --- | --- | --- | --- | --- |
| 1 | aleph | CLI `job`, `finish`, `jobs`; registry; launcher; worker prompt; the gate's `gate.json` | the CLI seam and gate tests pass; the live test ends `verified` | ~1.5 h |
| 2 | aleph | `land`, `drop`, `land-fix` | CLI tests for land, conflict and drop pass; a real Cloud Chamber job lands and is pushed | ~1 h |
| 3 | sidetone, aleph | ledger reader, spoken verdicts, working sign, status line | reader tests pass; a spoken job from the phone goes through to "land it" | ~1 h |
| 4 | sidetone | remove `scripts/job`; update `CLAUDE.md` and spec 14.10.4 | criterion 39 | ~15 min |
