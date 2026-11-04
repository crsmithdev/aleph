# Job record: one place for a job's execution state

Status: approved by Chris on 2026-11-04 (JSON file per job, not SQLite).

## Store survey (4 Nov 2026, main 5159f5568)

Each file under `~/.aleph/factory` and each field of `Run` (jobs/lib/ledger.ts), and where it goes.
"Moves" means into the job record; "stays" means factory-wide settings or health; "goes" means no
code reads it on main, or the record replaces it.

### ~/.aleph/factory

| Path | Decision | Why |
|---|---|---|
| `holds.jsonl` | moves: `wait`, and `events` kind `hold`/`started` | why one goal waits |
| `streak/<job>.txt` | moves: `events` kind `streak` | a per-goal mark |
| `cap/<job>.txt` | moves: `events` kind `cap`; a `started` event clears it | a per-goal mark |
| `rerun/<job>.md` | moves: `events` kind `rerun`; a `started` event clears it | a per-goal note |
| `director.jsonl` | moves: `events` kind `director` on the record of its `on` | the director's decisions on one job |
| `spec-checks.jsonl` | moves: `events` kind `spec-check` with the cost | main writes no row since the spec check went; the monitor table still counts the old rows |
| `acceptance/`, `accept-nightly.json` | goes | acceptance went on main |
| `deps.json`, `firefighter.json`, `followups.log`, `probe.log`, `probe.log.stderr`, `standing.json`, `baseline.json.bak*`, `corrections.*.bak.json` | goes | no code reads them |
| `caps.json`, `always.json` | stays | settings |
| `paused` | stays | factory-wide switch |
| `baseline.json`, `baseline/` | stays | health of main, per repo |
| `ci.json` | stays | health of main on GitHub |
| `smoke.json`, `stalls.json`, `tick.json` | stays | factory health |
| `flaky.json` | stays | flakes are per test and per repo, not per job |
| `corrections.json` | stays | the lessons, factory-wide |
| `seen`, `episodes-seen` | stays | the news and the episode reader, factory-wide |
| `tick.log`, `dispatch.log` | stays | factory logs |
| `monitor/` | stays | the monitor's own folder |
| `ui-sessions.json` | stays | UI sign-in |

### Run folder files

| File | Decision |
|---|---|
| `state.json` | moves: the run's entry in `runs` |
| `asked`, `asked-spec` | moves: `events` kind `asked` with the run id, the question and the spec version |
| `rescued` | moves: `events` kind `rescued` with the run id |
| `pid`, `exit` | stays: facts of the operating system |
| logs, `spec.md`, `command.txt`, prompts, `result.md`, JUnit files, `batch.json` | stays |

### Issue front matter

| Field | Decision |
|---|---|
| `ask`, `reason`, `question`, `options`, `recommended`, `why`, `headline`, `situation`, `details`, `effects`, `recommend` | moves: `ask` of the issue's record |
| everything else (`status`, `closed_as`, `closed_why`, `plan`, `after`, `since`, ...) | stays: business state |

### Run fields

Every field stays a field of the run in `runs[]`, except these:

| Field | Decision |
|---|---|
| `ask` | moves: `ask` of the record (one Ask per job) |
| `round` | stays as the run's own fact; `rounds` of the record replaces the recounts in `unit.ts` and `worker-verdict.ts` |
| `cost` | stays; `cost` of the record is the sum |
| `review`, `noCommit`, `kind` `triage`/`plan`/`facts`/`firefighter` | stays read only: old runs keep them |
| `facts`, `kept`, `rejected`, `todo`, `review2`, `needs` (in old state.json files, not in the type) | goes: the migration drops them |
| `kind`, `job`, `name`, `repo`, `branch`, `worktree`, `condition`, `phase`, `reason`, `question`, `say`, `route`, `cause`, `checkName`, `fate`, `session`, `model`, `commit`, `check`, `checkItem`, `on`, `land`, `merge`, `conflicts`, `failed`, `next`, `defaults`, `checks`, `checkedBase`, `checkedTip`, `stat`, `held`, `lander`, `told`, `shown`, `started`, `ended`, `made` | moves into `runs[]` unchanged |

The record key is the run's `on` (`<repo>-<n>`). A run on no issue (a plain run, a run from before `on`)
keys by its job id. The records are in `ALEPH_RECORDS_DIR`, else `<ALEPH_JOBS_DIR>/.records` when a
test names the ledger, else `~/.aleph/jobs`.

## Problem

The factory keeps a job's state in 8 stores. The same fact is in more than
one place:

| Fact | Places today |
|---|---|
| Ask | run `state.json` `ask`; issue front matter; run files `asked`, `asked-spec`; `factory/streak/`, `factory/cap/` |
| Fix rounds | `state.json` `round`; recounted from earlier runs (`unit.ts:450`, `worker-verdict.ts:96`) |
| Why a goal waits | `factory/holds.jsonl`; derived again by `stage()` from store plus ledger |
| Cost | `run.cost`; `factory/spec-checks.jsonl`; `usage.jsonl` |
| Running | `state.json` `condition`; `pid` and `exit` files; `rescue.ts` patches the difference |
| Flakes | `factory/flaky.json`; notes on the tracker issue |

