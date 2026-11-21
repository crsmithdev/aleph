# Observability

This page lists what aleph records about itself, where each record goes, who writes it and who reads it. Each store has its own page for detail: [Naming](naming.md#events) for the event words, [Data model](data-model.md) for the files, [Langfuse](langfuse.md) for traces.

## Stores

| Store | Path | Holds | Writer | Readers |
|---|---|---|---|---|
| Event log | `events` table in `~/.aleph/aleph.db` | One row per event | `logEvent` in `lib/layout.ts` | Herald, Automation page, Status page, `/api/events` stream |
| Job rows | `jobs` table of `aleph.db` | One row for each job: its state, its fields and its `extra` | `makeJob`, `setState`, `endRun` and `patchRun` in `jobs/lib/records/record.ts` | The factory, the director, the monitor |
| Turn traces | Langfuse | One trace per Claude Code turn | `hooks/obs.ts`, `hooks/lib/gate.ts` | Langfuse UI, `ui/api/sessions.ts`, `ui/usage.ts` |
| Factory traces | Langfuse | One trace per factory run | `postTrace` in `jobs/lib/learning/trace.ts` | Langfuse UI |
| `usage` table | `aleph.db` | The account's weekly plan usage, one row per 10 minutes | `ui/usage.ts` | `ui/usage.ts`, the monitor table |
| `openrouter` table | `aleph.db` | What OpenRouter bills per list dollar | `ui/usage.ts` | `ui/usage.ts` |
| `jev` table | `aleph.db` | The `time` and `cost` of each Jev call | `lib/jev.ts` | `ui/usage.ts` |
| `suite_history` table | `aleph.db` | One row per suite run | `appendSuiteHistory` in `jobs/lib/gates/tables.ts` | `suiteHistory`, the monitor |
| `dispatch.log` | `~/.aleph/factory/dispatch.log` | Output of detached dispatch, intake, director and suite | `jobs/lib/transitions/launch.ts` | A person, `jobs/cli.testkit.ts` (test failure dump) |
| Job folders | `~/.aleph/jobs/<n>/` | The files of one job; `log.txt` holds its command, setup, stderr, dispatch, checks and land sections | The unit, the checks and the land | The UI job page, `postTrace`. The `dispatch` section holds the output of the dispatch that the job ending starts (`jobs/lib/roles/unit.ts`) |

The vault also logs its own writes in `daily/<date>.md` (`appendDaily` in `vault/lib/vault.ts`). [Vault](vault.md) describes it.

## Event log

An event has the 6 fields of `Event` in `lib/naming.ts`: `seq`, `time`, `subject`, `action`, `object` and `detail`; a start's event and a routed event also have a `size`, the Size the factory routed it to. [Naming](naming.md#events) defines the words. `event()` in `lib/naming.ts` checks `subject` and `action` against their sets, so a bad word throws. `logEvent` inserts one row into the `events` table of `aleph.db`. A row never changes. `readEvents` in `lib/layout.ts` reads the view `event_rows` from `since` on, in `seq` order. No code writes the event log by any other means.

### Who writes events

Code calls `logEvent` directly, and the helper `logAlways` in `jobs/lib/asks/ask.ts` wraps it for the Always rules. The table names each writer's file; search it for `logEvent(` to find the line.

| `subject` | Action (detail) | Logged at |
|---|---|---|
| `gate` | A run's state: `running`, `waiting`, `passed`, `returned`, `failed`, `landed`, `dropped`, `done` | `jobs/lib/records/record.ts` |
| `gate` | `question` when an Ask is set (its detail the reason, and its facts when the factory counted some), `answered` when it is cleared | `jobs/lib/records/record.ts` |
| `gate` | `held`, one for an issue hold when its detail changes. [Naming](naming.md#model-work-tracking) has the detail form and which issues get none. The loop guard writes only its Ask as a `question` event whose detail adds its facts (`no-commit: 3 / 3 jobs with no commit`) | `jobs/lib/gates/holds.ts`, from `jobs/lib/transitions/dispatch.ts` |
| `gate` | `changed` on the object `settings`, when the live cap (`cap: on: 5 / 5 jobs`, `cap: on: 1 / 1 local jobs`, `cap: off`) or the held backend (`credit: on: claude: <the call's line>`, `credit: off`) starts or ends; a gate that stays on logs nothing more | `jobs/lib/gates/gpu.ts`, `jobs/lib/gates/holds.ts` |
| `rule` | `routed`, its `size` the classifier's Size and its `detail` the classifier model (`classifier: <model>`), on the issue key. An old routed event has no `size` and the free-text detail `medium by classifier <model>` | `jobs/lib/routing/route.ts` |
| `rule` | `started`, `busy`, `done`, `failed` (`error`) for the dispatch steps | `jobs/lib/transitions/dispatch.ts`, `jobs/lib/transitions/sweep.ts`, `jobs/lib/transitions/factory.ts`, `jobs/lib/transitions/report.ts` |
| `rule` | `started` for a run, with the model | `jobs/lib/transitions/transitions.ts` |
| `rule` | `missed` for a stalled key (its object the issue or job, its detail the step that did not move: `start`, `land`, `intake`, `Ask`, `rescue`, `rerun`), `started` (`check`) for a suite on a moved main, `failed` (`error`) for a tick step | `jobs/lib/transitions/tick.ts` |
| `rule` | `gpu`, when the GPU slot stays taken and the call falls back | `jobs/lib/roles/agent-call.ts` |
| `rule` | `failed` for a filing, a detached start, a land start, a job diff, a UI read | `jobs/lib/transitions/filing.ts`, `jobs/lib/transitions/launch.ts`, `jobs/lib/roles/unit.ts`, `jobs/lib/records/jobdiff.ts`, `ui/state.ts` |
| `rule` | What an Always rule or an Ask timeout did: `answered`, `reran`, `done`, `dropped`, `landed`, `failed` | `logAlways` in `jobs/lib/asks/ask.ts`, called from `jobs/lib/roles/intake.ts`, `jobs/lib/land/rescue.ts`, `jobs/lib/asks/timeout.ts`, `issues/lib/issues.ts` |
| `firefighter` | `reran`, `red`, `changed`, `failed` for red CI and slow lands | `jobs/lib/roles/firefighter.ts` |
| `firefighter` | `waiting`, `busy`, `failed` (`rescue`) for a rescue of a slow land | `jobs/lib/land/rescue.ts` |
| `director` | The action of each applied decision: `landed`, `dropped`, `done`, `changed`, `answered`, `escalated` (with `to: human`) | `jobs/lib/roles/director.ts` |
| `director` | `failed`, when a case text or a decision fails | `jobs/lib/roles/director.ts` |
| `intake` | `skipped` (`intake`) for an issue that intake skips | `jobs/lib/transitions/factory.ts` |
| the filer: `intake`, `firefighter`, `human`, `claude`, `worker` | `filed`, one event per new issue | `lib/store.ts` |
| the closer: `human`, `claude`, `worker` (set by `actor()`), `rule`, `firefighter`, `director`, `intake` | `done` or `dropped`, one event per issue that a write closes, with its `closed_why` as the detail | `logClosed` in `lib/store.ts` |
| `human` | `changed`, when an Always rule is set back to Ask me | `jobs/lib/asks/ask.ts` |
| `human` | `changed` on the object `settings`: `pause: on` and `pause: off`, from the pause and resume commands | `jobs/lib/gates/pause.ts`, through `logSetting` in `lib/layout.ts` |

The set `ACTORS` in `lib/naming.ts` also holds `worker`, `reviewer`, `check` and `monitor`. No `logEvent` call uses `reviewer`, `check` or `monitor`. `worker` and `claude` appear only as the filer or closer of an issue. An issue's events have the object `issue.<n>`.

## Events that decide a job's next step

The events of one job or issue are the rows of `events` with that key as `object`. The code that decides the next step reads them with `eventsOf` in `lib/layout.ts`. No other record holds them.

| Action | Read for | Reader |
|---|---|---|
| `held`, `started` | The last hold of an issue, and whether a start ended it | `jobs/lib/gates/holds.ts` |
| `question` | The Ask reason of the last question | `jobs/lib/gates/factory-status.ts` |
| `started` | Whether a start came after the run cap set an Ask | `jobs/lib/gates/factory-status.ts` |
| `reran`, `started` | The rerun note, which the next `started` event clears | `jobs/lib/transitions/continuation.ts` |

A rescue is the field `rescued` on the job row, not an event.

## Langfuse

Tracing is off without keys. Every post is best effort: a failure is logged to stderr, or for a factory post to the job folder's `log.txt`, and changes nothing else.

| Trace | Writer |
|---|---|
| Turn, one per prompt, in one session per Claude session | `hooks/obs.ts` |
| `verify-gate` span on the turn, and the score `verified` | `hooks/lib/gate.ts` |
| Score `rating` | `hooks/obs.ts`, `hooks/lib/rating.ts` |
| Factory run, named `factory <name>` | `postTrace` in `jobs/lib/learning/trace.ts`, called from `jobs/lib/roles/unit.ts` |

[Langfuse](langfuse.md#what-a-trace-holds) has what each trace holds and the value of each score.

A failed factory post appends one line to the `dispatch` section of `log.txt` in the job folder (`jobs/lib/learning/trace.ts`). The `event` spans of a turn also cover `PreCompact`, `PostCompact`, `PermissionDenied` and `SessionEnd`.

## Readers

| Reader | Reads | Where |
|---|---|---|
| Herald | The last 24 hours of the event log, newest 50 | `ui/state.ts` |
| Automation page | The event log, minus `by: gate` events (the run's state changes), and the job records | `ui/api/gates.ts` |
| Status page | The firefighter's events of the last 24 hours | `jobs/lib/gates/factory-status.ts` |
| `/api/events` | A server-sent stream. Each row added to `events` goes out as an `ev` event, read by `eventsAfter` and not by `readEvents` | `ui/api/events.ts` |
| The updater | Polls `PRAGMA data_version` of `aleph.db` every 100 ms on its own connection. A new event row changes the source `events`, and the updater rebuilds the keys that read it. The UI's own writes move `data_version` too, because the poll has its own connection. A write with no event (usage, tick, a job row) waits for the quiet refresh timer. `change` names only the keys whose rebuilt answer differs | `ui/updater.ts` |
| Director | The `director` events of the job records, for its decision list | `readRecord` in `jobs/lib/roles/director.ts` |
| Monitor | The records, the holds, the flake list, the usage rows | `jobs/lib/learning/monitor-table.ts` |
| `aleph report` | The runs not yet shown, the health lines, the flake lines and the newest monitor report. It does not read the event log | `cli/commands.ts` |

## Where stores overlap

- **Job state.** The job row in the `jobs` table of `aleph.db` is the truth. The `gate` events copy each state change, with its cost, so a reader that wants the history reads the log. The log cannot rebuild a job row.
- **Holds.** A new hold writes one `held` event. A hold that repeats the last one writes none.
- **Asks.** `issue_state.ask` in `aleph.db` is the truth. The log events `question` and `answered` copy each change.
- **Director decisions.** The `decision` field of the director's job row holds the whole `Decision`. The log events by `director` hold the applied actions, one per action.
- **Issues.** The items repo is the truth for an issue's status. The log events `filed`, `done` and `dropped` only mark when it happened.
- **Turns and runs.** Langfuse holds the turn and the run transcript. The event log holds none of that, and the run folder keeps the raw logs the factory trace is built from.

## Retention

`retain` in `jobs/lib/infra/retention.ts` runs in the tick and keeps 90 days (`KEEP_DAYS`).

| Store | Kept |
|---|---|
| Event log, job records | Forever |
| Run folders | Deleted 90 days after the run ended, when its record is archived. A folder that no record holds goes after 90 days with no change |
| `usage` table | Rows older than 90 days are dropped |
| `dispatch.log`, `housekeeper.log` | Moved to `dispatch.<day>.log` and `housekeeper.<day>.log` each day. A day file older than 90 days is deleted |
| `openrouter`, `jev` and `suite_history` tables | Forever |
