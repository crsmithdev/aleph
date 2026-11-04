# Factory

The factory builds issues without you. It triages each open issue into goals, starts a sandboxed worker for each ready goal, checks and reviews the branch, and lands it on `main`. It asks you only when a rule says so.

A repo with `"sandbox": true` in `~/.aleph/repos.json` is a factory repo. [Factory tasks](factory-tasks.md) lists each task the factory runs, what starts it and what stops two runs from doing the same work. The design is in [the seed factory spec](specs/2026-10-26-seed-factory.md).

## Set it up

```bash
systemctl --user link ~/aleph/jobs/systemd/aleph-tick.service
systemctl --user enable --now ~/aleph/jobs/systemd/aleph-tick.timer
aleph sandbox probe     # check the sandbox isolation from inside its profile
```

The `aleph-tick` timer runs `aleph tick` every 5 minutes. To start the tick after a Windows restart under WSL, see [Start at boot](start-at-boot.md).

## Commands

| Command | Does |
|---|---|
| `aleph dispatch` | Starts a run for each ready goal, up to the caps |
| `aleph tick` | Dispatches, triages, and does the periodic work; the timer runs it |
| `aleph triage <repo>-<n>` | Triages one issue now |
| `aleph status [<repo>-<n>[.<k>]] [--json]` | The state of one issue, or of each open issue in the recent repos |
| `aleph jobs` | Open jobs, then the jobs that ended in the last 24 hours |
| `aleph report` | Runs not yet shown, how far each checkout is behind `origin/main`, and health lines |
| `aleph land <name>` | Lands a held or reviewed run, with `Held-by: Chris` |
| `aleph drop <name>` | Drops a run and deletes its branch |
| `aleph recheck <name>` | Merges main into a stuck run's branch and checks it again, without a worker |
| `aleph pause` / `aleph resume` | Stops and restarts new runs |
| `aleph always <list\|grant <reason> <action>\|revoke <reason>>` | Lists or changes the Always rules |
| `aleph sandbox probe` | Checks the sandbox isolation |
| `aleph doctor [--fix] [--json]` | After an outage: clocks, git objects, units, `aleph.home`, the last probe and lost runs |
| `aleph judge [jev\|haiku]` | Shows or sets the model that judges for the hooks |

## How an issue becomes a commit

```text
issue ──triage──▶ goal(s) ──dispatch──▶ worker run ──▶ checks ──▶ reviewer ──▶ land
                    ▲                       ▲             │           │
                    └── planner splits      └─ fix round ─┴───────────┘
                        a large issue          (at most ALEPH_FIX_ROUNDS)
```

### Triage

The tick triages open issues that have no goals, oldest first, at most `ALEPH_TRIAGE_CAP` (5) a tick, and only while live runs are under the live cap. An issue added with `aleph issue add`, a note on an issue that waits for you, and a worker's `FOLLOWUP:` line each start a triage at once, under the dispatch's gates.

Triage is one read-only run per issue (`claude-opus-5-5`, with Read, Grep and Glob). It returns a route:

| Route | Does |
|---|---|
| `build` | Writes the issue's spec |
| `plan` | Writes the spec and sets `plan`, so a planner run (`claude-opus-5-5`) splits it into goals |
| `close` | Marks the issue done, with the reason as `closed_why` |
| `done` | Marks the issue done |
| `ask` | Sets an Ask with a question and options; a check that only the host can run has the reason `host-check` |

A malformed route or a failed run leaves the issue unchanged. After `ALEPH_TRIAGE_TRIES` (2) such runs, the issue gets an Ask with the reason `triage-failed`.

### The worker run

The dispatch starts a build run for each ready goal, up to the live cap. Each start holds a lock on its goal, so two dispatches start it once.

The worker is `claude -p` under `srt` (`~/.aleph/tools/bin/srt`), in `~/.aleph/sandbox/<id>/`. It sees:

- an empty home;
- the code as a bundle of `origin/main`, and the job's earlier `factory/<name>` branch if there is one;
- the network only to `api.anthropic.com` and `registry.npmjs.org`;
- the token in `~/.aleph/secrets/worker-token`, and nothing else of yours.

A second `srt` call bundles the branch, and aleph fetches it into the repo as `factory/<name>`. The ledger of runs is `~/.aleph/runs`.

The worker ends its result with tagged lines:

| Line | Becomes |
|---|---|
| `FOLLOWUP: <title>` | An issue with `source: worker`, at the priority of the issue it came from |
| `FLAKE: <test file> > <test name>: <what>` | A note on the repo's flake tracker |
| `DEFAULT: <choice> -> <what it chose>` | A line in the report |

