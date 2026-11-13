# Observability

This page lists what aleph records about itself, where each record goes, who writes it and who reads it. Each store has its own page for detail: [Naming](naming.md#events) for the event words, [Data model](data-model.md) for the files, [Langfuse](langfuse.md) for traces.

## Stores

| Store | Path | Holds | Writer | Readers |
|---|---|---|---|---|
| Event log | `~/.aleph/factory/events/<UTC day>.jsonl` | One event per line | `logEvent` in `lib/layout.ts` | Herald, Gates page, Status page, `/api/events` stream |
| Job record `events[]` | `~/.aleph/jobs/<key>.json` | What happened to one job | `addEvent` and `update` in `jobs/lib/records/record.ts` | The factory, the director, the monitor |
| Turn traces | Langfuse | One trace per Claude Code turn | `hooks/obs.ts`, `hooks/lib/gate.ts` | Langfuse UI, `ui/api/sessions.ts`, `jobs/lib/learning/corrections.ts`, `ui/usage.ts` |
| Factory traces | Langfuse | One trace per factory run | `postTrace` in `jobs/lib/learning/trace.ts` | Langfuse UI, `jobs/lib/learning/episode.ts` |
| `usage.jsonl` | `~/.aleph/usage.jsonl` | The account's weekly plan usage, one row per 10 minutes | `ui/usage.ts:95` | `ui/usage.ts`, the monitor table |
| `openrouter.jsonl` | `~/.aleph/openrouter.jsonl` | What OpenRouter bills per list dollar | `ui/usage.ts:234` | `ui/usage.ts` |
| `jev.jsonl` | `~/.aleph/jev.jsonl` | `{at, cost}` of each Jev call | `lib/jev.ts:61` | `ui/usage.ts` |
| `episode-use.jsonl` | `~/.aleph/factory/episode-use.jsonl` | Each time recall shows or opens an episode page | `logUse` in `lib/episode-use.ts` | Episode eviction (`jobs/lib/learning/episode.ts:182`) |
| `suite-history.jsonl` | `~/.aleph/factory/suite-history.jsonl` | One line per suite run | `appendSuiteHistory` in `jobs/lib/gates/factory-status.ts` | `suiteHistory`, the monitor |
| `dispatch.log` | `~/.aleph/factory/dispatch.log` | Output of detached dispatch, intake, director and suite | `jobs/lib/transitions/launch.ts:113` | A person, `jobs/cli.helpers.ts:114` (test failure dump) |
| Run folders | `~/.aleph/runs/<run>/` | The logs of one run | The unit, the checks and the land | The UI job page, `postTrace`. `dispatch.log` in the folder holds the output of the dispatch that the run ending starts (`jobs/lib/roles/unit.ts:228`) |

The vault also logs its own writes in `daily/<date>.md` (`appendDaily` in `vault/lib/vault.ts:121`). [Vault](vault.md) describes it.

## Event log

An event has the fields of `Event` in `lib/naming.ts:111`. [Naming](naming.md#events) defines the words. `event()` in `lib/naming.ts:115` checks `by`, `action`, `sub`, `result` and `to` against their sets, so a bad word throws. `logEvent` appends the event to the file of its UTC day. A day before today never changes. `readEvents` in `lib/layout.ts:51` reads only the day files from `since` on. No code writes the event log by any other means.

### Who writes events

The count is 53 direct `logEvent(` calls in code that is not a test, and one helper, `logAlways` in `jobs/lib/asks/ask.ts:244`, that seven call sites use.

| `by` | Action (sub) | Logged at |
|---|---|---|
| `gate` | A run's state: `running`, `waiting`, `passed`, `returned`, `failed`, `landed`, `dropped`, `done` | `jobs/lib/records/record.ts:182` |
| `gate` | `question` when an Ask is set, `answered` when it is cleared | `jobs/lib/records/record.ts:168` |
| `gate` | A hold when a new one is written: `paused`, `red`, `after`, `full`, `busy`, `looping`, `credit`, `waiting`, `running` and others | `jobs/lib/gates/factory-status.ts:71`, from `jobs/lib/transitions/factory.ts:91` and `:136` |
| `gate` | `refused` (`contradiction`) when the contradiction screen refuses a `vault write` | `vault/lib/ops.ts:234` |
| `rule` | `routed`, with `tier`, `model`, `p` and `cost` | `jobs/lib/routing/route.ts:30` |
| `rule` | `paused`, `started`, `busy`, `done`, `failed` (`error`) for the dispatch steps | `jobs/lib/transitions/factory.ts:70`, `:74`, `:112`, `:142`, `:146`, `:182`, `:190`, `:275`, `:484`, `:538` |
| `rule` | `started` for a run, with the model | `jobs/lib/transitions/transitions.ts:363` |
| `rule` | `missed` for a stalled key, `started` (`check`) for a suite on a moved main, `failed` (`error`) for a tick step | `jobs/lib/transitions/tick.ts:156`, `:165`, `:219` |
| `rule` | `paused` (`credit`) when a backend is held, `reran` when it answers again | `jobs/lib/gates/factory-status.ts:119`, `:129` |
| `rule` | `gpu`, when the GPU slot stays taken and the call falls back | `jobs/lib/roles/agent-call.ts:120` |
| `rule` | `failed` for a filing, a detached start, a land start, a job diff, a correction, a UI read | `jobs/lib/transitions/filing.ts:29`, `jobs/lib/transitions/launch.ts:89`, `jobs/lib/roles/unit.ts:101`, `jobs/lib/records/jobdiff.ts:47`, `jobs/lib/learning/corrections.ts:17`, `ui/state.ts:36` |
| `rule` | What an Always rule or an Ask timeout did: `answered`, `reran`, `done`, `dropped`, `landed`, `failed` | `logAlways` in `jobs/lib/asks/ask.ts:244`, called from `jobs/lib/roles/intake.ts`, `jobs/lib/land/rescue.ts:259`, `jobs/lib/asks/timeout.ts:105`, `jobs/lib/learning/corrections.ts` |
| `firefighter` | `reran`, `red`, `changed`, `failed` for red CI and slow lands | `jobs/lib/gates/firefighter.ts:217` to `:244` |
| `firefighter` | `waiting`, `busy`, `failed` (`rescue`) for a rescue of a slow land | `jobs/lib/land/rescue.ts:111` to `:320` |
| `director` | The action of each applied decision: `landed`, `dropped`, `done`, `changed`, `answered`, `escalated` (with `to: human`) | `jobs/lib/roles/director.ts:144` |
| `director` | `failed`, when a case text or a decision fails | `jobs/lib/roles/director.ts:634`, `:704`, `:707` |
| `intake` | `skipped` (`intake`) for an issue that intake skips | `jobs/lib/transitions/factory.ts:531` |
| the filer: `intake`, `firefighter`, `human`, `claude`, `worker` | `filed`, one event per new issue | `issues/lib/store.ts:388` |
| `human`, `claude`, `worker` (set by `actor()`) | `done` or `dropped` when `close` closes an issue | `issues/lib/issues.ts:256` |
| `human` | `changed`, when an Always rule is set back to Ask me | `jobs/lib/asks/ask.ts:237` |

The set `ACTORS` in `lib/naming.ts:19` also holds `worker`, `reviewer`, `check` and `monitor`. No `logEvent` call uses `reviewer`, `check` or `monitor`. `worker` and `claude` appear only as the filer or closer of an issue.

## Job record events

`JobEvent` in `jobs/lib/records/record.ts:28` is `{at, kind, what, run?, data?}`. It tells what happened to one job, in order, for the code that decides its next step.

| `kind` | Written when | Writer |
|---|---|---|
| `hold` | A new hold is written. `data.gate` is the gate, and `data.event` is the log event | `jobs/lib/gates/factory-status.ts:72` |
| `started` | A hold ends because the job starts | `jobs/lib/gates/factory-status.ts:72` |
| `asked` | A worker or reviewer asks. `data.spec` holds the spec version | `jobs/lib/asks/ask.ts:287` |
| `streak` | The no-commit streak sets an Ask | `jobs/lib/gates/factory-status.ts:462` |
| `cap`, `cap-cleared` | The run cap sets an Ask, and a later start clears it | `jobs/lib/gates/factory-status.ts:483`, `:488` |
| `rerun`, `rerun-cleared` | A rerun note is set, and the run that takes it starts | `jobs/lib/transitions/continuation.ts:131`, `:139` |
| `rescued` | A slow land was rescued | `jobs/lib/transitions/continuation.ts:279` |
| `director` | A director decision. `data` is the `Decision` | `jobs/lib/roles/director.ts:139` |
| `timeout` | An Ask timeout acted | `jobs/lib/asks/timeout.ts:103` |

## Langfuse

Tracing is off without keys. Every post is best effort: a failure is logged to stderr or to `trace.log`, and changes nothing else.

| Trace | What it holds | Writer |
|---|---|---|
| Turn, one per prompt, in one session per Claude session | A root `turn` span, then `tool`, `agent` (subagent), `generation` (one per API request) and `event` spans | `hooks/obs.ts:102` to `:263` |
| `verify-gate` span on the turn | A `guardrail` span with the verdict, the kind and the judge time. It is posted unless the kind is `unchanged` | `hooks/lib/gate.ts:94` |
| Score `verified` | 1 pass, 0 deny, 0.5 forced pass | `hooks/lib/gate.ts:107` |
| Score `rating` | `N` of an `N/10` in a prompt, on the previous turn | `hooks/obs.ts:227`, `hooks/lib/rating.ts` |
| Factory run, named `factory <name>` | A worker tree and, when there was a review, a reviewer tree | `postTrace` in `jobs/lib/learning/trace.ts:117`, called from `jobs/lib/roles/unit.ts` |

A failed factory post appends one line to `trace.log` in the run folder (`jobs/lib/learning/trace.ts:128`). The `event` spans of a turn also cover `PreCompact`, `PostCompact`, `PermissionDenied` and `SessionEnd`.

## Readers

| Reader | Reads | Where |
|---|---|---|
| Herald | The last 24 hours of the event log, newest 50 | `ui/state.ts:487` |
| Gates page | The event log, minus `by: gate` events (the run's state changes), and the job records | `ui/api/gates.ts:85` |
| Status page | The firefighter's events of the last 24 hours | `jobs/lib/gates/factory-status.ts:380` |
| `/api/events` | A server-sent stream. Each line added to a day file goes out as an `ev` event, read by the file tail and not by `readEvents` | `ui/api/events.ts:42` |
| The updater | Watches `factory/events/` and rebuilds the keys that depend on it | `ui/updater.ts:290` |
| Director | The `director` events of the job records, for its decision list | `readRecord` in `jobs/lib/roles/director.ts` |
| Monitor | The records, the holds, the flake list, the usage rows | `jobs/lib/learning/monitor-table.ts:318` |
| `aleph report` | The runs not yet shown, the health lines, the flake lines and the newest monitor report. It does not read the event log | `jobs/commands.ts:415` |

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
| `usage.jsonl` | Rows older than 90 days are dropped |
| `dispatch.log` | Moved to `dispatch.<day>.log` each day. A day file older than 90 days is deleted |
| `episode-use.jsonl` | Lines older than 90 days are dropped (`jobs/lib/learning/episode.ts:182`) |
| `openrouter.jsonl`, `jev.jsonl`, `suite-history.jsonl` | Forever |
