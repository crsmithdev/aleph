# Telemetry Module — Agent Guide

Reads Claude Code's JSONL session logs → parses into events → reduces into metrics → served via the observability API.

---

## Key files

| File | Role |
|---|---|
| `src/adapter.ts` | Discovers and parses `~/.claude/projects/**/*.jsonl`; SQLite-backed file cache (`telemetry_cache_v5`); **read-only** against JSONL files |
| `src/reducers.ts` | All aggregation functions — one `reduce*` export per metric type |
| `src/pricing.ts` | `calculateCost()` — prefix-matched model pricing table |
| `src/event.ts` | `TelemetryEvent` — the unit of parsed data flowing between adapter and reducers |
| `src/types.ts` | All metric output types (`OverviewData`, `ToolsData`, `SessionsData`, etc.) |
| `src/index.ts` | Public module exports |

---

## Data flow

```
~/.claude/projects/<project>/<sessionId>.jsonl
~/.claude/projects/<project>/<sessionId>/subagents/agent-<id>.jsonl
        ↓ adapter.ts (parses, caches by mtime+size)
TelemetryEvent[]
        ↓ reducers.ts
Metric types (OverviewData, ToolsData, ...)
        ↓ src/ui/api/src/routes/observability.ts
/api/observability/* endpoints
```

---

## Reducer functions (src/reducers.ts)

Each takes `(events: TelemetryEvent[], granularity?: Granularity)` and returns a typed result:

`reduceOverview`, `reduceTools`, `reduceHooks`, `reduceSkills`, `reduceTokens`, `reduceCost`, `reduceSessions`, `reduceToolDetail`, `reduceHookDetail`, `reduceSkillDetail`, `reduceHookEvents`, `reduceMemoryUsage`, `reduceMemorySearches`, `reduceCompaction`, `reduceApiDuration`, `reduceSessionTrace`, `reduceRecentEvents`, `reduceSubagents`, `reduceVerifications`

Granularity type: `"minute" | "hour" | "day"`

---

## Caching

- **File cache:** SQLite table `telemetry_cache_v5` (keyed by `file_path`, invalidated on `mtime_ms` + `size` change). Process-lifetime, not in-memory Map.
- **Discovery cache:** in-memory, 30s TTL. Caches the list of JSONL files found under the base directory.
- Old cache tables (`telemetry_cache`, `telemetry_cache_v4`) are dropped on startup — do not reference them.

---

## Pricing (src/pricing.ts)

`calculateCost(model, inputTokens, outputTokens)` uses **prefix matching** against the `PRICING` table. A key like `claude-opus-4` matches any model string starting with that prefix.

When adding a new model: use the most specific prefix that does not overlap with existing entries. Overly short prefixes silently match wrong models.

---

## Common mistakes

- JSONL file paths: `~/.claude/projects/<project>/<sessionId>.jsonl` — subagent files are at `<sessionId>/subagents/agent-<id>.jsonl`, not at the top level
- Bucket keys are strings: `YYYY-MM-DD` (day), `YYYY-MM-DDTHH` (hour), `YYYY-MM-DDTHH:MM` (minute) — never Date objects
- The adapter is **read-only** — it never writes to JSONL files
- Cache version is `v5` — if you add a new parsed field, bump to `v6` and drop `v5`
- All path constants come from `src/data/src/paths.ts` (`claudePaths.projects` for JSONL base)
