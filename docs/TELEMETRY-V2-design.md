# Construct — Telemetry v2 Specification

> **STATUS: NOT IMPLEMENTED.** This is a design document for a future rearchitecture. The current system is described in [TELEMETRY.md](TELEMETRY.md).

Redesign of the telemetry system around a schema-driven event log. Replaces tight coupling to Claude Code's JSONL internals with a two-stream architecture: a Construct-owned event log (structured, stable) and an adapter for Claude Code's JSONL (isolated, replaceable).

## Design goals

1. **The parser knows the envelope, not the project.** It reads JSONL lines, validates the envelope, and passes typed events to reducers. It never imports paths, reads the filesystem for skill names, or understands Claude Code's message format.
2. **New event kinds are additive.** Adding a kind means adding a schema and a reducer. Nothing else changes.
3. **JSONL is the source of truth.** SQLite holds derived data only — rollups, caches, indexes. Deletable and rebuildable from JSONL at any time. The parser never knows SQLite exists.
4. **Hooks emit structured telemetry via stdout and/or file append.** Both channels use the same envelope format.
5. **Claude Code's JSONL is consumed by one isolated adapter** that translates raw JSONL lines into the shared envelope. All fragile coupling lives in this adapter. If Claude Code changes its format, only the adapter changes.

## Architecture

```
Emitters:                        Pipeline:                     Consumers:

Hook stdout ──────→ capture ──┐
                              │
Hook file append ─────────────┼──→ Construct JSONL ──→ Parser ──→ Reducers ──→ API ──→ UI
                              │     (source of truth)     │
Claude Code JSONL ──→ Adapter ┘                           │
                                                     (optional)
                                                     SQLite cache
                                                     (rollups, indexes)
```

## Envelope

Every event, regardless of source, conforms to this shape:

```typescript
interface TelemetryEvent {
  ts: string              // ISO 8601 timestamp
  sid: string             // session ID (correlation key)
  kind: string            // event kind — indexes into the schema catalog
  name: string            // human-readable identifier within kind
  ms?: number             // duration in milliseconds (promoted for ubiquity)
  err?: string            // error message (promoted for ubiquity)
  data?: Record<string, unknown>  // kind-specific payload
}
```

**Design constraints on the envelope:**

- Field names are short (2-4 chars) to minimize per-line overhead in JSONL.
- `ts`, `sid`, `kind`, `name` are required. Everything else is optional.
- `data` is opaque to the parser. Only the reducer for a given `kind` interprets it.
- Unknown fields on the envelope are silently ignored (forward compatibility).
- Unknown `kind` values are stored and queryable but have no reducer (no data loss).

**One line of JSONL:**
```json
{"ts":"2026-03-28T14:30:00.000Z","sid":"abc-123","kind":"hook","name":"routing-submit-classify","ms":45,"data":{"event":"UserPromptSubmit","exitCode":0,"output":"[Construct] Depth: QUICK"}}
```

## Schema catalog

Each `kind` declares the shape of its `data` payload. Schemas are TypeScript types — no runtime validation library. The catalog is the single source of truth for what each kind means.

### `hook` — Hook execution

Emitted by: hook scripts (stdout or file), Claude Code adapter (from `stop_hook_summary` / `hook_progress`)

```typescript
interface HookData {
  event: string           // "SessionStart" | "UserPromptSubmit" | "Stop" | "PostToolUse" | "Notification"
  command?: string        // full command path
  exitCode?: number       // process exit code
  output?: string         // stdout capture
}
```

### `tool` — Tool invocation

Emitted by: Claude Code adapter (from `tool_use` content blocks)

```typescript
interface ToolData {
  tool: string            // "Bash" | "Edit" | "Read" | "Agent" | ...
  params?: Record<string, unknown>
  useId?: string          // tool_use_id for correlation
  linesAdded?: number
  linesRemoved?: number
}
```

### `tool_result` — Tool completion

Emitted by: Claude Code adapter (from `tool_result` content blocks)

```typescript
interface ToolResultData {
  useId: string           // correlates to tool.useId
  tool?: string           // tool name (denormalized to avoid lookup)
  isError?: boolean
  errorMessage?: string
}
```

### `tokens` — Token usage

Emitted by: Claude Code adapter (from `message.usage`)

```typescript
interface TokensData {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}
```

