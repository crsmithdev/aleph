# Factory

The factory builds issues without you. It takes in each open issue, starts a worker for each ready issue, checks and reviews the branch, and lands it on `main`. It asks you only when a rule says so.

A project with `sandbox: true` in its `~/.aleph/items/projects/<n>/project.md` is a factory repo. [Workflow](workflow.md) states each step and gate, [Routing](routing.md) the model for each role, and [Data model](data-model.md) each file the factory keeps.

## Set it up

The units need a systemd user session. Under WSL, set `systemd=true` in `/etc/wsl.conf` and turn on linger (`loginctl enable-linger $USER`), so the units run with no terminal open. The alert posts to Sidetone (`SIDETONE_TELL_URL`). Without Sidetone, the alert unit fails and the factory runs on. `aleph doctor` checks `aleph.home`, which home-proxy serves ([UI](ui.md)).

```bash
systemctl --user link ~/aleph/jobs/systemd/aleph-alert@.service
systemctl --user link ~/aleph/jobs/systemd/aleph-tick.service
systemctl --user enable --now ~/aleph/jobs/systemd/aleph-tick.timer
systemctl --user link ~/aleph/jobs/systemd/aleph-suite.service
systemctl --user enable --now ~/aleph/jobs/systemd/aleph-suite.timer
```

The `aleph-tick` timer runs `aleph tick` every minute. The `aleph-suite` timer runs `aleph suite` every hour. When either service fails, `aleph-alert@.service` posts one Sidetone tell that names it, and no second tell for that unit within 30 minutes; `aleph doctor` fails a service that systemd reports as `failed`. To start the tick after a Windows restart under WSL, see [Start at boot](start-at-boot.md).

## Commands

`aleph help` prints each command with its usage, and `aleph <command> --help` prints one. This table says what each factory command is for.

| Command | Does |
|---|---|
| `aleph dispatch` | Starts a run for each ready issue, up to the caps, or one issue now |
| `aleph tick` | Does the periodic work that is due, and the sweep; the timer runs it |
| `aleph suite` | Runs the full checks on `origin/main` of each factory repo whose main moved since the last run, and records the baseline; its timer runs it |
| `aleph intake` | Takes in one issue now |
| `aleph status` | The state of one issue, or of each open issue in the recent repos |
| `aleph jobs` | Open jobs, then the jobs that ended in the last 24 hours, or one job. With `--resume`, opens the Claude Code session of the job's latest run in its worktree |
| `aleph job`, `aleph run` | Starts a worker job on a spec, or a command as a tracked plain job, by hand |
| `aleph report` | Runs not yet shown (one block per issue, under the lane of its newest run), each open issue with an Ask, how far each checkout is behind `origin/main`, and health lines |
| `aleph land` | Lands a passed run, or one that waits on a `held-path` or `review-held` Ask. A land of a waiting run writes `Held-by: Chris` |
| `aleph checked` | Marks a landed job's check as done, so it leaves `aleph jobs` |
| `aleph drop` | Drops a run and deletes its branch |
| `aleph recheck` | Merges main into a returned or failed run's branch and checks it again, without a worker |
| `aleph pause`, `aleph resume` | Stops and restarts new runs |
| `aleph always` | Lists or changes the Always rules and the no-answer timeouts |
| `aleph doctor` | After an outage: clocks, git objects, units, `aleph.home` and lost runs |
| `aleph judge` | Shows or sets the model that judges for the hooks |
| `aleph models` | Shows or sets the model of each size and role model |
| `aleph director` | Runs the director on the Asks that have no case text |
| `aleph monitor` | Writes the monitor's report for a day |
| `aleph housekeep` | Reviews the parked issues that a land touched, or every parked issue once a day |
| `aleph investigate` | Traces what happened to an issue or a job and recommends issues; the Investigate button starts it detached |

## aleph doctor

`aleph doctor` prints one line per check, each `ok` or a fault (`jobs/lib/infra/doctor.ts`). `--json` prints the same as JSON.

| Check | A fault means |
|---|---|
| `wall clock` | The wall clock stepped more than 1000 ms against the monotonic clock while the check watched it |
| `WSL clock` | The WSL clock is more than 5 s from the Windows time |
| `empty objects` | A git object file of a registered repo is empty. `--fix` leaves it, so you decide |
| `gc log` | A leftover `gc.log` stops git's automatic cleanup. `--fix` deletes it |
| `git fsck` | `git fsck --no-dangling` fails in a registered repo |
| `unit <name>` | `aleph-ui`, `home-proxy` or a timer is not active, or a tick or suite service failed |
| `<timer> next run` | The tick or suite timer has no next run and its service is not running |
| `aleph.home` | `ALEPH_HOME_URL` or its `/api/factory` route does not answer, or the gzipped JSON does not parse |
| `lost runs` | A run's process is gone and the run has no result |
| `unit links` | A link in the unit folder points into a worktree or at a missing file. Link the unit again from the main checkout, as in Set it up |

`aleph doctor --fix` starts `aleph-tick.service` and deletes each `gc.log`. It changes nothing else.

## The tick

The tick starts only periodic work, each step on its own due rule: the maintainer (mechanical vault pass and the compile of yesterday) once a day from 03:00, the monitor once a day (from a local hour set on the Automation page, 0 by default), the housekeeper once a day and after a move of a main (at most once an hour, each call capped at an hour, and an issue it changed left out for a day), the CI read and the firefighter every 5 minutes, or every minute while a GitHub CI run on a factory repo's main is in progress (by the last CI read) or a land on that main ended in the last 15 minutes, the smoke test and the sweep every tick. No transition waits for it. The sweep is the safety net: it records what could move and does not (a passed run with no land, a ready issue with no run, an issue for intake, an Ask with no director run, a job to rescue). Work it sees at two ticks in a row is missed: the sweep logs a `missed` event with the key as its subject, once per key, and starts a dispatch. A missed key is a bug in the transition that should have started it. When a main with a red record moves (a fix by hand), the sweep starts `aleph suite` once for the new commit. A tick that finds nothing due reads only local files.

