# Aleph-next — Phase 1 ("Spine") detailed design

**Status:** implementation design, derived from `aleph-next-design-v1.0.md` §11 Phase 1 and
`cockpit-spec-v0.2.md` §4. The v1.0 design doc is the authority; where this document is more
specific it is *elaboration*, never revision. Anything here that contradicts v1.0 is a bug in
this document.

**Scope of authority:** this document decides the items v1.0 left open to the implementer
(§2 below) and specifies the wire formats, schemas, module boundaries and test plan needed to
build the spine. It does not re-open settled decisions.

---

## 1. What Phase 1 is

From v1.0 §11:

> **Phase 1 — Spine.** Daemon + Telegram (forum topics) + `os` CLI; SDK loop with routing table;
> vault bootstrap (contract, namespaces, git, mount enforcement); episodic log + MEMORY.md +
> checkpointing; event log + OTel → Langfuse from turn one; window-meter accumulators.
> *Outcome: a persistent, traced, remembering agent with the starvation ladder in place.*

### 1.1 In scope

| # | Deliverable | Exit check (§14 has the full plan) |
|---|---|---|
| S1 | Daemon process: bus, lanes, session store, channel adapters, graceful shutdown | `os status` on a live daemon returns lane + window state; SIGTERM drains without losing an in-flight turn |
| S2 | Event log: versioned envelope, `emit()`, append-only JSONL, SQLite index | A turn produces a causally-linked event chain readable by `os events` and by SQL |
| S3 | OTel → Langfuse: one span tree per turn, explicit ID-tuple propagation | OTLP sink receives spans carrying the full tuple; join-audit reports zero unexpected orphans |
| S4 | Telegram forum-group adapter: topic↔session mapping, inbound/outbound | Message in a topic reaches the right session; reply lands in the same topic; new topic creates a session |
| S5 | SDK session lifecycle: spawn / checkpoint / resume / rehydrate / archive | Same-day second message resumes (SDK `resume`); >24h rehydrates from checkpoint and still knows the prior decision |
| S6 | Routing table config: tiers, per-class ceilings, ±1 flex | Changing the table changes the model actually invoked, observed in the event log |
| S7 | Vault bootstrap: layout, `VAULT.md`, `index.md`, `MEMORY.md`, git init, mount plan | `os vault init` produces a committed vault; agent writes land as per-write commits; `human/` is unwritable from a session |
| S8 | Window meter + starvation ladder | A lane below the water line is refused admission with a logged, caused event; interactive headroom is never consumed by background lanes |
| S9 | `os` CLI | Every subcommand in §12 runs against a live daemon |

### 1.2 Explicitly out of scope (later phases, do not build)

Heartbeat and cron (2a). Capture pipeline, whisper, classifier (2a). Syncthing (2a). Librarian,
morning brief, memory promotion gate (2a). Approval broker and security lane (2a) — Phase 1 has
**no autonomous side-effecting tools**, which is what makes deferring the broker safe (§13).
Verification kernel (2b). Cockpit UI (2b) — Phase 1 ships the *event log the cockpit is a view
over*, plus deep links, and nothing else. Research (3). ntfy (2a). Semantic index (4).

### 1.3 The one non-negotiable of Phase 1

Everything after Phase 1 reads the event log. If the envelope schema, the ID tuple, or `emit()`
is wrong, every later phase inherits the mistake and the cockpit is built on sand. Phase 1's real
deliverable is **§5 and §6**; the Telegram bot is the thing that proves they work.

---

## 2. Decisions on the open items

v1.0 left these to the implementer. Decided here; each is flagged for Chris's override.

| Item | Decision | Why |
|---|---|---|
| **Reserved interactive headroom** | **30 %** of the 5-hour window and **25 %** of the weekly window, whichever binds first. Config keys `meter.reserve.window_5h` / `meter.reserve.weekly`. | Proposal accepted. Two reserves because the failure that actually hurts — Thursday-afternoon weekly exhaustion — is invisible to a 5-hour-only reserve. |
| **New-topic inference** | One topic per **distinct project or question**. Inference rule in §8.4; the inference emits `session.topic_inferred` with its reasoning, and Chris's moves/merges emit `session.topic_corrected` — the pair is the calibration dataset. Phase 1 *never* auto-merges topics. | Matches v1.0's "sketch-mode inference is tracked as calibration data" pattern. Reuse the pattern, not just the idea. |
| **Bun vs Node** | **Bun** (≥1.3). `bun:sqlite`, native TS execution, `Bun.serve`, built-in test runner, single-binary `bun build --compile` for the `os` CLI. | Aleph is already Bun; the cockpit spec §9 already names `bun:sqlite`; one less toolchain. Escape hatch: no Bun-only API is used outside `src/platform/`, so a Node port is a re-implementation of one directory. |
| **Config format** | **TOML** for human-edited config (`config/aleph.toml` + `config/<host>.toml` overlay), **Zod**-validated at boot, secrets by `${ENV_VAR}` reference only. | TOML for tables (routing, lanes) without YAML's ambiguity; Zod so a bad config fails at boot with a path, not at 3 a.m. with a `TypeError`. |
| **Envelope / event schema** | §5.2. Versioned (`v: 1`), 9 fixed fields, typed payload per kind, `caused_by` mandatory. | — |
| **SQLite schema** | §5.5 (events index), §7.2 (sessions), §11.3 (meter). One DB, `data/aleph.db`, WAL, litestream. | — |
| **Repo layout** | §3. | — |
| **Brief timing** | **07:00** morning brief, **Sunday 18:00** weekly review, `America/Los_Angeles`, stored as IANA TZ + local time in config (never as UTC — DST would silently shift both). Phase 1 only records these settings; Phase 2a consumes them. | Confirm the TZ. |

Two further decisions this document makes because Phase 1 cannot proceed without them:

- **Time.** All timestamps are RFC3339 UTC with milliseconds (`2026-08-20T21:04:05.123Z`).
  All *scheduling* is TZ-aware local. Never store local time.
- **IDs.** ULID (Crockford base32, 26 chars, lexicographically sortable by mint time) for every
  daemon-minted ID. Prefixed on the wire for greppability: `evt_`, `ses_`, `tsk_`, `run_`,
  `msg_`, `turn_`. Trace/span IDs stay raw W3C hex — they are not ours to prefix.

---

## 3. Repo layout

