# Observability

This page lists what aleph records about itself, where each record goes, who writes it and who reads it. Each store has its own page for detail: [Naming](naming.md#events) for the event words, [Data model](data-model.md) for the files, [Langfuse](langfuse.md) for traces.

## Stores

| Store | Path | Holds | Writer | Readers |
|---|---|---|---|---|
| Event log | `events` table in `~/.aleph/aleph.db` | One row per event | `logEvent` in `lib/layout.ts` | Herald, Gates page, Status page, `/api/events` stream |
| Job rows | `jobs` table of `aleph.db` | One row for each job: its state, its fields and its `extra` | `makeJob`, `setState`, `endRun` and `patchRun` in `jobs/lib/records/record.ts` | The factory, the director, the monitor |
| Turn traces | Langfuse | One trace per Claude Code turn | `hooks/obs.ts`, `hooks/lib/gate.ts` | Langfuse UI, `ui/api/sessions.ts`, `jobs/lib/learning/corrections.ts`, `ui/usage.ts` |
| Factory traces | Langfuse | One trace per factory run | `postTrace` in `jobs/lib/learning/trace.ts` | Langfuse UI, `jobs/lib/learning/episode.ts` |
| `usage` table | `aleph.db` | The account's weekly plan usage, one row per 10 minutes | `ui/usage.ts:91` | `ui/usage.ts`, the monitor table |
| `openrouter` table | `aleph.db` | What OpenRouter bills per list dollar | `ui/usage.ts:219` | `ui/usage.ts` |
| `jev` table | `aleph.db` | The `time` and `cost` of each Jev call | `lib/jev.ts:56` | `ui/usage.ts` |
| `episode-use.jsonl` | `~/.aleph/factory/episode-use.jsonl` | Each time recall shows or opens an episode page | `logUse` in `lib/episode-use.ts` | Episode eviction (`jobs/lib/learning/episode.ts:215`) |
| `suite_history` table | `aleph.db` | One row per suite run | `appendSuiteHistory` in `jobs/lib/gates/tables.ts` | `suiteHistory`, the monitor |
| `dispatch.log` | `~/.aleph/factory/dispatch.log` | Output of detached dispatch, intake, director and suite | `jobs/lib/transitions/launch.ts:113` | A person, `jobs/cli.testkit.ts:114` (test failure dump) |
| Job folders | `~/.aleph/jobs/<n>/` | The files of one job; `log.txt` holds its command, setup, stderr, dispatch, checks and land sections | The unit, the checks and the land | The UI job page, `postTrace`. The `dispatch` section holds the output of the dispatch that the job ending starts (`jobs/lib/roles/unit.ts`) |

The vault also logs its own writes in `daily/<date>.md` (`appendDaily` in `vault/lib/vault.ts:140`). [Vault](vault.md) describes it.

## Event log

An event has the 6 fields of `Event` in `lib/naming.ts:138`: `seq`, `time`, `subject`, `action`, `object` and `detail`; a start's event also has a `tier`, the Size the factory routed it to. [Naming](naming.md#events) defines the words. `event()` in `lib/naming.ts:146` checks `subject` and `action` against their sets, so a bad word throws. `logEvent` inserts one row into the `events` table of `aleph.db`. A row never changes. `readEvents` in `lib/layout.ts:41` reads the view `event_rows` from `since` on, in `seq` order. No code writes the event log by any other means.

### Who writes events

The count is 53 direct `logEvent(` calls in code that is not a test, and one helper, `logAlways` in `jobs/lib/asks/ask.ts:244`, that eight call sites use.

| `subject` | Action (detail) | Logged at |
|---|---|---|
| `gate` | A run's state: `running`, `waiting`, `passed`, `returned`, `failed`, `landed`, `dropped`, `done` | `jobs/lib/records/record.ts:181` |
| `gate` | `question` when an Ask is set (its detail the reason, and its facts when the factory counted some), `answered` when it is cleared | `jobs/lib/records/record.ts:335`, `:336` |
| `gate` | `held`, one for an issue hold when its detail changes: the detail is the hold word and then its facts (`after: issue.2985 issue.2993`, `job: job.8910`, `file: docs/design.md: job.8890`, `red: at 298a44e: tests`, `credit: job.8870 hit the API credit error`). A done or dropped issue gets none. The pause, the backend and the live cap write none: each logs its own `changed` event on `settings`; the loop guard writes only its Ask as a `question` event whose detail adds its facts (`no-commit: 3 / 3 jobs with no commit`) | `jobs/lib/gates/holds.ts:52`, from `jobs/lib/transitions/factory.ts:102` |
| `gate` | `changed` on the object `settings`, when the live cap (`cap: on: 5 / 5 jobs`, `cap: on: 1 / 1 local jobs`, `cap: off`) or the held backend (`credit: on: claude: <the call's line>`, `credit: off`) starts or ends; a gate that stays on logs nothing more | `jobs/lib/gates/gpu.ts:17`, `jobs/lib/gates/holds.ts:92`, `:102` |
| `rule` | `routed`, its `detail` the Size and the classifier model (`medium by classifier <model>`), on the issue key | `jobs/lib/routing/route.ts:28` |
| `rule` | `started`, `busy`, `done`, `failed` (`error`) for the dispatch steps | `jobs/lib/transitions/factory.ts:79`, `:152`, `:156`, `:190`, `:213`, `:221`, `:305`, `:519`, `:580` |
| `rule` | `started` for a run, with the model | `jobs/lib/transitions/transitions.ts:369` |
| `rule` | `missed` for a stalled key, `started` (`check`) for a suite on a moved main, `failed` (`error`) for a tick step | `jobs/lib/transitions/tick.ts:179`, `:188`, `:244` |
| `rule` | `gpu`, when the GPU slot stays taken and the call falls back | `jobs/lib/roles/agent-call.ts:137` |
| `rule` | `failed` for a filing, a detached start, a land start, a job diff, a correction, a UI read | `jobs/lib/transitions/filing.ts:27`, `jobs/lib/transitions/launch.ts:89`, `jobs/lib/roles/unit.ts:90`, `jobs/lib/records/jobdiff.ts:48`, `jobs/lib/learning/corrections.ts:16`, `ui/state.ts:39` |
| `rule` | What an Always rule or an Ask timeout did: `answered`, `reran`, `done`, `dropped`, `landed`, `failed` | `logAlways` in `jobs/lib/asks/ask.ts:244`, called from `jobs/lib/roles/intake.ts`, `jobs/lib/land/rescue.ts:344`, `jobs/lib/asks/timeout.ts:111`, `jobs/lib/learning/corrections.ts`, `issues/lib/store.ts` |
| `firefighter` | `reran`, `red`, `changed`, `failed` for red CI and slow lands | `jobs/lib/gates/firefighter.ts:217` to `:244` |
| `firefighter` | `waiting`, `busy`, `failed` (`rescue`) for a rescue of a slow land | `jobs/lib/land/rescue.ts:113` to `:405` |
| `director` | The action of each applied decision: `landed`, `dropped`, `done`, `changed`, `answered`, `escalated` (with `to: human`) | `jobs/lib/roles/director.ts:151` |
| `director` | `failed`, when a case text or a decision fails | `jobs/lib/roles/director.ts:648`, `:730`, `:733` |
| `intake` | `skipped` (`intake`) for an issue that intake skips | `jobs/lib/transitions/factory.ts:573` |
| the filer: `intake`, `firefighter`, `human`, `claude`, `worker` | `filed`, one event per new issue | `issues/lib/store.ts:598` |
| the closer: `human`, `claude`, `worker` (set by `actor()`), `rule`, `firefighter`, `director`, `intake` | `done` or `dropped`, one event per issue that a write closes, with its `closed_why` as the detail | `logClosed` in `issues/lib/store.ts:172` |
| `human` | `changed`, when an Always rule is set back to Ask me | `jobs/lib/asks/ask.ts:234` |
| `human` | `changed` on the object `settings`: `pause: on` and `pause: off`, from the pause and resume commands | `jobs/lib/gates/pause.ts:12`, through `logSetting` in `lib/layout.ts:38` |

The set `ACTORS` in `lib/naming.ts:22` also holds `worker`, `reviewer`, `check` and `monitor`. No `logEvent` call uses `reviewer`, `check` or `monitor`. `worker` and `claude` appear only as the filer or closer of an issue. An issue's events have the object `issue.<n>`.

## Job record events

The events of one job or issue are the rows of `events` with that key as `object`. The code that decides the next step of a job reads them with `eventsOf` in `lib/layout.ts`.

| `kind` | Written when | Writer |
|---|---|---|
| `hold` | A new hold is written. `data.gate` is the gate, and `data.event` is the log event | `jobs/lib/gates/holds.ts:45` |
| `started` | A hold ends because the job starts | `jobs/lib/gates/holds.ts:45` |
| `asked` | A worker or reviewer asks. `data.spec` holds the spec version | `jobs/lib/asks/ask.ts:281` |
| `streak` | The no-commit streak sets an Ask | `jobs/lib/gates/factory-status.ts:225` |
| `cap`, `cap-cleared` | The run cap sets an Ask, and a later start clears it | `jobs/lib/gates/factory-status.ts:239` |
| `rerun`, `rerun-cleared` | A rerun note is set, and the run that takes it starts | `jobs/lib/transitions/continuation.ts:130`, `:139` |
| `rescued` | A slow land was rescued | `jobs/lib/transitions/continuation.ts:276` |
| `director` | A director decision. `data` is the `Decision` | `jobs/lib/roles/director.ts:146` |
| `timeout` | An Ask timeout acted | `jobs/lib/asks/timeout.ts:111` |

## Langfuse

Tracing is off without keys. Every post is best effort: a failure is logged to stderr or to `trace.log`, and changes nothing else.

| Trace | What it holds | Writer |
|---|---|---|
| Turn, one per prompt, in one session per Claude session | A root `turn` span, then `tool`, `agent` (subagent), `generation` (one per API request) and `event` spans | `hooks/obs.ts:102` to `:263` |
| `verify-gate` span on the turn | A `guardrail` span with the verdict, the kind and the judge time. It is posted unless the kind is `unchanged` | `hooks/lib/gate.ts:94` |
| Score `verified` | 1 pass, 0 deny, 0.5 forced pass | `hooks/lib/gate.ts:107` |
| Score `rating` | `N` of an `N/10` in a prompt, on the previous turn | `hooks/obs.ts:227`, `hooks/lib/rating.ts` |
| Factory run, named `factory <name>` | A worker tree and, when there was a review, a reviewer tree | `postTrace` in `jobs/lib/learning/trace.ts:118`, called from `jobs/lib/roles/unit.ts` |

A failed factory post appends one line to the `dispatch` section of `log.txt` in the job folder (`jobs/lib/learning/trace.ts:131`). The `event` spans of a turn also cover `PreCompact`, `PostCompact`, `PermissionDenied` and `SessionEnd`.

## Readers

| Reader | Reads | Where |
|---|---|---|
| Herald | The last 24 hours of the event log, newest 50 | `ui/state.ts:80` |
| Gates page | The event log, minus `by: gate` events (the run's state changes), and the job records | `ui/api/gates.ts:98` |
| Status page | The firefighter's events of the last 24 hours | `jobs/lib/gates/factory-status.ts:134` |
| `/api/events` | A server-sent stream. Each row added to `events` goes out as an `ev` event, read by `eventsAfter` and not by `readEvents` | `ui/api/events.ts:38` |
| The updater | Polls `PRAGMA data_version` of `aleph.db` every 100 ms on its own connection. A new event row changes the source `events`, and the updater rebuilds the keys that read it. The UI's own writes move `data_version` too, because the poll has its own connection. A write with no event (usage, tick, a job row) waits for the quiet refresh timer. `change` names only the keys whose rebuilt answer differs | `ui/updater.ts:293` |
| Director | The `director` events of the job records, for its decision list | `readRecord` in `jobs/lib/roles/director.ts` |
| Monitor | The records, the holds, the flake list, the usage rows | `jobs/lib/learning/monitor-table.ts:318` |
| `aleph report` | The runs not yet shown, the health lines, the flake lines and the newest monitor report. It does not read the event log | `jobs/commands.ts:427` |

## Where stores overlap

- **Run state.** The job record's `runs[]` is the truth. The `gate` events of the event log copy each state change, with its cost, so a reader that wants the history reads the log. The log cannot rebuild a record.
- **Holds.** A new hold writes a `hold` record event and a `gate` log event, once. `data.event` keeps the log event inside the record event. A hold that repeats the last one writes neither.
- **Asks.** The record's `ask` and `asks[]` are the truth. The log events `question` and `answered` copy each change.
- **Director decisions.** The `director` record event holds the whole `Decision`. The log events by `director` hold the applied actions, one per action.
- **Issues.** The work store is the truth for an issue's status. The log events `filed`, `done` and `dropped` only mark when it happened.
- **Turns and runs.** Langfuse holds the turn and the run transcript. The event log holds none of that, and the run folder keeps the raw logs the factory trace is built from.

## Retention

`retain` in `jobs/lib/infra/retention.ts` runs in the tick and keeps 90 days (`KEEP_DAYS`).

| Store | Kept |
|---|---|
| Event log, job records | Forever |
| Run folders | Deleted 90 days after the run ended, when its record is archived. A folder that no record holds goes after 90 days with no change |
| `usage` table | Rows older than 90 days are dropped |
| `dispatch.log`, `housekeeper.log` | Moved to `dispatch.<day>.log` and `housekeeper.<day>.log` each day. A day file older than 90 days is deleted |
| `episode-use.jsonl` | Lines older than 90 days are dropped (`jobs/lib/learning/episode.ts:215`) |
| `openrouter`, `jev` and `suite_history` tables | Forever |