### Verify

Verify is one station, with the run phase `verify`. In order, it runs:

1. the repo's setup and checks on a fresh clone of the branch, under `srt`;
2. the doc-claims check of the worker's final message against its transcript;
3. the keep-gate on the branch's new tests;
4. the Oracle commands of the spec that the checks did not run.

Each check and the Oracle add one result to the run's `checks` list. The Oracle's result is `oracle`. Each writes its log to `checks.log`. The first failure stops Verify and names the check that failed. A check or an Oracle command that fails runs once more. A sandbox fault skips the Oracle and is not a failure.

### When a run is stuck

A run is stuck when:

- the last line of the worker's output is not a `result` event with `is_error` false;
- it made no commit;
- a check fails after the fix rounds;
- it reaches the time box (`ALEPH_JOB_TIMEOUT`, 30 minutes). The factory drops it and sends the issue to the planner to split, or asks you when it is a part or already split;
- its output file does not grow for `ALEPH_STALL_SECONDS` (600). The reason is `stalled: no output for 10 minutes`.

A failed check sends the job back to its worker on the same branch, with a note that names the check and holds the last 80 lines of its log. This happens at most `ALEPH_FIX_ROUNDS` (2) times a job. After the last round, the run stays stuck as `<check> failed after <n> fix rounds`.

When a check fails on two runs in a row with the same failing tests, no further fix round starts. The run asks you, and quotes the failure, so you can tell a wrong test from a wrong branch.

### Review

When Verify passes, a fresh reviewer (`claude-opus-5-5`, under `srt`, in a clone of the branch) reads the goal and the diff, and checks the spec's Goal and Oracle. It ends with a verdict: `pass` or `hold <reason>`. There is one review: no second review follows it.

- `hold` starts a fix round, like a failed check. The run record shows the round as `stuck` with `next: worker` until the next round starts. After the last round, the run asks you, with the reason `review`.
- No verdict, an error or the time box (`ALEPH_REVIEW_TIMEOUT`, 10 minutes) runs the reviewer once more. A second miss asks you, with the reason `review`.
- A diff over `ALEPH_REVIEW_DIFF_MAX` (200000) characters goes in as the `git diff --stat` plus the diff cut at that length.
- A merge run, which only merges `origin/main` into the branch after a land conflict, gets a review of its merge commit only: the merge commit's diff against its first parent.

A change that deletes or renames a test, changes a `test`, `it`, `describe` or `expect` line, or adds `.skip`, `.only` or `.todo` does not stop the run. The reviewer gets each one as a finding, and holds only when the goal does not call for it. The reviewer also gets the list of changed files that the spec's Edit surface does not name, and holds only when the goal does not need the change.

### Held paths

A diff that changes a path in the repo's `held` list or a security path (`SECURITY_PATHS` in `jobs/lib/gate.ts`), other than a test, runs Verify and the reviewer like any other. When the reviewer passes it, the run waits with a `held-path` Ask instead of landing. `aleph land <name>` lands it and `aleph drop <name>` drops it.

### The land

Lands of one repo go one at a time, in the order they became ready. A land merges the branch onto `origin/main` in memory (`git merge-tree`), runs the checks on that tree, and pushes that tree as one squash commit. The commit ends with `Issue: <repo>-<n>` when the run is on an issue, then `Job: <job>`. A held land also writes `Held-by:` with the name of the lander.

- **Batch.** The land that takes the lock also takes the passed runs queued behind it, up to `ALEPH_LAND_BATCH` (8). It checks the last commit once and pushes all of them in one push. If the checks fail, it splits the batch in half until it finds the run that fails.
- **Skipped checks.** When `origin/main` is still the commit a run's checks passed on, the land pushes without the checks.
- **After the push.** The land fast-forwards the repo's main checkout if it is clean, and restarts `aleph-ui` when the change touches a file the server imports.

## Gates

Each dispatch first does its steps: it starts the next steps a pause kept, rescues stuck, failed, killed and lost runs, lands the passed runs, and closes parents whose parts are done. Then it asks each queued goal 7 gates, in this order. The first gate that binds skips the goal for this dispatch, and a record in `~/.aleph/factory/holds.jsonl` names that gate. The next dispatch asks again.