```
aleph-next/
├── AGENTS.md                  # agent entry point (aleph convention, kept)
├── CLAUDE.md                  # -> AGENTS.md, dev rules for this repo
├── README.md
├── package.json               # single Bun package; no workspaces until a second consumer exists
├── tsconfig.json
├── bunfig.toml
├── .env.example               # names only, never values
├── config/
│   ├── aleph.toml             # committed defaults (no secrets)
│   ├── aleph.example.toml     # documented full surface
│   └── hosts/                 # per-host overlay, gitignored except .gitkeep
├── src/
│   ├── platform/              # the only Bun-specific code (sqlite, serve, spawn, fs)
│   ├── core/
│   │   ├── ids.ts             # ULID, prefixes, tuple type
│   │   ├── clock.ts           # injectable clock — no bare Date.now() outside here
│   │   ├── tracectx.ts        # synthetic remote parent so spans adopt the minted trace id
│   │   ├── redact.ts          # secret filter applied to every payload
│   │   ├── config.ts          # TOML load + Zod validate + env interpolation
│   │   ├── envelope.ts        # event envelope schema + kind registry
│   │   ├── emit.ts            # THE emission helper (§5.4)
│   │   ├── eventlog.ts        # JSONL writer + SQLite index
│   │   ├── bus.ts             # in-process queue, lanes, admission control
│   │   ├── meter.ts           # window accumulators + ladder
│   │   └── errors.ts
│   ├── obs/
│   │   ├── otel.ts            # tracer provider, OTLP exporter, resource
│   │   ├── langfuse.ts        # attribute mapping + deep-link builder
│   │   └── join-audit.ts      # orphan classification (nightly in 2a; CLI now)
│   ├── sessions/
│   │   ├── store.ts           # SQLite session store
│   │   ├── lifecycle.ts       # spawn/resume/rehydrate/checkpoint/archive FSM
│   │   ├── runner.ts          # AgentRunner interface
│   │   ├── sdk-runner.ts      # @anthropic-ai/claude-agent-sdk implementation
│   │   ├── echo-runner.ts     # deterministic test double (no network)
│   │   └── brief.ts           # session-brief.md render/parse
│   ├── channels/
│   │   ├── channel.ts         # Channel interface
│   │   ├── telegram/          # bot API client, long-poll, forum topics, formatting
│   │   └── cli/               # unix-socket channel for `os send`
│   ├── vault/
│   │   ├── bootstrap.ts       # init + templates
│   │   ├── writer.ts          # write + per-write git commit
│   │   ├── git.ts
│   │   └── templates/         # VAULT.md, index.md, MEMORY.md, session-brief.md
│   ├── routing/
│   │   └── router.ts          # tier table, class ceilings, ±1 flex, escalation
│   ├── daemon.ts              # composition root + boot/shutdown
│   └── cli/
│       └── os.ts              # `os` CLI entry
├── tests/
│   ├── unit/
│   ├── integration/           # real files, real sockets, real subprocesses
│   ├── live/                  # real Anthropic / real Telegram — opt-in via env
│   └── helpers/               # fake bot API server, OTLP sink, temp dirs
├── compose/
│   ├── langfuse.yml           # Langfuse v4 self-hosted
│   ├── daemon.yml             # aleph daemon + telegram-bot-api (2a)
│   └── README.md
├── scripts/
│   ├── gen-events-doc.ts      # docs/EVENTS.md generator (CI runs it with --check)
│   ├── check-docs.ts          # docs gate
│   └── otlp-sink.ts           # standalone OTLP sink — Langfuse stand-in for local runs
├── docs/
│   ├── design/phase-1.md      # this file
│   ├── EVENTS.md              # generated kind registry (CI-checked against code)
│   ├── RUNBOOK-phase1-slice.md # observed output of the end-to-end slice
│   └── VERIFICATION.md        # gate table (aleph pattern, seeded for 2b)
└── .github/workflows/ci.yml
```

**Dependency rule (enforced by a test, not a convention):** `core/` imports only `platform/`;
`obs/`, `sessions/`, `channels/`, `vault/`, `routing/` import `core/` and `platform/`; nothing
imports `daemon.ts`. Cycles fail CI. This is what keeps `emit()` callable from everywhere without
`emit()` depending on anything.

---

## 4. Daemon architecture

### 4.1 Process model

One Bun process. Inside it:

```
                    ┌───────────────────────────────────────────┐
  Telegram  ───────►│ channels/*  (adapters, no business logic) │
  os CLI    ───────►│  → normalize to InboundMessage            │
                    └───────────────────┬───────────────────────┘
                                        │ bus.submit(job, lane)
                    ┌───────────────────▼───────────────────────┐
                    │ core/bus  — per-lane queues                │
                    │   admission control ← core/meter           │
                    └───────────────────┬───────────────────────┘
                                        │
                    ┌───────────────────▼───────────────────────┐
                    │ sessions/lifecycle — resolve session,      │
                    │   route model, run turn, checkpoint        │
                    └────┬──────────────────────┬───────────────┘
                         │                      │
              sessions/sdk-runner        vault/writer
              (claude-agent-sdk)         (log/, MEMORY.md, brief)
                         │
                    ┌────▼───────────────────────────────────────┐
                    │ core/emit → eventlog (JSONL + SQLite)      │
                    │           → obs/otel  (OTLP → Langfuse)    │
                    └────────────────────────────────────────────┘
```

Everything crossing a module boundary is a plain serializable object. That is a deliberate
constraint: when Phase 3 moves research workers out of process, the payloads already survive the
move, and `emit()`'s explicit tuple (cockpit §4.2 F1) is already the propagation mechanism rather
than a retrofit.

**Not** a microservice split. One process, in-process queue, SQLite. The scale is one human.

### 4.2 The bus

`bus.submit(job)` where a job is:

```ts
type Job = {
  id: string;              // job_<ulid>
  lane: Lane;              // §4.3
  ids: IdTuple;            // §5.1 — carried, never re-derived
  kind: string;            // 'turn.run' | 'session.checkpoint' | 'vault.commit' | ...
  payload: unknown;
  submitted_at: string;
  deadline_at?: string;    // soft; drives the "parked" event, not a kill
  attempt: number;
};
```

Semantics:

- **Per-lane FIFO, bounded.** Each lane has `max_queue` and `max_concurrent` (config). Overflow
  is not silent: the job is rejected with `bus.rejected` (`reason: "queue_full"`).
- **Per-session serialization.** Jobs carrying the same `session_id` never run concurrently;
  a session is a single-writer resource. This is the whole concurrency story for Phase 1
  (v1.0 §3.2: "one conversational thread per topic").
- **At-least-once with an idempotency key.** `job.id` is recorded in `jobs_done` before the
  effect commits; a replayed job with a recorded id is dropped with `bus.duplicate`.
  Phase 1 has one durable queue consumer (turns) and one crash-visible effect (the SDK call);
  the honest statement is: *a crash mid-turn loses the turn's output, not the event log*. The
  inbound message is re-delivered by Telegram's offset mechanism (§8.3), so the user's message is
  never silently dropped — it is re-run, and the duplicate-detection above keeps the re-run from
  double-posting a reply that already went out.
- **Every state change emits.** `bus.submitted`, `bus.started`, `bus.finished`, `bus.rejected`,
  `bus.parked`, `bus.duplicate` — with `caused_by` chaining back to the message that started it.

### 4.3 Lanes = the starvation ladder

The ladder in v1.0 §2 is not a document — it is the lane enum, in priority order:

```ts
export const LANES = [
  'interactive',   // 1. Chris, any channel
  'control',       // 2. approvals, alerts, verification of in-flight work
  'librarian',     // 3.
  'heartbeat',     // 4.
  'research',      // 5.
  'synthesis',     // 6. synthesis, evals, weekly review
  'backlog',       // 7. default OFF
] as const;
```

`backlog` defaults to disabled **in code** (`laneConfig()`), not merely in the
shipped config file — a default that only holds when someone remembers to write
the TOML section is not a default.

Phase 1 uses `interactive`, `control` and a stub `heartbeat` (health ping, zero-LLM). The other
lanes exist in the enum, in config, in the meter and in the CLI from day one, **with no
producers**. That is deliberate: the ladder is load-bearing infrastructure and gets built before
there is anything to starve, because it cannot be retrofitted onto four subsystems that each
learned to call the model directly.

Admission control, in `bus`, before dequeue (§11.4 for the arithmetic):

1. `lane.enabled` false → reject `lane_disabled`.
2. Projected window consumption after this job > `1 - reserve` and lane ≠ `interactive` →
   reject `window_reserved`.
3. Window hard-exhausted → only `interactive` and `control` admitted; `control` in sentinel mode
   (§11.5) means *templated, zero-LLM* messages only.
4. `max_concurrent` reached → queue.

Every rejection is an event with a computed (never model-authored) cause.

### 4.4 Boot and shutdown

Boot, in order, each step emitting `daemon.boot_step`:

1. Load + validate config (fail fast, print the Zod path).
2. Open SQLite, run migrations, assert `PRAGMA journal_mode=wal`.
3. Open the event log (today's JSONL, `O_APPEND`), write `daemon.started` with the config hash
   and git SHA.
4. Start OTel provider; **do not block on the collector** — export failures degrade to a counter
   and a `obs.export_failed` event (cockpit P4: the kernel console works when Langfuse is down).
5. Start the meter, replaying today's accumulator rows from SQLite.
6. Start channels last, once everything they can produce work for is up. Telegram long-poll
   begins from the persisted offset.

Shutdown on SIGTERM/SIGINT: stop accepting inbound → let in-flight turns finish
(`shutdown.grace_seconds`, default 120) → checkpoint every live session → flush event log
(`fsync`) → flush OTel with a 5 s cap → `daemon.stopped`. A second signal is an immediate exit
with `daemon.killed` (flushed first — aleph's `os._exit` lesson: the exit record is the one record
you cannot afford to lose).

---

## 5. The event log

### 5.1 The ID tuple

Straight from cockpit spec §4.1, as a type:

```ts
type IdTuple = {
  origin: 'channel' | 'heartbeat' | 'cron' | 'research' | 'librarian' | 'verify' | 'system';
  session_id?: string;   // required iff origin === 'channel'
  task_id?: string;
  run_id?: string;
  trace_id: string;      // W3C 32-hex, per turn/job
  span_id?: string;      // the span this event was emitted inside
};
```

Invariants, checked by `envelope.ts` at construction and by CI on fixtures:

- `origin` always present.
- `session_id` present **iff** `origin === 'channel'`. No pseudo-sessions for background work
  (cockpit F10).
- `trace_id` always present. Events and evidence records are the only rows that carry one
  (cockpit F2: task↔trace is 1:many).

### 5.2 The envelope

```jsonc
{
  "v": 1,
  "id":  "evt_01K2X8...",              // ULID, monotonic within a process
  "ts":  "2026-08-20T21:04:05.123Z",   // RFC3339 UTC ms
  "kind": "session.turn_completed",     // dotted, registry-controlled (§5.3)
  "ids": { "origin": "channel", "session_id": "ses_...", "trace_id": "4bf92f...", "span_id": "00f0..." },
  "caused_by": "evt_01K2X7...",         // parent event id, or null only for roots
  "cause": {                            // §5.6 — WHY, with its provenance
    "kind": "computed",                 // computed | self-reported | user
    "text": "turn finished: 1 assistant message, stop_reason=end_turn",
    "source": "sessions/lifecycle.ts:runTurn"
  },
  "payload": { "...": "kind-specific, Zod-validated" },
  "actor": "daemon"                     // daemon | agent | user | external
}
```

Field notes:

- **`v`** is the envelope version, bumped only for breaking changes. Readers tolerate unknown
  `kind` and unknown payload fields forever (cockpit §7).
- **`caused_by` is mandatory, not optional.** v1.0 principle 5 says every action emits an event
  *with its cause*; an optional field becomes empty within a month. Root events use the literal
  `null` and must declare `cause.kind: "user"` or `"computed"` — a root with no cause fails Zod.
- **`payload` never contains secrets or raw model transcripts.** Message text is included for
  channel events (it is already in the vault and in Telegram); model output is referenced by
  `trace_id` and by vault path, not copied.
- Size cap 64 KiB per event; over-cap payload fields are replaced by
  `{"_truncated": {"field": "text", "bytes": N, "sha256": "..."}}`.

### 5.3 Kind registry

Kinds are declared in one table in `envelope.ts` with a Zod payload schema each. Unregistered kind
→ `emit()` throws in dev/CI, and in production logs `event.unregistered_kind` and writes the event
anyway (dropping a real event to punish a schema slip is the wrong trade).

Phase 1 registry (36 kinds, `docs/EVENTS.md` is generated from it):

| Group | Kinds |
|---|---|
| daemon | `daemon.started` `daemon.boot_step` `daemon.stopped` `daemon.killed` `daemon.config_loaded` |
| bus | `bus.submitted` `bus.started` `bus.finished` `bus.rejected` `bus.parked` `bus.duplicate` |
| channel | `channel.message_received` `channel.message_sent` `channel.send_failed` `channel.topic_created` |
| session | `session.created` `session.resumed` `session.rehydrated` `session.turn_started` `session.turn_completed` `session.turn_failed` `session.checkpointed` `session.archived` `session.topic_inferred` `session.topic_corrected` |
| routing | `routing.decided` `routing.escalated` |
| meter | `meter.usage_recorded` `meter.window_threshold` `meter.window_exhausted` |
| vault | `vault.written` `vault.commit` `vault.write_denied` |
| obs | `obs.export_failed` `obs.join_audit` |

`docs/EVENTS.md` is generated from this table; CI fails if it is stale. (Aleph commandment 8 —
docs drift is a defect, so the doc is not hand-maintained.)

### 5.4 `emit()` — the single helper

Cockpit F7: dual emission must be a library property.

```ts
emit(kind, ids, payload, opts?: { causedBy?: string; cause?: Cause; actor?: Actor }): string
```

One call does all of:

1. Build + validate the envelope (Zod); mint `evt_` ULID; stamp `ts` from `core/clock`.
2. Append one line to `data/events/YYYY-MM-DD.jsonl` (`O_APPEND`, single `write()` per line so
   concurrent appends cannot interleave; `fsync` on a 1 s timer and on shutdown).
3. Insert the indexed columns into `events` (§5.5) in the same tick.
4. Fan out to OTel: add a span event on the current span, or open+close a zero-duration span when
   there is none, carrying the tuple as attributes (§6.2).
5. Return the new event id, so the caller can pass it as the next `caused_by` — which is how
   causal chains get built without a context-propagation framework.

`emit()` never throws to the caller for I/O reasons. A failed JSONL append is a process-level
fatal (the log *is* the ground truth; running blind is worse than restarting). A failed OTel
export increments a counter and, once per minute, emits `obs.export_failed`.

**Ambient-context helper.** `withSpan(name, ids, fn)` opens a real span, runs `fn`, and makes the
tuple available to `emit()` inside it. This is convenience only — the tuple is still passed
explicitly in every job payload (cockpit F1), because ambient context does not survive the
process boundaries Phase 3 introduces.

### 5.5 Storage: JSONL is truth, SQLite is an index

`data/events/YYYY-MM-DD.jsonl` — append-only, never rewritten, gzipped after 30 days by a
`os events compact` job (retention: indefinite, compressed — v1.0 §7).

SQLite `events` table is a **derived index**, rebuildable by replaying JSONL:

```sql
CREATE TABLE events (
  id          TEXT PRIMARY KEY,      -- evt_ ULID
  ts          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  origin      TEXT NOT NULL,
  session_id  TEXT, task_id TEXT, run_id TEXT,
  trace_id    TEXT NOT NULL,
  caused_by   TEXT,
  actor       TEXT NOT NULL,
  file        TEXT NOT NULL,         -- source JSONL file
  offset      INTEGER NOT NULL,      -- byte offset for O(1) re-read
  payload     TEXT                   -- JSON, for ad-hoc queries; NOT the source of truth
);
CREATE INDEX events_ts       ON events(ts);
CREATE INDEX events_session  ON events(session_id, ts);
CREATE INDEX events_kind     ON events(kind, ts);
CREATE INDEX events_trace    ON events(trace_id);
CREATE INDEX events_cause    ON events(caused_by);
```

Note what this is *not*: the cockpit's ledger (approvals, verification verdicts) is **not**
rebuildable from JSONL — cockpit F8 killed that claim, and litestream is the recovery story for
`aleph.db`. The events index specifically *is* rebuildable, and `os events reindex` proves it;
that is a narrower and honest claim.

### 5.6 Cause provenance

v1.0 principle 5 spells out the rule; the schema enforces it:

- `cause.kind: "computed"` — the daemon knows why. `text` is written by code, `source` is a
  `file:function` string. **Every kernel-computed event uses this.** Never a model call.
- `cause.kind: "self-reported"` — a model-initiated action. `text` is the surrounding assistant
  text / tool-call rationale *already present in the transcript*, captured at zero marginal cost
  and labelled as such. Never a dedicated reasoning call, ever.
- `cause.kind: "user"` — traceable to a human message; `text` is the message excerpt,
  `source` the channel + message id.

Phase 1 emits only `computed` and `user`. `self-reported` is wired (the type exists, the reader
handles it) and first produced in 2a when the agent starts taking actions of its own. Building the
label now costs nothing; adding it later means re-labelling history.

---

## 6. Observability wiring

### 6.1 Topology

```
daemon (OTel SDK, batch span processor)
   └── OTLP/HTTP  ──►  Langfuse v4  /api/public/otel/v1/traces
                        (self-hosted, compose/langfuse.yml, tailnet-only)
```

No collector in between for Phase 1. A collector is one more thing to keep alive at N=1, and the
Bun process can retry and drop on its own. If Phase 3's out-of-process workers make it worth it,
a collector slots in with a config change (`obs.otlp_endpoint`).

### 6.2 Span model and Langfuse mapping

One **trace per turn** (or per background job). Root span `turn` with children `route`,
`sdk.query`, `vault.write`, `channel.send`. The SDK's own internal LLM spans are not ours to
create; the `sdk.query` span carries the usage numbers the SDK reports back, so cost and tokens
land on a span we control (which is also what the meter reads — one number, two consumers, no
second source to disagree with itself).

**The tuple's `trace_id` is the OTel trace id.** The daemon mints the trace id
before any span exists (a message is received, a session resolved and a job
queued before the turn starts), so spans are opened under a *synthetic remote
parent* carrying that id (`src/core/tracectx.ts`) rather than letting OTel
generate its own. This is not cosmetic: the first implementation let the two
diverge, which made every `traces/{trace_id}` deep link point at a trace that did
not exist. Found by running it and comparing the sink's output to the event log —
see `docs/RUNBOOK-phase1-slice.md`.

Attributes on **every** span (explicit, set by the worker itself — cockpit F1):

| Attribute | Value |
|---|---|
| `aleph.origin` | tuple `origin` |
| `aleph.session_id` / `aleph.task_id` / `aleph.run_id` | when present |
| `aleph.lane` | lane name |
| `langfuse.trace.name` | e.g. `turn` |
| `langfuse.session.id` | tuple `session_id` (Langfuse groups by this) |
| `langfuse.user.id` | `chris` (single user; the field exists so multi-user later isn't a migration) |
| `langfuse.trace.tags` | `["origin:channel","lane:interactive","task:tsk_…"]` — **IDs, not URLs** (F12) |
| `langfuse.trace.metadata.cockpit_task` / `cockpit_run` | ID strings |
| `gen_ai.*` | model, input/output tokens on `sdk.query` |

Deep links are built from IDs at render time by `obs/langfuse.ts`:
`${langfuse.base_url}/project/${projectId}/traces/${traceId}`. The daemon additionally serves
stable redirects `/t/{task_id}` and `/r/{run_id}` (F12) so nothing else ever embeds a Langfuse URL.

### 6.3 The join invariant (CI gate)

Cockpit §4.2 makes this gate panel work. Phase 1 has no panels, so the gate is applied to the
thing Phase 1 *does* have:

> **Invariant:** one Telegram message → exactly one trace tree, containing the `turn` root and its
> children, all carrying the same `trace_id`, with every event emitted during the turn referencing
> that `trace_id`, and zero spans outside the tree that are not on the classified-orphan baseline.

Implemented as an integration test against a real OTLP sink (§14.3) — not against Langfuse, so it
runs in CI without booting ClickHouse. A separate opt-in live test asserts the same trace is
visible through Langfuse's API. The baseline of expected orphans lives in
`tests/fixtures/orphan-baseline.json`; `os obs join-audit` reports **delta from baseline**, never
absolute count (cockpit F7 — a permanently-amber metric trains its reader to ignore it).

### 6.4 Langfuse deployment

`compose/langfuse.yml` pins Langfuse with its required Postgres / ClickHouse / Redis / MinIO,
bound to `127.0.0.1` and published on the tailnet via `tailscale serve` only. It has been brought
up and the live gate has passed against it (2026-08-21; see the runbook) — single-node ClickHouse
needs `CLICKHOUSE_CLUSTER_ENABLED=false`, and the worker needs its own S3 region or ingestion dies
behind a `200` from the collector. Keys: the ingestion
key pair lives **only** in the daemon's OTel exporter config, from `.env`. There is no read-only
Langfuse key (cockpit F3) — so nothing else in the system gets a Langfuse credential in Phase 1,
and when v2 needs reads, they go through the daemon's GET-allowlist proxy.

---

## 7. Sessions

### 7.1 Concepts

A **topic** is a durable subject (`aleph-next Phase 1`, `winter tyres`). A **session** is the
agent's state for a topic. A **turn** is one user message → one agent reply. Channels attach to
topics; a topic can be spoken to from Telegram or CLI in the same day and it is the same session
(v1.0 §3.2 channel-agnostic).

### 7.2 Store

```sql
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,     -- ses_ ULID
  topic_key      TEXT NOT NULL UNIQUE, -- slug; the daemon's own name for the topic
  title          TEXT NOT NULL,
  state          TEXT NOT NULL,        -- active | idle | archived
  sdk_session_id TEXT,                 -- the Agent SDK's own id, for resume
  created_at     TEXT NOT NULL,
  last_turn_at   TEXT,
  turn_count     INTEGER NOT NULL DEFAULT 0,
  checkpoint_path TEXT,                -- vault-relative session-brief.md
  model_class    TEXT NOT NULL DEFAULT 'conversation',
  archived_at    TEXT
);

CREATE TABLE channel_bindings (        -- topic <-> channel-native container
  channel        TEXT NOT NULL,        -- 'telegram' | 'cli'
  external_id    TEXT NOT NULL,        -- telegram message_thread_id, or cli tty name
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  chat_id        TEXT,                 -- telegram supergroup id
  created_at     TEXT NOT NULL,
  PRIMARY KEY (channel, external_id)
);

CREATE TABLE turns (
  id             TEXT PRIMARY KEY,     -- turn_ ULID
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  trace_id       TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  status         TEXT NOT NULL,        -- running | ok | failed | refused
  model          TEXT, tier TEXT, lane TEXT,
  input_tokens   INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_creation_tokens INTEGER,
  cost_usd       REAL,                 -- provisional; Langfuse is canonical for history
  resume_mode    TEXT                  -- fresh | resumed | rehydrated
);
```

`channel_bindings` is exactly the mapping v1.0 §3.3 requires the daemon to keep "since the Bot API
can't enumerate topics."

### 7.3 Lifecycle

```
        ┌──────── new topic ─────────┐
        ▼                            │
   [ active ] ──idle > idle_hours──► [ idle ] ──idle > archive_days──► [ archived ]
        ▲                              │                                    │
        └──── message (≤24h: resume) ──┘                                    │
        └──── message (>24h: rehydrate) ─────────────────────────────────────┘
```

**Turn execution** (`sessions/lifecycle.ts::runTurn`):

1. Resolve session from the channel binding (or create — §8.4). Emit `session.created` if new.
2. Decide resume mode:
   - `now - last_turn_at <= resume_window` (default **24 h**) **and** `sdk_session_id` set →
     `resumed`: SDK `query({ resume: sdk_session_id })`.
   - otherwise → `rehydrated`: fresh SDK session, system prompt seeded with
     `MEMORY.md` + the topic's `session-brief.md` + the last N `log/` entries for the topic.
   - Emit `session.resumed` / `session.rehydrated` with the computed cause including the idle
     delta — so "why did it forget?" is answerable from the log rather than from intuition.
3. Route the model (§9.3) → `routing.decided`.
4. Meter admission was already granted by the bus; record actual usage after the call →
   `meter.usage_recorded`.
5. Run the SDK query inside span `sdk.query`. Stream assistant text to the channel adapter if the
   channel supports streaming edits (Telegram: batched edits at ≥1.5 s intervals to stay inside
   rate limits; Phase 1 default is **no streaming** — one final message, because a partial-edit
   loop is a rate-limit footgun and adds nothing at N=1).
6. Write the episodic entry to `log/YYYY-MM-DD.md`, update `session-brief.md`, commit per §10.4.
7. Checkpoint if `turn_count % checkpoint_every == 0` (default 5) or if the SDK reports a
   pre-compaction signal → `session.checkpointed`.
8. Emit `session.turn_completed` and send the reply → `channel.message_sent`.

**Failure**: `session.turn_failed` with the error class, plus a templated (zero-LLM) message to the
channel. A failed turn never leaves the session in `running`; the store transition is in the same
SQLite transaction as the turn row update.

### 7.4 `session-brief.md` — the handoff artifact

v1.0 §3.2's shared-state continuity contract. One file per topic at
`vault/wiki/projects/<topic>/session-brief.md`, **rewritten** (never appended — v1.0 §4.1):

```markdown
---
topic: aleph-next-phase-1
session_id: ses_01K2...
updated: 2026-08-20T21:04:05.123Z
turns: 14
state: active
---
# Brief — Aleph-next Phase 1

## Where this stands
<= 8 lines, current state of the work>

## Decisions made
- <decision> — <one-line why> (2026-08-19)

## Open questions
- <question>

## Next actions
- [ ] <action>

## Artifacts
- [[wiki/projects/aleph-next-phase-1/notes]]
- repo: ~/src/aleph-next @ 038449f
```

It is written by the daemon after every checkpoint, is what a rehydrated session reads first, and
is what Phase 2b hands to Claude Code over MCP. Writing it in Phase 1 — before anything consumes
it — is the point: the artifact must already exist and already be accurate when the consumer
arrives.

### 7.5 SDK integration notes (measured, not assumed)

Verified on `@anthropic-ai/claude-agent-sdk@0.3.238` (2026-08-20, this environment):

- `query({ prompt, options: { resume } })` returns an async iterable of messages;
  `system/init` carries `session_id`, `result` carries `usage` (input, output, cache read,
  cache creation, per-model breakdown) and `total_cost_usd`. **That is the meter's input.**
- Resume works: turn 1 stated a fact, turn 2 with `resume: <sid>` answered from it.
- `permissionMode: 'bypassPermissions'` refuses to run as root. The daemon runs as a non-root
  user (compose `user:` directive) and Phase 1 uses `allowedTools: []` anyway, so no permission
  mode is set at all — no tools, no prompts.
- The SDK inherits `CLAUDE_CODE_*` env from its parent, including session identity. The daemon
  **strips all `CLAUDE_*`/`ANTHROPIC_*` env except the ones it sets deliberately** before
  spawning, so sessions get fresh ids and a known auth path. (Found the hard way: an inherited
  `CLAUDE_CODE_SESSION_ID` makes every SDK session report the same id.)
- `settingSources: []` keeps the daemon's sessions from silently loading `~/.claude` settings —
  the daemon's behaviour must come from the daemon's config, not from whatever Chris last put in
  his personal Claude Code settings.

---

## 8. Channels

### 8.1 Interface

```ts
interface Channel {
  name: string;                                    // 'telegram' | 'cli'
  start(sink: (m: InboundMessage) => void): Promise<void>;
  stop(): Promise<void>;
  send(target: ChannelTarget, out: OutboundMessage): Promise<SentRef>;
  capabilities: { streamingEdits: boolean; attachments: boolean; buttons: boolean };
}

type InboundMessage = {
  id: string;                       // msg_ ULID (daemon-minted)
  channel: string;
  external: { chat_id?: string; thread_id?: string; message_id?: string; from?: string };
  text: string;
  attachments?: Attachment[];
  received_at: string;
};
```

Adapters contain **no** business logic: no session resolution, no routing, no vault access. They
normalize and hand off. This is what makes "channel-agnostic sessions" true rather than aspirational.

### 8.2 Telegram: shape

- A **private forum-enabled supergroup**, bot is admin with `can_manage_topics`.
- One **forum topic** per session. `message_thread_id` is the binding key.
- The **General** topic is the front door: a message there with no binding starts a new session and
  the daemon **creates a new forum topic** (`createForumTopic`) and moves the conversation there,
  replying in General with a one-line pointer.
- On archive: `closeForumTopic` (not delete — deleting destroys Chris's history; v1.0 says
  "closed/deleted on archive", and closed is the reversible half of that).
- Base URL is config (`telegram.api_base`), defaulting to `https://api.telegram.org` and pointed at
  the self-hosted `telegram-bot-api` in 2a. Nothing in the adapter depends on which is in use —
  which is precisely why the self-hosted server can be deferred without a rewrite.

### 8.3 Telegram: transport

Long polling (`getUpdates`, `timeout=50`, `allowed_updates=["message","edited_message","callback_query"]`).
Webhooks are rejected: they would require inbound reachability, which the tailnet-only posture
(v1.0 §3.1) forbids.

- `update_id` offset persisted in SQLite **after** the resulting job is durably submitted, so a
  crash re-delivers rather than drops.
- Rate limits: a token-bucket sender (30 msg/s global, 1 msg/s per chat, 20 msg/min per group),
  429 `retry_after` respected with jitter. Send failures after 3 attempts → `channel.send_failed`
  + the reply is written to the vault regardless (the answer is never lost because the transport
  was).
- Messages > 4096 chars are split on paragraph boundaries; > 3 parts becomes a `.md` document
  attachment with a summary message (v1.0 §3.3 "deliverables as summary + attached file").
- Inbound authorization: `from.id` must equal `telegram.owner_user_id`, and `chat.id` must equal
  `telegram.chat_id`. Anything else is dropped with `channel.message_received`
  (`payload.rejected: "unauthorized"`) and never reaches a session. Two checks, not one: the group
  could gain a member; the bot could be added elsewhere.

### 8.4 Topic ↔ session inference

When a message arrives with no binding:

1. In an existing forum topic (Chris made it by hand) → bind that topic to a new session, title
   from the topic name.
2. In General → the daemon decides *new topic vs. most-recent-active*:
   - Explicit prefix wins: `#<topic-slug>` targets an existing topic; `new: <title>` forces a new one.
   - Otherwise: a **T1 (Haiku) classifier** with the list of active topic titles + the last brief
     line of each, answering `existing:<slug>` or `new:<proposed title>`.
   - Confidence below threshold, or > 6 active topics → default to **new topic**. A wrongly-split
     topic is a merge later; a wrongly-merged topic corrupts a session's context permanently.
3. `session.topic_inferred` records the choice, the alternatives, and the classifier's reasoning.
   `os session move <msg> <topic>` (and, in 2a, a Telegram tap) emits `session.topic_corrected`.
   The pair is the calibration data.

### 8.5 CLI channel

`os send` connects to a Unix socket at `data/aleph.sock` (0600), sends
`{topic?, text}`, and streams back the reply. Same `Channel` interface, same session store — so
`os send --topic aleph-next-phase-1 "..."` continues the conversation Chris was having on his
phone. That cross-channel continuity is a Phase 1 test (§14.4), because it is the cheapest possible
proof that sessions are genuinely channel-agnostic.

---

## 9. Configuration and routing

### 9.1 Format and precedence

`config/aleph.toml` (committed defaults) ← `config/hosts/<hostname>.toml` (gitignored overlay) ←
`ALEPH_*` env overrides for a handful of operational keys. Deep-merged, then Zod-validated as one
object. `daemon.config_loaded` records the merged config's **SHA-256 and the source of every
overridden key** — so "why is it behaving differently on this box" is answerable from the log.

Secrets are **never** in TOML. A string of the form `${TELEGRAM_BOT_TOKEN}` is resolved from the
process env at boot; an unresolved reference is a boot failure, not an empty string. `.env` is
read by the *supervisor* (compose / systemd), not by agent-reachable code (v1.0 §8).

### 9.2 Surface (abridged; `config/aleph.example.toml` is the full documented one)

```toml
[daemon]
data_dir = "./data"
vault_dir = "../vault"
socket = "./data/aleph.sock"
shutdown_grace_seconds = 120

[telegram]
enabled = true
api_base = "https://api.telegram.org"
bot_token = "${TELEGRAM_BOT_TOKEN}"
chat_id = "${TELEGRAM_CHAT_ID}"
owner_user_id = "${TELEGRAM_OWNER_ID}"

[obs]
otlp_endpoint = "http://127.0.0.1:3010/api/public/otel/v1/traces"
langfuse_base_url = "http://127.0.0.1:3010"
langfuse_project_id = "${LANGFUSE_PROJECT_ID}"
service_name = "aleph-daemon"

[sessions]
resume_window_hours = 24
idle_hours = 24
archive_days = 7
checkpoint_every_turns = 5

[meter]
plan = "max20x"
[meter.reserve]
window_5h = 0.30
weekly = 0.25

[lanes.interactive]
enabled = true
max_concurrent = 2
max_queue = 32
[lanes.research]
enabled = true
max_concurrent = 1
max_queue = 8
[lanes.backlog]
enabled = false          # v1.0 §2: the largest silent consumer, default OFF

[routing]
default_tier = "T2"
flex = 1                  # orchestrator may move ±1 tier
escalate_after_failures = 2

[routing.tiers]
T1 = { model = "claude-haiku-4-5-20251001" }
T2 = { model = "claude-sonnet-5" }
T3 = { model = "claude-opus-5" }

[routing.classes]
conversation = { tier = "T2", ceiling = "T3" }
classify     = { tier = "T1", ceiling = "T1" }
brief        = { tier = "T1", ceiling = "T2" }
orchestrate  = { tier = "T3", ceiling = "T3" }
```

T0 (local CPU) and T0g (Modal L40S) appear in the schema with `enabled = false` in Phase 1: the
tiers are named and routable, with no backend wired. Phase 2a fills them in. Naming them now keeps
the routing table's shape honest.

### 9.3 Router

`route(class, ctx)` → `{ tier, model, reason }`:

1. Start at the class's configured tier.
2. Apply flex: caller may request ±`flex` tiers; clamped to the class's `ceiling`.
3. `ctx.consecutive_failures >= escalate_after_failures` → +1 tier (clamped) →
   `routing.escalated`.
4. Emit `routing.decided` with the class, the chosen tier, the model string and the computed
   reason. The event is what makes "did my config change actually take effect" a query rather than
   a guess (S6's exit check).

Verifier disagreement → T3 and mechanical-loop demotion are hooks the router exposes but Phase 1
has no callers for; they are unit-tested against synthetic contexts.

---

## 10. Vault bootstrap

### 10.1 What `os vault init` creates

The v1.0 §4.1 layout exactly, plus seeded contract files:

```
vault/
├── VAULT.md          # contract + prohibitions (human-owned; agent may only propose)
├── index.md          # agent-maintained catalog — read first
├── MEMORY.md         # curated, <=150 lines
├── wiki/{entities,concepts,projects,decisions,reviews}/
├── log/              # YYYY-MM-DD.md episodic staging
├── inbox/
├── research/
├── human/            # Chris's notes — agent read-only
├── attachments/
├── archive/
├── .gitignore        # attachments/*, .obsidian/, .sync-conflict*
└── .stignore         # Syncthing scope (2a) — written now, documented
```

`git init` runs **before the first agent write** (v1.0 §4.1) and the bootstrap commit is
`vault: bootstrap` — so there is never an uncommitted pre-history.

### 10.2 Templates (shipped in `src/vault/templates/`)

`VAULT.md` is half prohibitions, per v1.0 §4.1 doctrine — the operative section:

```markdown
## Prohibitions (absolute)
1. Never write anywhere under `human/`. Read-only, always. It is bind-mounted ro; a write
   attempt is a bug, and is logged as `vault.write_denied`.
2. Never edit this file. Propose a diff in `wiki/decisions/` and ask.
3. Never append to a note that has a canonical section for the claim — rewrite the section.
   Sprawl is the failure mode, not staleness.
4. Never delete. Move to `archive/` with a frontmatter `archived_reason`.
5. Never write to `log/` outside the current day's file.
6. Never put a secret, token, or key in the vault. If one arrives in a message, redact it
   and note the redaction.
7. Never restructure directories, rename namespaces, or change frontmatter schemas without
   explicit approval.

## Read order (always)
1. `index.md` — the catalog. 2. `MEMORY.md` — standing context.
3. The specific note. Only then search.
```

`MEMORY.md` ships with the four curated sections (identity / standing preferences / active core /
agent-OS stack) and a hard ≤150-line rule the writer enforces in code, refusing the write and
emitting `vault.write_denied` (`reason: "memory_line_budget"`) rather than silently trimming.

### 10.3 Mount plan (v1.0 §4.1 red-team F7)

Enforcement is at the mount, not in prompts. Phase 1 has no execution sandboxes yet, so what it
must deliver is the *plan plus the daemon-side half*:

| Path | Daemon | Future sandbox mount |
|---|---|---|
| `vault/human/` | writer refuses (`vault.write_denied`) | `:ro` |
| `vault/VAULT.md` | writer refuses | `:ro` |
| `config/` (gate registry, policy) | read-only fd | `:ro` |
| `vault/wiki`, `log`, `inbox`, `research`, `attachments`, `archive` | rw | `:rw` |
| `data/` | rw | **not mounted** |
| `.env` | not readable by the daemon's agent-facing code; injected as env by the supervisor | never |

`compose/daemon.yml` encodes the ro/rw split from day one, so the sandbox story in 2b inherits a
working mount layout instead of inventing one.

### 10.4 Write path and git

`vault/writer.ts` is the only thing that touches the vault. Every write:

1. Path check against the prohibition table → deny + `vault.write_denied` if it violates.
2. Atomic write (temp file + rename in the same directory).
3. `vault.written` event with path, bytes, and a content hash.
4. Commit policy: `wiki/**` and `MEMORY.md` → **commit per write**
   (`vault: <verb> <path>` + `Session: ses_…` + `Event: evt_…` git trailers, so a `git log` and the
   event log are joinable); `log/**` → staged and committed nightly (Phase 2a) — in Phase 1 the
   daemon commits `log/` on shutdown so nothing is left uncommitted.

---

## 11. Window meter and the starvation ladder

### 11.1 What is being metered

v1.0 §2: budgets are denominated in **usage-window share**, not dollars. The plan is Max 20x, with
a rolling 5-hour window and a weekly window. Anthropic does not publish an API that returns
"percentage of your window consumed", so the meter is a **model**, and it must be honest about
being one:

- The meter accumulates **weighted tokens** per window from the SDK's own `usage` on every turn.
- Weights per model class are config (`meter.weights`), defaulting to output-heavy weighting.
- The window *capacity* is a configured estimate (`meter.capacity.window_5h`,
  `meter.capacity.weekly`) that Chris calibrates against observed rate-limit messages.
- When the SDK reports a rate-limit / usage-limit error, the meter records
  `meter.window_exhausted` with the observed accumulator value — **that is the calibration
  signal**, and after a few real exhaustions the capacity estimate is fitted from data rather than
  guessed.

Stating this plainly matters: a meter that pretends to know the true window would be the exact
"confabulation dressed as audit" that v1.0 principle 5 forbids. The Today tile is labelled
*provisional* for the same reason the cost tile is (cockpit F5).

### 11.2 Windows

- **5-hour**: rolling, anchored to the first request of the current window (Anthropic's documented
  behaviour), reset when `now - anchor >= 5h`.
- **Weekly**: rolling 7-day sum.
- Both are recomputed from the `usage` table on boot, so a restart never zeroes the meter.

### 11.3 Storage

```sql
CREATE TABLE usage (
  id            TEXT PRIMARY KEY,   -- evt id of the meter.usage_recorded
  ts            TEXT NOT NULL,
  lane          TEXT NOT NULL,
  session_id    TEXT, task_id TEXT, run_id TEXT,
  model         TEXT NOT NULL, tier TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  weighted      REAL NOT NULL,      -- the meter's unit
  cost_usd      REAL,               -- provisional, from the SDK
  source        TEXT NOT NULL       -- 'sdk' | 'estimate'
);
CREATE INDEX usage_ts ON usage(ts);
CREATE INDEX usage_lane_ts ON usage(lane, ts);
```

### 11.4 Enforcement points

There are exactly **three** places the ladder is enforced, and no others (any fourth is a bug):

1. **`bus.admit(job)`** — before a job is dequeued. The arithmetic:

   ```
   share      = weighted_in_window / capacity
   headroom   = 1 - reserve            (reserve = 0.30 for the 5h window)
   admit(lane) =
     lane == 'interactive'                  -> share < 1.0
     lane == 'control'                      -> share < 1.0
     otherwise                              -> share < headroom AND lane.enabled
   ```

   Both windows are evaluated; the *stricter* verdict wins. Rejection emits `bus.rejected` with
   `payload: { lane, share_5h, share_weekly, headroom, decision }` — a computed cause, always.

2. **`meter.record(usage)`** — after every model call. Crosses a threshold (50/75/90 %) →
   `meter.window_threshold`; at 100 % → `meter.window_exhausted` and the daemon enters sentinel
   mode.

3. **`daemon.tick`** — the lane sweeper re-evaluates parked jobs when a window rolls over, and
   emits `bus.started` for anything that became admissible. Without this, a job rejected at 95 %
   would sit forever.

### 11.5 Sentinel mode

On `meter.window_exhausted`: LLM lanes stop; the heartbeat degrades to **pure code** (process
liveness, job exit codes, disk, queue depth); alerts to Chris are **daemon-templated strings**, no
model in the path (v1.0 §2). Exiting sentinel mode is automatic on window rollover and emits
`meter.window_threshold` (`{ crossing: "recovered" }`). Phase 1 ships the mode and the templated
alert; the heartbeat's checklist content is 2a.

---

## 12. `os` CLI surface

One binary, `bun build --compile`, talks to the daemon over the Unix socket. Human-readable by
default, `--json` on everything for scripting.

```
os status                       # daemon health, lanes, window shares, active sessions
os send [--topic <slug>] <text> # send into a topic (creates if absent); streams the reply
os sessions [--all]             # list; --all includes archived
os session show <slug>          # state, turn count, brief, last events
os session archive <slug>
os session move <event-id> <slug>   # topic correction -> calibration event
os events [--since 1h] [--kind k] [--session s] [--trace t] [--follow] [--json]
os events reindex               # rebuild the SQLite index from JSONL (proves §5.5's claim)
os events compact               # gzip files older than retention.compress_after_days
os trace <trace-id>             # print the tuple + the Langfuse deep link
os obs join-audit [--since 24h] # orphan delta vs baseline
os meter [--window 5h|weekly]   # accumulator detail, per lane
os lane <name> --enable|--disable
os vault init [--dir <path>]
os vault check                  # prohibitions, index staleness, MEMORY.md line budget, git clean
os config show [--effective]    # merged config + per-key source + hash
os doctor                       # every precondition, one line each, exit 1 on any failure
```

`os doctor` is the operational counterpart to §14: config valid, DB writable + WAL, event log
appendable, vault present + git clean + `human/` unwritable, SDK reachable (a 1-token call behind
`--live`), Telegram `getMe` (behind `--live`), OTLP endpoint reachable, socket permissions 0600,
clock sane. It is the thing to run before believing anything else.

---

## 13. Security posture in Phase 1

Phase 1 predates the approval broker, so the safe posture is **structural, not procedural**:

- **The agent has no tools.** `allowedTools: []`. It reads what the daemon puts in its prompt and
  emits text. Vault writes are performed *by the daemon* from the turn's output, on paths the
  daemon chooses. There is therefore no path from a message to an arbitrary file write, a shell
  command, or an outbound request — which is why deferring the broker to 2a is defensible rather
  than convenient.
- **No egress from the agent.** No web search, no fetch, no MCP servers in Phase 1 sessions. The
  lethal trifecta cannot form when the third leg does not exist.
- **Inbound authorization** is double-checked (§8.3).
- **Secrets** are supervisor-injected env, never in config files, never in the vault, never in
  event payloads. A redaction pass runs over every event payload before write, matching known
  token shapes (`bot<digits>:<b64>`, `sk-ant-…`, `lf_pk_…`, generic 32+ char high-entropy) and
  replacing with `«redacted:<sha256[:8]>»`. Tested with real-shaped fixtures.
- **The socket** is 0600, owned by the daemon user, inside `data/`.
- **Nothing binds a public interface.** The daemon listens on the Unix socket and, for the future
  cockpit, `127.0.0.1` only; the tailnet exposure is `tailscale serve`'s job.

---

## 14. Test plan

Chris's cardinal rule applies to building the thing that enforces it: **no claim without an
observed run**. The plan below is written so that each claim in §1.1 has a check that would fail
if the claim were false.

### 14.1 Layers

| Layer | Runs where | Speed | What it may use |
|---|---|---|---|
| `tests/unit` | CI + local | < 5 s | pure functions, in-memory sqlite, fake clock |
| `tests/integration` | CI + local | < 60 s | real temp dirs, real SQLite files, real Unix socket, real HTTP servers (fake Bot API, OTLP sink), real subprocess daemon, `echo-runner` |
| `tests/live` | opt-in, `ALEPH_LIVE=1` | minutes | real Agent SDK, real Telegram bot, real Langfuse |

The rule that keeps this honest: **integration tests boot the actual daemon binary as a
subprocess** and talk to it over its real socket. No test imports `daemon.ts` and calls internal
functions to simulate a boot. "It compiles" and "the unit test passes" are not evidence that the
daemon runs.

### 14.2 Unit

- Envelope: every registered kind round-trips; missing `caused_by` rejected; oversized payload
  truncated with hash; `session_id` present iff `origin=channel`; unknown kind tolerated on read.
- Redaction: fixtures containing a Telegram-shaped token, an `sk-ant-` key and a Langfuse key are
  all redacted; a UUID and a git SHA are **not** (false-positive guard).
- Router: class defaults, flex clamping at ceiling, escalation after N failures, reason strings.
- Meter: weighting, 5h anchor rollover across a DST boundary, weekly rolling sum, threshold
  crossings fire once (not per-call).
- Ladder: table-driven — for each (lane, share_5h, share_weekly, enabled) → expected verdict.
  Includes the case that motivated the reserve: background lane at share 0.69 admitted, 0.71
  refused, interactive admitted at both.
- Brief: render → parse → render is idempotent.
- ULID monotonicity within a millisecond.

### 14.3 Integration (all real I/O)

1. **Boot/shutdown**: spawn the daemon, `os status` returns lanes + windows, SIGTERM → process
   exits 0, `daemon.stopped` is the last line of the JSONL, and the file ends with a newline.
2. **Event chain**: drive one turn with `echo-runner`; assert the JSONL contains
   `channel.message_received → bus.submitted → bus.started → session.created →
   routing.decided → session.turn_started → meter.usage_recorded → session.turn_completed →
   vault.written → channel.message_sent`, each `caused_by` resolving to the previous, all sharing
   one `trace_id`.
3. **Reindex**: delete the `events` table, `os events reindex`, assert row-for-row equality with
   the pre-delete dump. (Proves §5.5's claim rather than asserting it.)
4. **OTLP**: a real HTTP sink on a free port decodes the exporter's payload and asserts the span
   tree shape and every attribute in §6.2, including `langfuse.session.id` and the tag array.
5. **Join invariant**: one inbound message → exactly one trace tree, zero unclassified orphans;
   `os obs join-audit` reports delta 0.
6. **Fake Bot API**: a local server implements `getMe`, `getUpdates`, `sendMessage`,
   `createForumTopic`, `closeForumTopic`. Tests: General message creates a topic and binds it;
   a message in a bound topic reaches that session; unauthorized `from.id` is dropped;
   a 429 with `retry_after` is honoured (assert the delay, not just the eventual success);
   a 5000-char reply is split; offset persistence survives a daemon restart with no message loss
   and no duplicate reply.
7. **Session lifecycle**: with a fake clock — second message at +1 h resumes (`resume_mode=resumed`,
   SDK given the prior sdk id); at +25 h rehydrates (`resume_mode=rehydrated`, prompt contains the
   brief); at +8 d the session is `archived` and a new one is created.
8. **Cross-channel**: `os send --topic X` after a Telegram turn in X continues the *same* session
   (assert the same `ses_` id and one `sessions` row).
9. **Vault**: `os vault init` in a temp dir → layout exists, git has one commit; a write to
   `wiki/` produces a commit whose trailers name the session and event; a write to `human/` is
   refused with `vault.write_denied`; a 151-line `MEMORY.md` write is refused.
10. **Meter enforcement**: preload the usage table past the reserve, submit a research-lane job →
    `bus.rejected` with `reason: window_reserved`; submit an interactive job → admitted.
11. **Config**: a bad type fails boot with a Zod path on stderr and exit 2; an unresolved
    `${MISSING}` fails boot; `os config show --effective` names the overriding source per key.
12. **Module boundaries**: a test walks the import graph and fails on a cycle or a forbidden edge.

### 14.4 The Phase 1 end-to-end slice (the S-checks)

The slice that must be demonstrated on real infrastructure, not in CI:

> A message sent from Chris's phone into the Telegram forum group is answered by a real
> Agent SDK session; the exchange appears in the vault's `log/`; the event chain is in the JSONL;
> the trace is visible in Langfuse; `os status` shows the window meter moved.

Recorded as `docs/RUNBOOK-phase1-slice.md` with the actual command output pasted in — the aleph
convention of a `TESTREPORT.md` that contains observed output, not a summary of it.

### 14.5 What CI can and cannot prove

CI runs unit + integration. CI **cannot** prove: the real Telegram bot works, the real SDK auth
path works, Langfuse ingests what the sink accepted, or that the daemon survives a week. Those are
the live tests and the runbook, and the README says so explicitly rather than letting a green
badge imply more than it means.

### 14.6 Gate table (seeds `docs/VERIFICATION.md`)

| Domain | Gate | Notes |
|---|---|---|
| `code` | `bun test tests/unit` | required for any `src/` change |
| `integration` | `bun test tests/integration` | required for anything touching daemon, channels, event log |
| `live` | `ALEPH_LIVE=1 bun test tests/live` | required before claiming a channel or SDK change works |
| `config` | `bun run config:check` | validates every TOML in `config/` against the Zod schema |
| `docs` | `bun run docs:check` | `EVENTS.md` matches the kind registry; example config matches the schema |

---

## 15. Milestones

Each milestone is committable, runnable, and has one check that fails if it is not done.

| M | Content | Done when |
|---|---|---|
| **M1** | Skeleton, config loader, ids/clock, SQLite migrations, `os doctor` | `os doctor` passes on a clean checkout with an example config |
| **M2** | Envelope, kind registry, `emit()`, JSONL + index, `os events`, reindex | Integration #2 and #3 pass |
| **M3** | OTel + Langfuse mapping + OTLP sink test + join-audit | Integration #4 and #5 pass |
| **M4** | Session store, lifecycle, `echo-runner`, then `sdk-runner`; CLI channel | Integration #7 and #8 pass; live SDK test answers from prior context |
| **M5** | Telegram adapter | Integration #6 passes; live test posts into the real group |
| **M6** | Meter + ladder + vault bootstrap/writer + full `os` surface | Integration #9 and #10 pass; slice runbook recorded |

---

## 16. Risks and questions for Chris

1. **Window capacity is a guess until it is calibrated.** The meter is honest about this (§11.1)
   but the first weeks will over- or under-throttle background lanes. Mitigation: reserve is
   config, and `meter.window_exhausted` events fit the estimate.
2. **Telegram forum topics via Bot API are awkward** — no enumeration, and topic edits by hand can
   desync the binding. `os vault check`'s sibling `os sessions --repair` (reconciling bindings
   against observed `message_thread_id`s) may be needed sooner than expected.
3. **Rehydration quality is the real risk to "remembering agent."** The brief is the only thing
   crossing the 24 h boundary. Phase 1 should end with a deliberate test of a week-old topic, judged
   by Chris, not by the daemon.
4. **Confirm:** timezone `America/Los_Angeles`; 07:00 / Sunday 18:00; 30 % / 25 % reserves; Bun;
   TOML; and that closing (not deleting) forum topics on archive is what you want.

---

## 17. Corrections this design took from being built

The design above is as-implemented. Six things were wrong in the first draft or
the first implementation, and all six were found by running the system rather
than reading it. They are listed here because the pattern is the point:

1. **Trace ids diverged** between the event log and the exported spans (§6.2).
2. **`os send --topic X` forked a second session** rather than routing to topic
   X — the CLI's container key *is* the topic slug and nothing resolved it (§8.5).
3. **A path escaping the vault was silently sanitized** into an internal path and
   written. `VaultWriter` now refuses; rewriting an escape into a successful
   write to a different file is worse than no check (§10.4).
4. **A disabled tier fell forward exactly one step**, landing on `T0g`, which is
   also disabled in Phase 1. The router now walks to the next *enabled* tier (§9.3).
5. **`backlog` defaulted to enabled** whenever a config omitted the section (§4.3).
6. **The shutdown checkpoint was an unclassified join-audit orphan.** It is
   legitimate — it runs after the bus drains — so it is now in the classified
   baseline rather than a permanent amber the reader learns to ignore (§6.3).
7. **A refused inbound message was also an unclassified orphan** — it emits
   `channel.message_received` and stops, so no `bus.started` ever joins its
   trace. Found the first time the authorization check fired against real
   Telegram traffic. Classifying the *kind* would have hidden an accepted
   message that never reached the bus, so the audit classifies on the payload's
   `rejected` field instead (§6.3).

Measured facts worth keeping (they are assumptions elsewhere):

- `@anthropic-ai/claude-agent-sdk@0.3.238` inherits `CLAUDE*`/`ANTHROPIC*` env
  from its parent, **including `CLAUDECODE` with no underscore** — the env filter
  strips on the prefix `CLAUDE`, not `CLAUDE_`, or every SDK session reports the
  parent's identity (§7.5).
- `permissionMode: "bypassPermissions"` refuses to run as root, which is why
  `compose/daemon.yml` sets a non-root `user:`.
- Bun's `[test] timeout` in `bunfig.toml` does not set the per-test timeout;
  integration tests pass theirs explicitly.