Each copy needs code to write it and code to repair it when the copies
disagree.

## Design

One JSON file per job: `~/.aleph/jobs/<repo>-<n>.json`. One module,
`jobs/lib/record.ts`, reads and writes it. No other module opens it.

```json
{
  "issue": "aleph-1207.1",
  "stage": "working",
  "ask": null,
  "wait": { "reason": "after aleph-1207", "since": "..." },
  "rounds": 1,
  "cost": 1.84,
  "runs": [
    { "id": "...", "kind": "worker", "started": "...", "ended": "...",
      "condition": "failed", "reason": "check tests failed",
      "cost": 1.20, "commit": "abc123",
      "checks": [{ "name": "tests", "ran": 412, "passed": 410, "failed": 2,
                   "failures": [{ "file": "...", "name": "...", "message": "..." }] }] }
  ],
  "events": [{ "at": "...", "what": "spec check passed" }]
}
```

- `update(job, fn)` reads, applies `fn`, and writes through a temporary
  file and a rename, under the job's lock.
- The next step is a function of the record only: `next(record)`. This is
  the 12-factor "stateless reducer".
- `events` is the history. It replaces `holds.jsonl`, `director.jsonl`, the
  `streak/` and `cap/` markers and the `asked`, `rescued` and `rerun/` files.
- The issue store keeps the business state: the issue text, open or closed,
  `closed_as`, `closed_why`, `parked`. The Ask moves out of it.
- A run folder keeps logs only: `output.log`, `checks.log`, the JUnit files
  and `result.md`. `state.json` goes.
- `pid` and `exit` stay in the run folder, because they are facts of the
  operating system. One function compares them with the record.
- The UI reads `~/.aleph/jobs/*.json`. `/api/events` watches that folder.
- Factory-wide files stay: settings (`caps.json`, `always.json`), `paused`,
  and `baseline.json` for each repo.

## Migration

One script builds a record for each job from the ledger and the store,
then the old readers go. The script is deleted after it runs. There is no
second reader for old data.

## Order of work

1. `record.ts` and the migration script, with tests.
2. Writers move to `record.ts` one module at a time: `unit.ts`,
   `transitions.ts`, `landing.ts`, `rescue.ts`, `ask.ts`, `factory.ts`.
3. Readers move: `job.ts`, `stage.ts`, `ui/state.ts`, `ui/api/jobs.ts`.
4. The old stores and their repair code go.

## Status on branch job-record

Done:

- `record.ts`: `read`, `all`, `update` (temporary file, rename, lock), the run accessors, events, and
  `next(record)`.
- The ledger's `readRun`, `writeRun`, `updateRun` and `allRuns` read and write the records, so every
  writer and every reader of a run's state goes through `record.ts`. No code reads `state.json`.
- `holds.jsonl`, `director.jsonl`, `spec-checks.jsonl`, `streak/`, `cap/`, `rerun/` and the run files
  `asked`, `asked-spec` and `rescued` are events in the record. `wait` holds why a goal waits.
- `/api/events` watches the records folder. `/api/jobs/:name` shows `next`, `rounds` and `events`.
- `jobs/migrate-records.ts` builds the records. Delete it after the cutover.

- The Ask: the record's `ask` holds the one Ask of the issue and its runs; `askRun` names the run that
  owns it. `ask.ts` (`askOf`, `setAsk`, `clearAsk`, `awaitsChris` on a `<repo>-<n>` ref), the director,
  the todo CLI and the UI read and write it through `record.ts`. The issue store keeps only business
  state; `aleph issue lint` flags an `ask` key in front matter as retired.
- Fix rounds: `unit.ts` and `worker-verdict.ts` read `rounds` of the record. `earlierRounds` stays only
  for what the earlier runs failed (the reviewer's send-backs and the repeated-failure port).
- `next(record)` chooses the dispatch's land (`waitingToLand`), rescue (`stuckJobs`) and kept step
  (`startKept`), through `job.ts` `stepOf`. `continuation.ts` `nextStep` stays: it writes the `next`
  that `next(record)` reads, when a run ends.

Rescue patches that stay: the killed and lost run patches compare the record's `running` with the OS
(`pid`, the unit's exit). The record cannot know that a process died, so they stay.

## Cutover

Run these in order. Do not run them before the branch is approved.

1. `aleph pause`, and wait until no unit is live (`systemctl --user list-units 'aleph-*'`).
2. `bun jobs/migrate-records.ts --strip-store` from the branch checkout. It writes `~/.aleph/jobs/`,
   then one store commit per repo that takes the Ask fields out of the front matter. Check that
   `clashes` in its output is empty.
3. Land the branch.
4. `systemctl --user restart aleph-ui`, because `ui/` changed.
5. `aleph resume`.
6. Later: delete `jobs/migrate-records.ts`, and archive `runs/*/state.json`, `holds.jsonl`,
   `director.jsonl`, `spec-checks.jsonl`, `streak/`, `cap/` and `rerun/`.