### `skill` — Skill invocation

Emitted by: Claude Code adapter (from `Skill` tool_use), or directly by skill entry points

```typescript
interface SkillData {
  skill: string           // canonical name, e.g. "/build", "research"
  trigger?: string        // "user" | "auto" | "matched"
  success?: boolean
  userRequest?: string    // truncated prompt that triggered it
}
```

### `git` — Git operation

Emitted by: PostToolUse hook on Bash (detects git commands), or dedicated git hooks

```typescript
interface GitData {
  op: string              // "commit" | "push" | "branch" | "merge" | "checkout" | ...
  branch?: string
  ref?: string
  message?: string        // commit message (for commits)
  files?: number          // number of files affected
}
```

### `metric` — Arbitrary numeric metric

Emitted by: any hook or script that wants to report a measurement

```typescript
interface MetricData {
  key: string             // metric name, e.g. "context_tokens", "test_count"
  value: number
  unit?: string           // "ms" | "bytes" | "count" | ...
}
```

### `turn` — Turn boundary

Emitted by: Claude Code adapter (from `turn_duration` system entries)

```typescript
interface TurnData {
  durationMs: number
}
```

### `compact` — Context compaction

Emitted by: Claude Code adapter (from `compact_boundary` system entries)

```typescript
interface CompactData {
  trigger: string         // "auto" | "manual" | ...
  preTokens?: number
}
```

### `message` — User message

Emitted by: Claude Code adapter (from `user` type entries)

```typescript
interface MessageData {
  text: string            // truncated to 500 chars
  role: "user"
}
```


### `subagent` — Subagent dispatch

Emitted by: Claude Code adapter (from `Agent` tool_use), enriched with result data

```typescript
interface SubagentData {
  description?: string
  subagentType?: string
  runInBackground?: boolean
  model?: string
  childSessionId?: string   // explicit link — no fuzzy timestamp matching
}
```

### `rating` — User satisfaction rating

Emitted by: rating-capture hook

```typescript
interface RatingData {
  score: number           // 1-10
}
```

## Storage

### File layout

```
~/.claude/construct/data/telemetry/
  events-2026-03-28.jsonl    # one file per day
  events-2026-03-27.jsonl
  ...
```

Dev environment:
```
<repo>/data/telemetry/
  events-2026-03-28.jsonl
  ...
```

Date-partitioned by the `ts` field at write time. This means time-range queries only read relevant files.

### Write path

Two emission channels, same envelope format:

**1. Stdout (hook scripts)**

Hook scripts print telemetry lines to stdout prefixed with `[T]` to distinguish from other output:

```
[Construct] Depth: FULL — complex request.
[T]{"ts":"...","sid":"...","kind":"hook","name":"routing-submit-classify","ms":32,"data":{"event":"UserPromptSubmit","exitCode":0}}
```

The hook harness (or a post-hook processor) strips the `[T]` prefix and appends to the day's event file. Non-`[T]` lines pass through to Claude Code as normal hook output.

**2. Direct file append (hook scripts, adapters)**

For events not tied to a hook's stdout lifecycle (adapter output, background processes):

```typescript
import { emit } from "@construct/telemetry";

emit({
  kind: "git",
  name: "commit",
  data: { op: "commit", branch: "feature/foo", message: "add bar" }
});
```

`emit()` fills in `ts` and `sid` automatically, JSON-serializes, and appends to the current day's file. Uses `fs.appendFileSync` for atomicity of individual lines.

### Read path

```typescript
function readEvents(opts?: { since?: Date; until?: Date }): TelemetryEvent[]
```

