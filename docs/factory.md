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

A second `srt` call bundles the branch, and aleph fetches it into the repo as `factory/<name>`. A third runs the repo's setup and checks on a fresh clone. The ledger of runs is `~/.aleph/runs`.

The worker ends its result with tagged lines:

| Line | Becomes |
|---|---|
| `FOLLOWUP: <title>` | An issue with `source: worker`, at the priority of the issue it came from |
| `FLAKE: <test file> > <test name>: <what>` | A note on the repo's flake tracker |
| `DEFAULT: <choice> -> <what it chose>` | A line in the report |
| `FACT: <claim> [source: <ref>]` | A vault note, after a facts run checks it against its source |

### When a run is stuck

A run is stuck when:

- the last line of the worker's output is not a `result` event with `is_error` false;
- it made no commit;
- a check fails after the fix rounds;
- it reaches the time box (`ALEPH_JOB_TIMEOUT`, 30 minutes). The factory drops it and sends the issue to the planner to split, or asks you when it is a part or already split;
- its output file does not grow for `ALEPH_STALL_SECONDS` (600). The reason is `stalled: no output for 10 minutes`.

A failed check sends the job back to its worker on the same branch, with a note that names the check and holds the last 80 lines of its log. This happens at most `ALEPH_FIX_ROUNDS` (2) times a job. After the last round, the run stays stuck as `<check> failed after <n> fix rounds`.

When a hidden check fails twice in a row with the same failing tests, no further fix round starts. The run asks you, and quotes the failure, so you can tell a wrong test from a wrong branch.

### Review

When the checks pass, a fresh reviewer (`claude-opus-5-5`, under `srt`, in a clone of the branch) reads the goal and the diff. It ends with a call: `land`, `back` or `ask`.

- `back` starts a fix round, like a failed check. The run record shows the round as `stuck` with `next: worker` until the next round starts.
- `ask`, no call, an error or the time box (`ALEPH_REVIEW_TIMEOUT`, 10 minutes) asks you, with the reason `review`.
- A diff over `ALEPH_REVIEW_DIFF_MAX` (200000) characters goes in as the `git diff --stat` plus the diff cut at that length.
- A reviewer with no verdict runs once more.

A change that deletes or renames a test, changes a `test`, `it`, `describe` or `expect` line, or adds `.skip`, `.only` or `.todo` does not stop the run. The reviewer gets each one as a finding, and holds only when the goal does not call for it.

### Hidden checks and sealed scenarios

An issue can have checks the worker never sees:

- **Hidden test files**, in the work store at `<repo>/hidden/<id>/`, added with `aleph issue hidden`. After the repo's checks pass, aleph copies them into the check clone as `.hidden/` and runs `hiddenRun` from the registry (default `bun test ./.hidden`). A fix round gets the names of the failing tests, never their source.
- **Sealed scenarios**, with `"author": true` in the registry. Before a goal's first worker run, a fresh `claude -p` with no tools reads the goal section only and writes 3 to 8 behaviours to `scenarios.md` among the hidden files. The reviewer checks each one on the branch.

### Held paths

A diff that changes a path in the repo's `held` list, other than a test, waits for you. `aleph land <name>` lands it and `aleph drop <name>` drops it.

### The land

Lands of one repo go one at a time, in the order they became ready. A land merges the branch onto `origin/main` in memory (`git merge-tree`), runs the checks on that tree, and pushes that tree as one squash commit. The commit ends with `Issue: <repo>-<n>` when the run is on an issue, then `Job: <job>`. A held land also writes `Held-by:` with the name of the lander.

- **Batch.** The land that takes the lock also takes the passed runs queued behind it, up to `ALEPH_LAND_BATCH` (8). It checks the last commit once and pushes all of them in one push. If the checks fail, it splits the batch in half until it finds the run that fails.
- **Skipped checks.** When `origin/main` is still the commit a run's checks passed on, the land pushes without the checks.
- **After the push.** The land fast-forwards the repo's main checkout if it is clean, and restarts `aleph-ui` when the change touches a file the server imports.

