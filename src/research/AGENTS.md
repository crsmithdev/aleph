# Research Module — Agent Guide

Loop engine for autonomous research and monitor runs. One child process per
loop; subprocess-per-loop is the isolation boundary, no shared worker pool.
Live events stream to the UI via SSE. State persists in SQLite; per-loop
artifacts make the run resumable and inspectable post-hoc.

The build plan and architectural rationale live in:
- `docs/plans/research-system-principles.md` — operating constraints.
- `docs/plans/research-system-design.md` — comparator survey + failure-mode analysis.
- `docs/plans/research-engine-build-plan.md` — phase plan (v1..v5).

---

## Key files

| File | Role |
|---|---|
| `src/loop/engine.ts` | The cycle loop: dispatch → processor → derivation → renderer → stop_rule, with envelope tracking and milestone hooks at 25/50/75 %. |
| `src/loop/run.ts` | Child-process entry point. Opens the DB, runs `ensureScheduleArtifact` once, calls `runLoop`, then fires the optional `postMortem` hook and auto-polishes the document. |
| `src/loop/db.ts` | All loops / cycles / artifacts / cycle_ledger / milestones SQL — `createLoop`, `listLoopsWithStats`, `createArtifact`, `bumpUsage`, `readState`. |
| `src/loop/shape.ts` | Phase 3 output-shape detection + `ensureScheduleArtifact` (idempotent — skips re-detection on respawn). Renderer-as-gate validator (`validateShape`). |
| `src/loop/planner.ts` | Phase 4 adaptive planner — replaced the deleted `(question_shape × topic_cluster)` lookup. Emits a typed `LoopSchedule`. |
| `src/loop/modes.ts` | Mode presets (`MODE_PROFILES`) — 8 named starting templates that seed the envelope and label the schedule via `created_with_mode`. |
| `src/loop/envelope.ts` | Envelope ticking + milestone-threshold detection. |
| `src/loop/ledger.ts` | Cycle ledger — input-hash dedup so crash-resume skips re-doing completed steps. |
| `src/loop/document.ts` | Document polish pass — wraps the latest `render` artifact into a `kind: 'document'` Markdown artifact for the Document tab. |
| `src/loop/decisions.ts` | Helpers for emitting `decision` events + appending to the loop's `decision_log` artifact (planner + derivation choices). |
| `src/loop/templates/research.ts` | Research template — search-driven 4-hook implementation. Uses the schedule's `branches[]` to seed cycle queries. |
| `src/loop/templates/monitor.ts` | Monitor template — wait-cycles + run-cycles pattern. |
| `src/loop/templates/noop.ts` | No-LLM placeholder for Phase 1 acceptance + UI tests. |
| `src/loop/templates/registry.ts` | `buildTemplate(id, ...)` dispatcher; the only place template ids resolve. |
| `src/providers/openrouter.ts` | The production `LLMProvider`. Honours `OPENROUTER_BASE_URL` so the fake server can intercept calls in CI. |
| `src/providers/websearch.ts` | Web-search abstraction (Tavily / Brave / DuckDuckGo) + page-fetch readability. |
| `src/services/defaults.ts` | Persisted SessionConfig defaults — only `iteration_check_model` and `post_mortem_model` are still read by the engine (Phase 5 will collapse the rest onto the schedule). |
| `src/services/events.ts` | In-process event bus — `emitResearchEvent` / `onResearchEvent`. The supervisor pipes child-process events back through this. |
| `src/services/id.ts` | Memorable-slug ID generator. **Always** use `generateId()` from here, never `crypto.randomUUID()` directly. |
| `src/ddl.ts` | All DDL + idempotent `ALTER`s. Drops legacy tables (`research_queries`, `research_threads`, …) on every boot. |

The HTTP surface lives outside this package in `src/ui/api/src/routes/loops.ts`
+ `src/ui/api/src/routes/research.ts`. The loop supervisor that spawns
`run.ts` children is `src/ui/api/src/loop-supervisor.ts`.

---

## Database tables

All loops-engine tables. Drop-on-boot wipes the pre-loops schema; see
`dropLegacyTables` in `src/ddl.ts`.

