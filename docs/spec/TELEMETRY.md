# Construct — Telemetry Specification

Technical specification for the telemetry and observability system. Covers data ingestion, aggregation, storage, and the API surface.

See [CONSTRUCT.md](CONSTRUCT.md) for the user-facing observability UI pages.
See [RESEARCH.md](RESEARCH.md) for the autonomous research system.

## Architecture Overview

```
Claude CLI JSONL files
  ~/.claude/projects/<project>/<session>.jsonl
  ~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl
       │
       ▼
  ┌─────────┐     ┌────────────┐     ┌──────────┐
  │  Parser  │────▶│ Aggregator │────▶│ API      │───▶ UI
  └─────────┘     └────────────┘     └──────────┘
       │                                   │
       │                              ┌────┴────┐
       │                              │ SQLite  │
       │                              │ queries │
       │                              └────┬────┘
       │                                   │
  ┌────┴─────┐                    ┌────────┴────────┐
  │ Pricing  │                    │  construct.db    │
  └──────────┘                    │  memory sqlite   │
                                  └─────────────────┘
```

All telemetry is read-only against Claude CLI's JSONL output. Construct never writes to those files.

## Data Sources

### JSONL session files

Claude CLI writes one JSONL file per session under `~/.claude/projects/<project>/<sessionId>.jsonl`. Subagent sessions live at `<session>/subagents/agent-<id>.jsonl`.

Each line is a JSON object with a `type` field. The parser handles:

| `type` | What it contains |
|---|---|
| `assistant` | `message.model`, `message.usage` (token counts), `message.content[]` (tool_use blocks) |
| `user` | `message.content` (text or array with `tool_result` blocks) |
| `progress` | Hook execution progress: `data.hookEvent`, `data.hookName`, `data.command` |
| `system` | Subtypes: `stop_hook_summary` (hook timing/exit codes), `turn_duration` (API latency), `compact_boundary` (compaction events) |

### Construct DB (`construct.db`)