## Gates

A run starts only when every gate is open.

| Gate | Closes when | Opens when |
|---|---|---|
| Pause | `aleph pause` (`~/.aleph/factory/paused`) | `aleph resume` |
| Hold | An open job in a factory repo is `stuck` or `failed` | It is landed, rechecked or dropped |
| Probe | `aleph sandbox probe` failed | A probe passes |
| Main is red | A check fails on `origin/main` (kept in `~/.aleph/factory/baseline.json`) | Main is green again |
| Live cap | `ALEPH_LIVE_CAP` runs are live | A run ends |
| Day cap | `ALEPH_DAY_CAP` runs started in the last 24 hours | The window moves on |
| Awaiting cap | `ALEPH_AWAITING_CAP` runs wait for you | You answer one |

The hold stops new runs and lands, but runs already working finish and `aleph land` still works. The Status page, `aleph report` and the dispatch output say why: `Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared.`

`aleph recheck <name>` is the way out of a stuck run that keeps its work, for example one that a flaky test on main stuck. It merges the current `origin/main` into the branch, runs the checks, the held rule and the reviewer, and lands like any passed run.

## Asks and Always rules

Whatever waits for you is an Ask, of kind `input` or `approval`, with a reason, a question and options. The Status page lists them under "Awaiting you". The Always button writes a rule to `~/.aleph/factory/always.json` that maps the reason to an action, and the next Ask with that reason takes the action without you. `aleph always` lists and changes the same rules.

## Flakes and health

A check that fails in a run, a land or the baseline runs once more on the same tree (not after a time-out, and not the hidden check). If it passes, it counts as passed, and the flake goes to `~/.aleph/factory/flaky.json`. Two flakes of one check in 7 days raise a health line in `aleph report`.

## Dependency updates

With the nightly probe, the tick runs `bun outdated` in a fresh clone of each factory repo's `origin/main`, inside the sandbox. It files one issue per package that has a newer version, with `source: deps` and an Ask of kind `approval`. Nothing starts until you approve it. `~/.aleph/factory/deps.json` stops it from proposing the same version twice.

## Settings

Each cap is read from its variable first, then from `~/.aleph/factory/caps.json` (`{ "day": 999, "live": 5, "awaiting": 5 }`), then the default.

| Variable | Default | Does |
|---|---|---|
| `ALEPH_DAY_CAP` | 12 | Runs that may start in any 24 hours |
| `ALEPH_LIVE_CAP` | 10 | Runs live at once |
| `ALEPH_AWAITING_CAP` | 5 | Runs waiting for you before new runs stop |
| `ALEPH_JOB_TIMEOUT` | 1800 | Seconds in a worker's time box |
| `ALEPH_CHECK_TIMEOUT` | 1200 | Seconds for the checks |
| `ALEPH_REVIEW_TIMEOUT` | 600 | Seconds for a review |
| `ALEPH_REVIEW_DIFF_MAX` | 200000 | Characters of diff the reviewer gets |
| `ALEPH_STALL_SECONDS` | 600 | Seconds without output before a run is stopped |
| `ALEPH_FIX_ROUNDS` | 2 | Fix rounds per job |
| `ALEPH_LAND_BATCH` | 8 | Runs one land may push together |
| `ALEPH_TRIAGE_CAP` | 5 | Triage runs per tick |
| `ALEPH_TRIAGE_TRIES` | 2 | Failed triage runs before an Ask |
| `ALEPH_WORKER_CMD` | `claude` | The worker command |
| `ALEPH_REVIEWER_CMD` | the worker command | The reviewer command |

For each agent role (`TRIAGE`, `PLAN`, `AUTHOR`, `FACTS`, `FIREFIGHTER`, `EXPLAIN`), `ALEPH_<ROLE>_CMD` replaces `claude` and `ALEPH_<ROLE>_TIMEOUT` sets the time-out in seconds. `ALEPH_OUTDATED_CMD` replaces `bun outdated`. Tests use these to put in a fake.
