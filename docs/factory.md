# Factory

The factory builds issues without you. It takes in each open issue as goals, starts a worker for each ready goal, checks and reviews the branch, and lands it on `main`. It asks you only when a rule says so.

A repo with `"sandbox": true` in `~/.aleph/repos.json` is a factory repo. [Workflow](workflow.md) states each step and gate, [Routing](routing.md) the model for each role, and [Data model](data-model.md) each file the factory keeps.

## Set it up

```bash
systemctl --user link ~/aleph/jobs/systemd/aleph-tick.service
systemctl --user enable --now ~/aleph/jobs/systemd/aleph-tick.timer
systemctl --user link ~/aleph/jobs/systemd/aleph-suite.service
systemctl --user enable --now ~/aleph/jobs/systemd/aleph-suite.timer
```

The `aleph-tick` timer runs `aleph tick` every minute. The `aleph-suite` timer runs `aleph suite` every hour. To start the tick after a Windows restart under WSL, see [Start at boot](start-at-boot.md).

## Commands

| Command | Does |
|---|---|
| `aleph dispatch` | Starts a run for each ready goal, up to the caps |
| `aleph tick` | Does the periodic work that is due, and the sweep; the timer runs it |
| `aleph suite` | Runs the full checks on `origin/main` of each factory repo whose main moved since the last run, and records the baseline; its timer runs it |
| `aleph intake <repo>-<n>` | Takes in one issue now |
| `aleph status [<repo>-<n>[.<k>]] [--json]` | The state of one issue, or of each open issue in the recent repos |
| `aleph jobs` | Open jobs, then the jobs that ended in the last 24 hours |
| `aleph report` | Runs not yet shown, how far each checkout is behind `origin/main`, and health lines |
| `aleph land <name>` | Lands a held or reviewed run, with `Held-by: Chris` |
| `aleph drop <name>` | Drops a run and deletes its branch |
| `aleph recheck <name>` | Merges main into a returned or failed run's branch and checks it again, without a worker |
| `aleph pause` / `aleph resume` | Stops and restarts new runs |
| `aleph always <list\|grant <reason> <action>\|revoke <reason>>` | Lists or changes the Always rules |
| `aleph always timeout [<reason> <minutes>]` | Lists or sets the land timeouts; 0 removes one |
| `aleph doctor [--fix] [--json]` | After an outage: clocks, git objects, units, `aleph.home` and lost runs |
| `aleph judge [jev\|haiku]` | Shows or sets the model that judges for the hooks |
| `aleph models [set <tier> <model>\|enable <tier>\|disable <tier>]` | Shows or sets the model of each tier |
| `aleph director` | Runs the director on the Asks that have no case text |
| `aleph monitor` | Writes the monitor's report for a day |

## How an issue becomes a commit

[Workflow](workflow.md) follows an issue from intake to `main`: the gates, checks, review, land, rescue, Asks and the director, with each send-back.

## The tick

The tick starts only periodic work, each step on its own due rule: the corrections and the monitor once a day, the episodes every 30 minutes, the CI read and the firefighter every 5 minutes, the smoke test and the sweep every tick. No transition waits for it. The sweep is the safety net: it records what could move and does not (a passed run with no land, a ready goal with no run, an issue for intake, an Ask with no director run, a job to rescue). Work it sees at two ticks in a row is missed: the sweep logs a `missed` event with the key as its subject, once per key, and starts a dispatch. A missed key is a bug in the transition that should have started it. When a main with a red record moves (a fix by hand), the sweep starts `aleph suite` once for the new commit. A tick that finds nothing due reads only local files.

## Flakes and health

A check that fails in a run, a land or the baseline runs once more on the same tree (not after a time-out or a kill, which give no verdict).

## Load

A check, a worker and a land start only while the 1-minute load average is under `ALEPH_LOAD_LIMIT`. Otherwise they wait in a queue, and the run's phase says why. The wait fails nothing and counts against no time limit. A start that had to wait keeps the queue for 15 seconds, so the load average shows it before the next start reads the load. The full suite runs on half the cores (`ALEPH_TEST_PARALLEL` in `package.json`). If it passes, it counts as passed, and the flake goes to `~/.aleph/factory/flaky.json`. Two flakes of one check in 7 days raise a health line in `aleph report`.