| Gate | Binds when |
|---|---|
| Pause | `aleph pause` (`~/.aleph/factory/paused`), until `aleph resume`. A paused dispatch does nothing, not even its steps |
| Baseline | The checks on `origin/main` failed (kept in `~/.aleph/factory/baseline.json`), still run, or could not run |
| Probe | The last `aleph sandbox probe` failed |
| Not ready | The goal is done, waits on an issue in its `after` list, has an open job, or has a planner or spec check running |
| Live cap | `ALEPH_LIVE_CAP` runs are live |
| Busy file | A file in the goal's Edit surface had 3 land conflicts in 7 days, and another open job names it |
| Loop guard | The goal's last 3 runs made no commit, or it started 3 times in 60 minutes. The dispatch sets an Ask in place of a start |

A goal that no gate holds goes to its spec check (a repo with `"author": true` in the registry) or the planner, and then starts. GitHub CI on main does not gate.

A stuck or failed run holds only its own goal, through its open job. The rescue takes a safe action on it once per goal per case, or sets a `rescue` Ask. A lost run (its process ended and wrote no end) is marked failed and its goal reruns once; a second lost run of the goal sets a `rescue` Ask.

The firefighter is code in each tick (`jobs/lib/firefighter.ts`); no agent runs. A failed baseline, a red GitHub CI on main and a failed sandbox probe each file one issue of priority `critical`, kind `bug` and label `red-main` per failing commit. The request names the commit (`Failing commit: <sha>`) and holds the last 200 lines of the log, at most 8000 characters: `checks.log` of the baseline, `gh run view <id> --log-failed` of the CI run, or `probe.log` of the probe. A second tick, or a second source for the same commit, files nothing more. While the repo has an open `red-main` issue, a new failing commit is one note on that issue, not a second issue. A land live for 30 minutes or more gets a `rescue` Ask on its issue, once per land run, and the director decides.

`aleph recheck <name>` is the way out of a stuck run that keeps its work, for example one that a flaky test on main stuck. It merges the current `origin/main` into the branch, runs the checks, the held rule and the reviewer, and lands like any passed run.

## Asks and Always rules

Whatever would wait for you is an Ask, of kind `input` or `approval`, with a reason, a question and options. Every new Ask goes to the director first: one read-only run of `claude-fable-5-1` per Ask, which decides it with actions that code checks and applies, or escalates it to you with its case text (situation, effects and recommendation). Code keeps an escalation list that the director cannot decide: a land that changes a security path or `bun.lock`, a memory proposal, a host check, a second run-cap or rescue Ask on the same goal, and closing or dropping an issue you filed. Each decision is a Director entry in the Gates page log. The Status page lists the Asks under "Awaiting you"; an Ask shows its buttons only once the director has escalated it. The Always button writes a rule to `~/.aleph/factory/always.json` that maps the reason to an action, and the next Ask with that reason takes the action without you. `aleph always` lists and changes the same rules.

## Flakes and health

A check that fails in a run, a land or the baseline runs once more on the same tree (not after a time-out). If it passes, it counts as passed, and the flake goes to `~/.aleph/factory/flaky.json`. Two flakes of one check in 7 days raise a health line in `aleph report`.

## Settings

The live cap is read from its variable first, then from `~/.aleph/factory/caps.json` (`{ "live": 5 }`), then the default.

| Variable | Default | Does |
|---|---|---|
| `ALEPH_LIVE_CAP` | 10 | Runs live at once |
| `ALEPH_JOB_TIMEOUT` | 1800 | Seconds in a worker's time box |
| `ALEPH_CHECK_TIMEOUT` | 1200 | Seconds for the checks |
| `ALEPH_REVIEW_TIMEOUT` | 600 | Seconds for a review |
| `ALEPH_REVIEW_DIFF_MAX` | 200000 | Characters of diff the reviewer gets |
| `ALEPH_STALL_SECONDS` | 600 | Seconds without output before a run is stopped |
| `ALEPH_FIX_ROUNDS` | 2 | Fix rounds per job |
| `ALEPH_LAND_BATCH` | 8 | Runs one land may push together |
| `ALEPH_TRIAGE_CAP` | 5 | Triage runs per tick |
| `ALEPH_TRIAGE_TRIES` | 2 | Failed triage runs before an Ask |
| `ALEPH_DIRECTOR_CAP` | 3 | Director runs per tick, one per Ask |
| `ALEPH_WORKER_CMD` | `claude` | The worker command |
| `ALEPH_REVIEWER_CMD` | the worker command | The reviewer command |

For each agent role (`TRIAGE`, `PLAN`, `SPECCHECK`, `DIRECTOR`, `MONITOR`), `ALEPH_<ROLE>_CMD` replaces `claude` and `ALEPH_<ROLE>_TIMEOUT` sets the time-out in seconds. Tests use these to put in a fake.