Contains the `obs_memory_snapshots` table for memory health tracking. See [Database Tables](#database-tables).

### Memory DB (`data/memory/sqlite_vec.db`)

External SQLite database owned by `mcp-memory-service`. Read-only access for memory item browsing and snapshot statistics. Queried tables: `memories` (fields: `id`, `content`, `memory_type`, `tags`, `created_at`, `updated_at`, `deleted_at`).

## Parser (`@construct/telemetry` — `parser.ts`)

### File discovery

`discoverJsonlFiles(baseDir, since?)` scans `~/.claude/projects/` for `.jsonl` files. When `since` is provided, filters by file `mtime`. Discovers both main session files and subagent files under `<session>/subagents/`.

### Caching

In-memory `Map<filePath, { mtimeMs, entries[] }>`. Files are re-parsed only when their `mtime` changes. Cache is per-process lifetime (not persisted).

### Line parsing

`parseLine(line, project, fallbackSessionId?)` produces 0-N `SessionEntry` objects per JSONL line:

| JSONL type | Output entries |
|---|---|
| `assistant` | One `tokens` entry (with token counts) + one `tool_use` entry per tool call. For `Edit`: computes `linesAdded`/`linesRemoved` from diff. For `Write`: `linesAdded` from content line count. |
| `user` | One `user_message` entry (text truncated to 500 chars) + one `tool_result` per tool result block |
| `progress` (hook) | One `hook_progress` entry |
| `system/stop_hook_summary` | One `stop_hook_summary` entry per hook in `hookInfos[]` |
| `system/turn_duration` | One `turn_duration` entry |
| `system/compact_boundary` | One `compact_boundary` entry |

### Skill detection

At module load, reads `~/.claude/commands/*.md` filenames into a `Set`. When a `Skill` tool invocation matches a known command name, it is prefixed with `/` in the `skillName` field.

### Public API

| Function | Description |
|---|---|
| `parseAllSessions(opts?)` | Discover and parse all JSONL files. Options: `since`, `projects`, `baseDir`. |
| `parseSessionsForDays(days, opts?)` | Convenience: sets `since = now - N days`, calls `parseAllSessions`. |
| `clearCache()` | Clears the in-memory file cache. |

## Core Types (`types.ts`)

### `SessionEntry`

The fundamental unit — one parsed event from a JSONL line:

```typescript
{
  sessionId: string;
  parentSessionId?: string;       // set for subagent entries
  timestamp: string;              // ISO 8601
  project: string;
  model?: string;
  entryType: "tool_use" | "tool_result" | "hook_progress" |
             "stop_hook_summary" | "turn_duration" | "tokens" |
             "user_message" | "compact_boundary";
  // Tool fields
  toolName?: string;
  toolParams?: Record<string, unknown>;
  skillName?: string;
  isError?: boolean;
  errorMessage?: string;
  toolUseId?: string;
  toolDurationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  // Hook fields
  hookEvent?: string;
  hookName?: string;
  hookCommand?: string;
  hookDurationMs?: number;
  hookExitCode?: number;
  hookOutput?: string;
  // Token fields
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  // Other
  userRequest?: string;
  turnDurationMs?: number;
  compactTrigger?: string;
  compactPreTokens?: number;
  role?: "user" | "assistant";
  gitBranch?: string;
  cwd?: string;
}
```

### Bucket types

| Type | Fields | Used by |
|---|---|---|
| `TimeBucket` | `date, count` | Tools, hooks, skills, compaction |
| `TokenBucket` | `date, input, output, cacheRead, cacheCreation` | Tokens |
| `CostBucket` | `date, usd` | Cost |
| `SessionBucket` | `date, sessions, messages, userMessages?, assistantMessages?` | Overview, sessions |
| `ProjectBucket` | `project, sessions` | Sessions |

### Metric types

| Type | Fields |
|---|---|
| `ToolMetric` | `name, count, errorCount, pct, active?, lastUsed?, avgMs?, p50Ms?, p95Ms?` |
| `HookMetric` | `command, event, count, avgMs, p50Ms, p95Ms, errors, active?, fullCommand?` |
| `SkillMetric` | `skill, count, pct, errors, lastUsed?` |
| `SessionMetric` | `sessionId, parentSessionId?, project, durationMs, userMessages, assistantMessages, toolCalls, cost, linesAdded, linesRemoved, commits, compactions, firstTimestamp, lastTimestamp, gitBranch?, hasSubagents?` |
| `ModelCost` | `model, usd, pct` |

### Aggregate output types

| Type | Key fields |
|---|---|
| `OverviewData` | `sessions, messages, toolCalls, toolErrors, hookErrors, totalCost, byDay[]` |
| `ToolsData` | `ranked: ToolMetric[], byDay[]` |
| `HooksData` | `ranked: HookMetric[], byDay[]` |
| `SkillsData` | `ranked: SkillMetric[], byDay[]` |
| `TokensData` | `totalInput, totalOutput, totalCacheRead, totalCacheCreation, cacheEfficiency, byDay[]` |
| `CostData` | `totalUsd, byDay[], byModel: ModelCost[]` |
| `SessionsData` | `sessions: SessionMetric[], byDay[], byProject[], byActivity[], avgDurationMs, totalUserMessages, totalAssistantMessages, totalLinesAdded, totalLinesRemoved, totalCommits` |
| `ToolDetailData` | `name, totalCount, errorCount, byDay[], invocations[]` |
| `HookDetailData` | `command, event, totalCount, avgMs, p50Ms, p95Ms, errors, fullCommand?, byDay[], invocations[]` |
| `SkillDetailData` | `skill, totalCount, errorCount, byDay[], invocations[]` |
| `MemoryUsageData` | `stores, searches, byDay[]` |
| `CompactionData` | `totalCompactions, totalTokensAtCompaction, avgPreTokens, byDay[], events[]` |
| `ApiDurationData` | `avgMs, p50Ms, p95Ms, byDay[]` |
| `TraceData` | `sessionId, parentSessionId?, project, turns: TraceTurn[], totalDurationMs, totalTokens, totalCost` |
| `HookEventData` | `events: HookEventSummary[], invocations: HookInvocation[]` |
| `StatusSummary` | `sessions, messages, toolCalls, totalCostUsd, topTools[], topHooks[], topSkills[]` |

### Trace types

| Type | Fields |
|---|---|
| `TraceSpan` | `id, kind: "tool"\|"hook"\|"token", label, startMs, durationMs, isError?, detail?, toolUseId?, subagentSessionId?` |
| `TraceTurn` | `index, userMessage, startTime, durationMs, spans[], tokenCount?, cost?, model?` |

## Aggregator (`aggregator.ts`)

All functions accept `entries: SessionEntry[]` and optional `granularity: Granularity` (default `"day"`). The `bucketKey` helper slices timestamps to `YYYY-MM-DD` (day), `YYYY-MM-DDTHH` (hour), or `YYYY-MM-DDTHH:MM` (minute).

| Function | What it computes |
|---|---|
| `aggregateOverview` | Unique sessions, total messages, tool calls/errors, hook errors, total cost, daily session/message counts |
| `aggregateTools` | Per-tool: count, errors, last used, latency percentiles (p50/p95), daily breakdown |
| `aggregateHooks` | Per-hook: count (from `stop_hook_summary` + `hook_progress`), timing percentiles, errors, daily breakdown |
| `aggregateSkills` | Per-skill: count, percentage, errors, last used, daily breakdown |
| `aggregateTokens` | Total input/output/cache tokens, cache efficiency, daily token buckets |
| `aggregateCost` | Total USD, daily cost, per-model cost breakdown with percentages |
| `aggregateSessions` | Per-session metrics (duration, messages, tools, cost, lines changed, commits, compactions), daily/project/activity breakdowns |
| `aggregateToolDetail` | Single tool drill-down: daily + hourly breakdown, last 200 invocations with params and errors |
| `aggregateHookDetail` | Single hook drill-down: timing stats, daily averages, last 200 invocations with exit codes and output |
| `aggregateSkillDetail` | Single skill drill-down: daily breakdown, last 200 invocations with user request context |
| `aggregateHookEvents` | Grouped by event type: counts per event, hook sets, last 500 invocations with per-hook timing |
| `aggregateMemoryUsage` | Counts of `memory_store` and `memory_search` tool calls, daily breakdown |
| `aggregateCompaction` | Compaction count, token stats at compaction, daily breakdown, last 100 events |
| `aggregateApiDuration` | API latency from `turn_duration`: avg/p50/p95, daily averages |
| `aggregateSessionTrace` | Single session turn-by-turn: splits at `user_message` entries, builds `TraceSpan[]` per turn, links subagent spans by time proximity |
| `getRecentEvents` | Paginated raw event list with type/search filtering |
| `getStatus` | Convenience: parses last N days, runs overview + tools + hooks + skills + cost, returns `StatusSummary` with top-5 tools, top-3 hooks, top-3 skills |

## Pricing (`pricing.ts`)

`calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens)` returns USD.

Uses prefix matching against known models:

| Model prefix | Input/M$ | Output/M$ | Cache Read/M$ | Cache Write/M$ |
|---|---|---|---|---|
| `claude-opus-4` | 15.00 | 75.00 | 1.50 | 18.75 |
| `claude-sonnet-4` | 3.00 | 15.00 | 0.30 | 3.75 |
| `claude-haiku-4` | 0.80 | 4.00 | 0.08 | 1.00 |
| `claude-3-5-sonnet` | 3.00 | 15.00 | 0.30 | 3.75 |
| `claude-3-5-haiku` | 0.80 | 4.00 | 0.08 | 1.00 |

Returns 0 for unknown models.

## Memory Snapshots (`obs-snapshot.ts`)

Standalone script spawned fire-and-forget by `session-start.ts`. Reads the memory DB, computes statistics, and writes a row to `construct.db`.

**What it reads** from `memories` table:
- Total count (non-deleted)
- Count by `memory_type`
- Tag distribution (parses comma-separated or JSON-array `tags` column)
- Stale count (entries not updated in 30+ days, using Unix timestamp `updated_at`)

**Health score:** `max(0, 1 - stale/total)`, rounded to 2 decimal places.

**What it writes:** one row to `obs_memory_snapshots`.

## Database Tables

### `obs_memory_snapshots` (in `construct.db`)

```sql
CREATE TABLE IF NOT EXISTS obs_memory_snapshots (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at TEXT    NOT NULL DEFAULT (datetime('now')),
  total    INTEGER NOT NULL,
  by_type  TEXT    NOT NULL,   -- JSON: {"observation": 5, "decision": 3, ...}
  health   TEXT    NOT NULL,   -- JSON: {"score": 0.85, "stale": 12}
  by_tag   TEXT    NOT NULL    -- JSON: {"session_context": 10, "pattern": 5, ...}
);
CREATE INDEX IF NOT EXISTS idx_obs_memory_taken_at ON obs_memory_snapshots(taken_at);
```

Created by both `obs-snapshot.ts` and the API server's `onReady` hook.

## API Endpoints

All endpoints are under `/api/observability/`. Routes with `parseDaysPreHandler` accept:
- `?range=1h|1d|7d|30d|session` — time window
- `?days=N` — alternative to range (1-365)
- `?granularity=minute|hour|day` — bucket size (default: day)
- `?session=<id>` — filter to a single session

All responses include `queryTimeMs`.

The API server runs on port 3001 in dev (`bun dev-server.ts`) and port 3000 in production (systemd `construct-ui.service`).

| Method | Path | Aggregator | Notes |
|---|---|---|---|
| GET | `/overview` | `aggregateOverview` | |
| GET | `/tools` | `aggregateTools` | Adds `active` flag (used within 7 days) |
| GET | `/tools/:name` | `aggregateToolDetail` | |
| GET | `/hooks` | `aggregateHooks` | Adds `active` flag (file exists), returns `unused[]` from settings.json |
| GET | `/hooks/:name` | `aggregateHookDetail` | Adds `active` flag, `sourceCode` (reads hook file) |
| GET | `/hooks/events` | `aggregateHookEvents` | |
| GET | `/skills` | `aggregateSkills` | Returns `unused[]` from skill-rules.json |
| GET | `/skills/:name` | `aggregateSkillDetail` | Returns `sourceContent` (reads SKILL.md) |
| GET | `/tokens` | `aggregateTokens` | |
| GET | `/cost` | `aggregateCost` | |
| GET | `/sessions` | `aggregateSessions` | |
| GET | `/sessions/:id/trace` | `aggregateSessionTrace` | |
| GET | `/memory/usage` | `aggregateMemoryUsage` | |
| GET | `/memory` | direct SQL | Last 100 `obs_memory_snapshots` rows |
| GET | `/memory/items` | direct SQL | Queries `memories` table; `?type`, `?tag`, `?q`, `?limit` |
| POST | `/memory/snapshot` | spawns `obs-snapshot.ts` | Triggers immediate snapshot |
| GET | `/compaction` | `aggregateCompaction` | |
| GET | `/api-duration` | `aggregateApiDuration` | |
| GET | `/events` | `getRecentEvents` | `?type`, `?search`, `?limit`, `?offset` |
| GET | `/db-stats` | direct SQL | File sizes, table names + row counts for construct.db and memory.db |

## CLI Status (`src/status.ts`)

The `ccstatusline` binary and the `/gist` command both call `getStatus(7)` from `@construct/telemetry`, which returns a `StatusSummary` for the last 7 days. The status output includes: session count, message count, tool call count, total cost, top 5 tools, top 3 hooks, and top 3 skills.

## Common Questions

**Q: How do I get the total cost for a specific session?**
Use `GET /api/observability/sessions?session=<id>` — the response includes `SessionMetric.cost` per session. Alternatively, call `GET /api/observability/sessions/:id/trace` which includes per-turn cost breakdown.

**Q: Why does cache efficiency show 0% even though I'm using prompt caching?**
Cache efficiency = `cacheReadTokens / (inputTokens + cacheReadTokens)`. If the selected time window contains no cache reads (e.g. filtering to a single session with no prior cache), it shows 0%. Expand the time range or check that the model and prompt structure support caching.

**Q: How do I add a new model to the pricing table?**
Add an entry to `src/telemetry/src/pricing.ts` using the model prefix as the key. Prefix matching is used: `claude-opus-4` matches `claude-opus-4-6`, `claude-opus-4-5`, etc. Use the most specific prefix that doesn't overlap with other models.

**Q: How often does the in-memory parser cache refresh?**
Files are re-parsed only when their `mtime` changes. The cache lives for the process lifetime — it is not persisted. Restart the API server to force a full re-parse of all JSONL files.

**Q: What JSONL event types does the parser skip?**
The parser handles: `assistant`, `user`, `progress`, `system`. Any other `type` values in the JSONL are silently skipped. This includes any future Claude CLI event types that the parser hasn't been updated to handle.

**Q: How do I query observability data for a specific project only?**
Pass `?projects=<project-name>` to any endpoint that uses `parseDaysPreHandler`. The `projects` parameter filters JSONL discovery to that project's directory under `~/.claude/projects/`.

**Q: How are subagent sessions handled in aggregations?**
Subagent JSONL files live at `<session>/subagents/agent-<id>.jsonl`. The parser discovers them and sets `parentSessionId` on their entries. `aggregateSessions` exposes `hasSubagents` and `parentSessionId` on `SessionMetric`. The Sessions UI page shows subagent sessions indented under their parent.