## Settings

The live cap, the run cap, the intake tries, the job time limit, the fix rounds, the land batch and the load limit are read from their variables (`ALEPH_LIVE_CAP`, `ALEPH_RUN_CAP`, `ALEPH_INTAKE_TRIES`, `ALEPH_JOB_TIMEOUT`, `ALEPH_FIX_ROUNDS`, `ALEPH_LAND_BATCH`, `ALEPH_LOAD_LIMIT`) first, then from `~/.aleph/factory/caps.json` (`{ "live": 5, "run": 3, "intakeTries": 2, "jobSeconds": 1800, "fixRounds": 2, "landBatch": 8, "loadLimit": 24 }`), then the default. The Controls panel of the Automation page edits caps.json. The run cap is the number of starts of one goal in 60 minutes before a `run-cap` Ask; `ALEPH_RUN_CAP` (3) is the default. `ALEPH_DISPATCH`, else `on`; `ALEPH_DISPATCH=off` stops every detached dispatch, intake, director and suite.

| Variable | Default | Does |
|---|---|---|
| `ALEPH_LIVE_CAP` | cores / 6, at least 1 | Runs live at once (4 on a machine with 24 cores) |
| `ALEPH_LOAD_LIMIT` | cores | The 1-minute load average under which a check, a worker or a land starts |
| `ALEPH_JOB_TIMEOUT` | 1800 | Seconds in a worker's time box |
| `ALEPH_CHECK_TIMEOUT` | 1200 | Seconds for the checks |
| `ALEPH_REVIEW_TIMEOUT` | 600 | Seconds for a review |
| `ALEPH_REVIEW_DIFF_MAX` | 200000 | Characters of diff the reviewer gets |
| `ALEPH_STALL_SECONDS` | 600 | Seconds without output before a run is stopped |
| `ALEPH_FIX_ROUNDS` | 2 | Fix rounds per job |
| `ALEPH_LAND_BATCH` | 8 | Runs one land may push together |
| `ALEPH_INTAKE_CAP` | 5 | Intake runs one dispatch starts |
| `ALEPH_INTAKE_TRIES` | 2 | Intake runs with no reply before an Ask |
| `ALEPH_DIRECTOR_CAP` | 3 | Director runs per `aleph director`, one per Ask |
| `ALEPH_WORKER_CMD` | `claude` | The worker command |
| `ALEPH_REVIEWER_CMD` | the worker command | The reviewer command |
| `ALEPH_MONITOR` | on | `off` turns off the tick's daily monitor step |
| `ALEPH_RESCUE` | on | `off` leaves a returned or failed run as it is, so its open job keeps its issue not ready |
| `ALEPH_NEEDS_YOU_LOG` | `needs-you-log.md` next to the vault directory | The file of what reached Chris and why |
| `ALEPH_RUN_ENV` | none | An env file that a worker, a check or a command run loads. A repo's own `env` in `repos.json` wins |
| `ALEPH_HOME_URL` | `http://aleph.home/` | The address that `aleph doctor` checks |
| `ALEPH_UNIT_DIR` | `~/.config/systemd/user` | The directory of the systemd user units |
| `ALEPH_SYSTEMCTL` | `systemctl` | The command that runs `systemctl --user` |
| `ALEPH_WINDOWS_TIME_CMD` | none | A shell command that prints the Windows time in milliseconds (`powershell.exe` reads it when unset); `aleph doctor` compares it with the WSL clock |
| `SIDETONE_TELL_URL` | `https://127.0.0.1:3100/tell` | Where the factory posts a line when a run ends |

For each agent role (`INTAKE`, `DIRECTOR`, `MONITOR`), `ALEPH_<ROLE>_CMD` replaces `claude` and `ALEPH_<ROLE>_TIMEOUT` sets the time-out in seconds. Tests use these to put in a fake.

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