## Flakes

A check that fails in a run, a land or the baseline runs once more on the same tree (not after a time-out or a kill, which give no verdict). A check that passes on this rerun counts as passed, and its flake goes to the `flaky` table of `aleph.db`. Two flakes of one check in 7 days raise a health line in `aleph report`.

## Load limit

A check, a worker and a land wait for the load average ([Workflow](workflow.md#2-dispatch-and-its-gates) has the rule), and the run's phase says why. A start that had to wait keeps the queue for 15 seconds, so the load average shows it before the next start reads the load. The full suite runs on half the cores (`ALEPH_TEST_PARALLEL` in `package.json`).

## Settings

The live cap, the run cap, the intake tries, the job time limit, the fix rounds, the land batch and the load limit are read from their variables (`ALEPH_LIVE_CAP`, `ALEPH_RUN_CAP`, `ALEPH_INTAKE_TRIES`, `ALEPH_JOB_TIMEOUT`, `ALEPH_FIX_ROUNDS`, `ALEPH_LAND_BATCH`, `ALEPH_LOAD_LIMIT`) first, then from the `caps` setting in `aleph.db` (`{ "live": 5, "run": 3, "intakeTries": 2, "jobSeconds": 1800, "fixRounds": 2, "landBatch": 8, "loadLimit": 24 }`), then the default. The Controls panel of the Automation page edits the `caps` setting. The run cap is the number of starts of one issue in 60 minutes before a `run-cap` Ask; `ALEPH_RUN_CAP` (3) is the default. `ALEPH_DISPATCH`, else `on`; `ALEPH_DISPATCH=off` stops every detached dispatch, intake, director and suite.

| Variable | Default | Does |
|---|---|---|
| `ALEPH_LIVE_CAP` | cores / 6, at least 1 | Runs live at once (4 on a machine with 24 cores) |
| `ALEPH_RUN_CAP` | 3 | Starts of one issue in 60 minutes before a `run-cap` Ask |
| `ALEPH_LOAD_LIMIT` | cores | The 1-minute load average under which a check, a worker or a land starts |
| `ALEPH_JOB_TIMEOUT` | 1800 | Seconds in a worker's time box |
| `ALEPH_CHECK_TIMEOUT` | 1200 | Seconds for the checks |
| `ALEPH_REVIEW_TIMEOUT` | 600 | Seconds for a review |
| `ALEPH_SUITE_BUDGET_S` | 120 | Seconds a repo's full suite may take before the Status page warns |
| `ALEPH_REVIEW_DIFF_MAX` | 200000 | Characters of diff the reviewer gets |
| `ALEPH_STALL_SECONDS` | 600 | Seconds without output before a run is stopped |
| `ALEPH_FIX_ROUNDS` | 2 | Fix rounds per job |
| `ALEPH_LAND_BATCH` | 8 | Runs one land may push together |
| `ALEPH_INTAKE_CAP` | 5 | Intake runs one dispatch starts |
| `ALEPH_INTAKE_TRIES` | 2 | Intake runs with no reply before an Ask |
| `ALEPH_DIRECTOR_CAP` | 3 | Director runs per `aleph director`, one per Ask |
| `ALEPH_MONITOR` | on | `off` turns off the tick's daily monitor step |
| `ALEPH_RESCUE` | on | `off` leaves a returned or failed run as it is, so its open job keeps its issue not ready |
| `ALEPH_RUN_ENV` | none | An env file that a worker, a check or a command run loads. A project's own `env` wins |
| `ALEPH_HOME_URL` | `http://aleph.home/` | The address that `aleph doctor` checks |
| `ALEPH_UNIT_DIR` | `~/.config/systemd/user` | The directory of the systemd user units |
| `ALEPH_SYSTEMCTL` | `systemctl` | The command that runs `systemctl --user` |
| `ALEPH_WINDOWS_TIME_CMD` | none | A shell command that prints the Windows time in milliseconds (`powershell.exe` reads it when unset); `aleph doctor` compares it with the WSL clock |
| `SIDETONE_TELL_URL` | `https://127.0.0.1:3100/tell` | Where the factory posts a line when a run ends |

[Routing](routing.md#overrides) lists the variables that replace the worker, reviewer, role and judge commands.

### Internal variables

A user does not set these. Tests, the factory's own child processes, WSL, bun or Claude Code set them.

- `ALEPH_AGENT`: the factory sets it to `1` in the settings of every agent role but the chat agent, which runs like a terminal session of Chris, so the aleph hooks know that no person is there.
- `ALEPH_BROWSER_TESTS`: `bun run test:all` and the factory's checks set it to `1` to run the tests that start Chrome.
- `ALEPH_CLI`: the UI tests set it to put in a fake CLI.
- `ALEPH_NOW`: tests set it to fix the clock.
- `ALEPH_START_CMD`: tests set it to start a run as a fake process.
- `START_LOG`: the fake CLI of the tests reads it to log its calls.
- `TZ`: the checks and the tests set it to `UTC`, so a result does not depend on the host zone.
- `TMPDIR`: the browser tests set it for Chrome's profile; `lib/git.ts` reads it only to report a git start failure.
- `NODE_ENV`: bun sets it to `test` under `bun test`, and the UI then writes no usage row.
- `WSL_DISTRO_NAME`: WSL sets it, and `aleph doctor` uses it to find that the host is WSL.
- `CLAUDE_CODE_SESSION_ID`: Claude Code sets it, and the vault stamps it on a note as its source.