| Table | Purpose |
|---|---|
| `loops` | One row per session (id, template_id, status, envelope, envelope_consumed, child_pid, prompt, mode, timestamps). |
| `cycles` | One row per dispatched cycle (loop_id, idx, priority, status, started_at, finalized_at). |
| `artifacts` | Typed JSON payloads keyed by `(loop_id, cycle_id?, kind)`. Kinds: `schedule`, `cycle_output`, `render`, `milestone`, `document`, `iteration_check`, `post_mortem`, `decision_log`. |
| `cycle_ledger` | Per-(loop, cycle, step, input_hash) dedup row. Survives a kill and lets respawn skip already-completed steps. |
| `milestones` | 25/50/75% envelope checkpoints pointing at the milestone summary artifact. |
| `research_defaults` | Persisted SessionConfig. Engine reads only `iteration_check_model` + `post_mortem_model` from here today. |

---

## SSE stream

`/api/loops/:id/stream` — multiplexed SSE for one loop. Event types:
`loop`, `cycle`, `cycle_step`, `artifact`, `milestone`, `decision`.

On connect, the route back-fills from the NDJSON event log at
`~/.aleph/research/sessions/<loop_id>.ndjson` (every emitted event is
logged before reaching SSE subscribers, so the file is the canonical
timeline). The log is also downloadable at `/api/loops/:id/events.ndjson`.

---

## Configuration

**Per-loop knobs** ride on the envelope + the schedule artifact:

| Where | Field | Effect |
|---|---|---|
| `envelope.time` | `{ minutes }` | Wall-clock cap. |
| `envelope.cost` | `{ usd }` | Spend cap. Tripped first → loop stops with `envelope_exhausted`. |
| `envelope.cycles` | `{ count }` | Cycle-count cap. |
| `envelope.sources` | `{ count }` | Unique-source cap (template-defined accounting). |
| `loops.mode` | `'quick'..'custom'` | Starting-template label. Seeds the envelope at `createLoop`; recorded as `created_with_mode` on the schedule artifact. After construction the schedule is what runs. |
| `schedule.plan.canon[]` | list of strings | Authoritative entities the planner says to investigate. |
| `schedule.plan.branches[]` | `{ id, query, budget? }` | Decomposition into investigation threads. The research template seeds cycle N from `branches[N].query`. |
| `schedule.output_shape` | discriminated union | Renderer gates "done" on shape satisfaction. |

**Provider config** lives in `~/.aleph/research-config.json` (mirrored to
`process.env` so child `run.ts` processes inherit it):

| Var | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Required for `research` + `monitor` templates. |
| `OPENROUTER_BASE_URL` | Optional; redirects the provider at a local fake server (used by CI / Playwright tests). |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` | Web search providers. |
| `JINA_API_KEY` | Page-text extraction. |

---

## Rules

- Always generate loop IDs via `services/id.ts:generateId()` — never inline `crypto.randomUUID()`. Cycles/artifacts/milestones use raw UUIDs (internal references).
- Cost is tracked through `bumpUsage(sqlite, loop_id, { cost_usd })`. Every LLM call (template hook, planner, document polish, post-mortem) must charge its spend so the envelope cap fires correctly.
- The engine treats artifact `payload` as opaque JSON — only templates introspect their own payloads. New `kind`s don't need DDL changes.
- The four-hook contract (`processor / derivation / renderer / stop_rule`) plus optional `iterationCheck` / `postMortem` is the entire template API. Adding a template is a new module under `templates/` + a `registry.ts` entry.
- Failure here must not propagate. Optional hooks log to stderr and let the loop continue; required hooks should return a fallback rather than throw (see how `parseFollowups` degrades to "reuse query").
- One child process per loop. Crash recovery is the cycle ledger, not retries inside the engine. If the supervisor sees a non-terminal status after exit, it respawns — capped at `MAX_RESPAWNS=5` in `loop-supervisor.ts`.
- Update `docs/specs/RESEARCH.md` when changing the engine iteration loop, the schema, or the public artifact kinds.
