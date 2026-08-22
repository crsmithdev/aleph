# Event kinds

**Generated from `src/core/envelope.ts` — do not edit.** Regenerate with
`bun scripts/gen-events-doc.ts`; `bun run docs:check` fails if this file is stale.

Every event carries the envelope of `docs/design/phase-1.md` §5.2: `v`, `id`, `ts`,
`kind`, `ids` (the tuple), `caused_by`, `cause`, `payload`, `actor`. The columns below
describe only the per-kind `payload`.

39 kinds in 9 groups.

## bus

| Kind | Payload |
|---|---|
| `bus.duplicate` | `job_id`: string, `lane`: string |
| `bus.finished` | `job_id`: string, `lane`: string, `ok`: boolean, `ms`: number, `error`?: string |
| `bus.parked` | `job_id`: string, `lane`: string, `until`?: string, `reason`: string |
| `bus.rejected` | `job_id`: string, `lane`: string, `reason`: string, `share_5h`?: number, `share_weekly`?: number, `headroom`?: number |
| `bus.started` | `job_id`: string, `lane`: string, `waited_ms`: number |
| `bus.submitted` | `job_id`: string, `lane`: string, `kind`: string, `queue_depth`: number |

## channel

| Kind | Payload |
|---|---|
| `channel.message_received` | `channel`: string, `message_id`: string, `text`: string, `external`?: record, `rejected`?: string |
| `channel.message_sent` | `channel`: string, `external_id`?: string, `parts`: number, `bytes`: number |
| `channel.send_failed` | `channel`: string, `error`: string, `attempts`: number |
| `channel.topic_created` | `channel`: string, `external_id`: string, `title`: string |

## daemon

| Kind | Payload |
|---|---|
| `daemon.boot_step` | `step`: string, `ok`: boolean, `ms`?: number, `detail`?: string |
| `daemon.config_loaded` | `hash`: string, `sources`: record |
| `daemon.killed` | `signal`: string |
| `daemon.started` | `version`: string, `git_sha`?: string, `config_hash`: string, `pid`: number |
| `daemon.stopped` | `reason`: string, `uptime_ms`: number, `in_flight`: number |
| `daemon.tick` | `tasks_ok`: number, `tasks_failed`: number |
| `daemon.tick_failed` | `task`: string, `error`: string |

## event

| Kind | Payload |
|---|---|
| `event.unregistered_kind` | `kind`: string |

## meter

| Kind | Payload |
|---|---|
| `meter.usage_recorded` | `lane`: string, `model`: string, `tier`: string, `input_tokens`: number, `output_tokens`: number, `cache_read_tokens`: number, `cache_creation_tokens`: number, `weighted`: number, `cost_usd`?: number, `source`: string |
| `meter.window_exhausted` | `window`: string, `observed_weighted`: number, `capacity`: number, `detected_by`: string |
| `meter.window_threshold` | `window`: string, `crossing`: string, `share`: number |

## obs

| Kind | Payload |
|---|---|
| `obs.export_failed` | `endpoint`: string, `error`: string, `dropped`: number |
| `obs.join_audit` | `since`: string, `orphans`: number, `baseline`: number, `delta`: number |

## routing

| Kind | Payload |
|---|---|
| `routing.decided` | `class`: string, `tier`: string, `model`: string, `reason`: string |
| `routing.escalated` | `class`: string, `from_tier`: string, `to_tier`: string, `failures`: number |

## session

| Kind | Payload |
|---|---|
| `session.archived` | `session_id`: string, `idle_days`: number |
| `session.checkpointed` | `session_id`: string, `turn_count`: number, `brief_path`: string |
| `session.created` | `session_id`: string, `topic_key`: string, `title`: string, `channel`: string |
| `session.rehydrated` | `session_id`: string, `idle_ms`: number, `seeded_with`: array |
| `session.resumed` | `session_id`: string, `sdk_session_id`: string, `idle_ms`: number |
| `session.topic_corrected` | `from_session`: string, `to_session`: string, `event_id`: string |
| `session.topic_inferred` | `decision`: string, `title`?: string, `alternatives`: array, `confidence`?: number, `rule`: string |
| `session.turn_completed` | `session_id`: string, `turn_id`: string, `ms`: number, `reply_chars`: number, `input_tokens`: number, `output_tokens`: number |
| `session.turn_failed` | `session_id`: string, `turn_id`: string, `error_class`: string, `error`: string |
| `session.turn_started` | `session_id`: string, `turn_id`: string, `resume_mode`: string, `model`: string, `lane`: string |

## vault

| Kind | Payload |
|---|---|
| `vault.commit` | `paths`: array, `sha`: string, `message`: string |
| `vault.commit_failed` | `paths`: array, `step`: string, `error`: string |
| `vault.write_denied` | `path`: string, `reason`: string |
| `vault.written` | `path`: string, `bytes`: number, `sha256`: string, `mode`: string |