1. List files in the telemetry directory matching `events-YYYY-MM-DD.jsonl`
2. Filter by date range from filename (no need to open files outside range)
3. Read matching files line by line
4. `JSON.parse` each line, validate envelope fields exist (`ts`, `sid`, `kind`, `name`)
5. Skip malformed lines (log warning, don't throw)
6. Return `TelemetryEvent[]`

File-level caching by mtime (same as current parser). Per-process lifetime.

### Claude Code adapter

One module that reads Claude Code's JSONL session files and emits `TelemetryEvent[]`:

```typescript
function adaptClaudeSession(jsonlPath: string): TelemetryEvent[]
```

**This is the only code that understands Claude Code's internal format.** It handles:

- `type: "assistant"` → `tokens` events + `tool` events (from `message.content[]` tool_use blocks)
- `type: "user"` → `message` events + `tool_result` events (from tool_result blocks)
- `type: "progress"` → `hook` events (from hook_progress)
- `type: "system"`, `subtype: "stop_hook_summary"` → `hook` events (with duration/exit code)
- `type: "system"`, `subtype: "turn_duration"` → `turn` events
- `type: "system"`, `subtype: "compact_boundary"` → `compact` events

The adapter also handles:
- Session ID extraction from file paths
- Parent/child session relationships from directory structure
- Subagent file discovery under `<session>/subagents/`

**What the adapter does NOT do:**
- Resolve skill names against the filesystem
- Compute lines changed from Edit/Write params
- Infer tool durations from timestamp subtraction
- Match subagent sessions by timestamp proximity

These responsibilities either move to the emitter (hooks report their own data) or become explicit fields on events (Claude Code adapter includes `useId` for correlation; the reducer handles duration).

## Reducers

A reducer is a pure function: `(events: TelemetryEvent[]) → Metric`. The aggregator routes events by `kind` to the appropriate reducer.

```typescript
type Reducer<T> = (events: TelemetryEvent[], opts?: ReducerOpts) => T;

interface ReducerOpts {
  granularity?: "minute" | "hour" | "day";
  filter?: (e: TelemetryEvent) => boolean;
}

// Registry
const reducers: Record<string, Reducer<unknown>> = {
  overview: reduceOverview,
  tools: reduceTools,
  hooks: reduceHooks,
  skills: reduceSkills,
  tokens: reduceTokens,
  cost: reduceCost,
  sessions: reduceSessions,
  // ...
};
```

### What reducers replace

| Current aggregator function | v2 reducer | Simplification |
|---|---|---|
| `aggregateOverview` | `reduceOverview` | No change in logic, but input is typed events, not `SessionEntry` |
| `aggregateTools` + `aggregateToolDetail` | `reduceTools` | No two-pass toolUseId correlation — `tool_result` events carry `tool` name directly. Duration is explicit `ms` field on the `tool_result` event. |
| `aggregateHooks` + `aggregateHookDetail` + `aggregateHookEvents` | `reduceHooks` | One event type (`kind: "hook"`) with consistent fields. No `stop_hook_summary` vs `hook_progress` dual path. |
| `aggregateSkills` + `aggregateSkillDetail` | `reduceSkills` | Skill name is canonical at emission. No filesystem reads. |
| `aggregateSessions` | `reduceSessions` | Git commit detection via `kind: "git"` events instead of regex. Subagent linking via `childSessionId` instead of timestamp fuzzing. |
| `aggregateSessionTrace` | `reduceTrace` | Spans built from events with explicit durations. No fallback inference chains. |
| `aggregateSubagents` | `reduceSubagents` | `childSessionId` is explicit. No 2-second timestamp matching. |
| `aggregateMemoryUsage` | `reduceMemory` | Match on `kind: "tool"` + `data.tool` contains "memory". No hardcoded MCP tool name variants. |
| `aggregateCompliance` | `reduceCompliance` | Same logic, different input type. |

### What disappears entirely

- `parseLine()` (220 lines) — replaced by `JSON.parse` + envelope validation (~15 lines)
- Slash command filesystem scan at import time
- `useIdToTool` / `resultInfo` correlation maps
- Positional error attribution fallback
- `hookCommand.split("/").pop()` display name extraction (hooks emit their own `name`)
- `KNOWN_EVENTS` hardcoded array
- Hardcoded MCP tool name matching
- Fuzzy subagent timestamp matching (2 places)
- Git commit regex detection

## SQLite cache layer

**Invisible to the parser and reducers.** Sits between the API and the pipeline.

```
API request
  → Check SQLite for cached/rolled-up result
  → Cache hit? Return it.
  → Cache miss? Run parser + reducers on JSONL, cache result, return it.
```

### What goes in SQLite

| Table | Purpose | Populated by |
|---|---|---|
| `rollups` | Pre-aggregated daily metrics per kind | Daily cron or on-demand |
| `event_cache` | Parsed events from JSONL files (indexed) | On first read, invalidated by mtime |

### Rollup strategy

A daily job (or triggered after session end) reduces the previous day's events into summary rows:

```sql
CREATE TABLE rollups (
  date       TEXT NOT NULL,     -- YYYY-MM-DD
  kind       TEXT NOT NULL,     -- event kind
  reducer    TEXT NOT NULL,     -- reducer name that produced this
  data       TEXT NOT NULL,     -- JSON: reducer output
  PRIMARY KEY (date, kind, reducer)
);
```

The API layer checks: "do I have a rollup for every day in this range?" If yes, merge rollup summaries (fast). If no (today, or gaps), fall back to JSONL parsing for the missing days.

**Rebuild:** `DELETE FROM rollups; DELETE FROM event_cache;` — everything regenerates from JSONL on next query.

## Implementation

Big-bang cutover. Replace the existing telemetry pipeline in one pass.

### Steps

1. Create `@construct/telemetry/emit` module — `emit()` function, envelope types, day-partitioned file append.
2. Create `@construct/telemetry/adapter` — `adaptClaudeSession()` that reads Claude Code JSONL and returns `TelemetryEvent[]`. All JSONL format coupling lives here.
3. Add `[T]` stdout protocol to the hook capture logic. Update hooks to emit structured events.
4. Write reducers that consume `TelemetryEvent[]`. One reducer per API endpoint concern.
5. Rewire API endpoints to: read events (adapter + Construct JSONL) → reduce → return.
6. Remove old parser (`parseLine`, `SessionEntry`), duplicate JSONL parsers (`parse-transcript.ts`, `compliance-check.ts`, `quality-stop-check-e2e.ts`, `context-stop-monitor.ts`), and all dead types.
7. Add SQLite cache layer and daily rollup job.
8. Enrich: hooks emit `git`, `rating`, `skill` events with real data.

## Testing

- **Parser tests:** JSONL strings in → `TelemetryEvent[]` out. No filesystem, no DB.
- **Reducer tests:** `TelemetryEvent[]` in → metric out. Pure functions, no side effects.
- **Adapter tests:** Claude Code JSONL strings in → `TelemetryEvent[]` out. Tests pin the expected translation, so adapter changes are caught.
- **Integration test:** `emit()` → read back → reduce → assert. Covers the full pipeline with real files.

## Appendix: Current pain points this resolves

| Problem | Current code | v2 fix |
|---|---|---|
| 5 independent JSONL parsers | `parser.ts`, `parse-transcript.ts`, `compliance-check.ts`, `quality-stop-check-e2e.ts`, `context-stop-monitor.ts` | One adapter + shared event stream |
| Tool duration inferred from timestamps | `aggregator.ts:147` — `new Date(result.timestamp) - new Date(toolUse.timestamp)` | `ms` field on `tool_result` events (from Claude Code's `totalDurationMs` or timestamp diff done once in the adapter) |
| Git commits detected by regex | `aggregator.ts:447` — `/\bgit\s+commit\b/` on Bash command strings | `kind: "git"` events emitted by PostToolUse hook |
| Lines changed estimated from string splitting | `parser.ts:158-166` — split `old_string`/`new_string` on `\n` | Still estimated, but computed once in the adapter and stored as `linesAdded`/`linesRemoved` on the `tool` event |
| Subagent matching by 2-second timestamp window | `aggregator.ts:1057-1065`, `aggregator.ts:1267-1276` | `childSessionId` field on `subagent` events |
| Hook dual-path logic | `aggregator.ts:198-269` — `stop_hook_summary` vs `hook_progress` with different data | One `kind: "hook"` event with consistent fields |
| Skill name resolved from filesystem at parse time | `parser.ts:8-18` — reads `commands/*.md` at import | Canonical name set at emission time |
| Hardcoded MCP tool name variants | `aggregator.ts:826-828` — `"memory_store" \|\| "mcp__memory__memory_store"` | Match on `kind: "tool"` + `data.tool` pattern, or emit dedicated `kind: "memory"` events |
| Non-Stop hooks have no duration data | `aggregator.ts:640-661` — `durationMs: 0` for all non-Stop hooks | All hooks emit `ms` via stdout protocol |
| Skill errors never counted | `aggregator.ts:688` — `errorCount = 0` hardcoded | Skills emit `success: false` on failure |
| Pricing hardcoded and stale-prone | `pricing.ts:8-39` — manual model→price map | Kept as-is — no API provides actual billing data. Low priority. |
