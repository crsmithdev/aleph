# Hooks

Hook scripts live in two locations under `src/`:

- `src/core/hooks/` — quality, isolation, git, context, routing, security
- `src/memory/hooks/` — session lifecycle and memory

They are registered in `src/core/hooks/settings-hooks.json` and installed to `~/.claude/settings.json` via `bun install.ts`.

## Registration table

| Event | Hook name | Script | Matcher | Timeout | Fails | Downstream | Observability logging |
|---|---|---|---|---|---|---|---|
| SessionStart | context-restore-start | `src/memory/hooks/context-restore-start.ts` | — | 5000ms | Open | reads `compaction-notes.json` + session files + MCP memories → stdout advisory to Claude | `hook-events.jsonl` — base fields only |
| UserPromptSubmit | rating-capture-submit | `src/memory/hooks/rating-capture-submit.ts` | — | 2000ms | Open | writes `signals/ratings.jsonl` → observability UI ratings page | `hook-events.jsonl` — base fields; `signals/ratings.jsonl` — `{rating, type, context}` |
| UserPromptSubmit | feedback-capture-submit | `src/memory/hooks/feedback-capture-submit.ts` | — | 3000ms | Open | writes `signals/feedback.jsonl` → consolidation pipeline | `hook-events.jsonl` — base fields only |
| UserPromptSubmit | routing-classify-submit | `src/core/hooks/routing-classify-submit.ts` | — | 3000ms | Open | writes `signals/directives.jsonl` → `quality-check-stop` (depth gate) + eval harness; stdout skill matches → Claude | `hook-events.jsonl` — base fields only |
| Stop | quality-check-stop | `src/core/hooks/quality-check-stop.ts` | — | 3000ms | Open | writes `hook-events.jsonl` via `reportHook` → observability UI; stdout advisory → Claude | `hook-events.jsonl` — `{decision, tier, detail}` (only hook with structured payload beyond base fields) |
| Stop | git-hygiene-stop | `src/core/hooks/git-hygiene-stop.ts` | — | 5000ms | **Blocking** | stdout block decision → Claude (branch/commit/push violations); advisory when pre-existing mess | `hook-events.jsonl` — base fields only |
| Stop | context-monitor-stop | `src/core/hooks/context-monitor-stop.ts` | — | 3000ms | Open | stdout advisory only → Claude | `hook-events.jsonl` — base fields only |
| Stop | context-save-stop | `src/memory/hooks/context-save-stop.ts` | — | 3000ms | Open | writes `sessions/YYYY-MM-DD-HHMMSS.md` → `context-restore-start` (last session briefing) | `hook-events.jsonl` — base fields only |
| Stop | memory-extract-stop | `src/memory/hooks/memory-extract-stop.ts` | — | 5000ms | Open | writes to MCP semantic store → `context-restore-start` (top 5 memories) | `hook-events.jsonl` — base fields only |
| Stop | memory-consolidate-stop | `src/memory/hooks/memory-consolidate-stop.ts` | — | 3000ms | Open | spawns `consolidator.ts` fire-and-forget when threshold met | `hook-events.jsonl` — base fields only |
| PostToolUse | signal-capture-posttooluse | `src/memory/hooks/signal-capture-posttooluse.ts` | `Edit\|Write` | 3000ms | Open | writes re-edit signals to `signals/tool-signals.jsonl` → consolidation pipeline | `hook-events.jsonl` — base fields only |
| PreToolUse | isolation-block-sql | `src/core/hooks/isolation-block-sql.ts` | `mcp__.*(?:execute_sql\|apply_migration\|run_query)` | 3000ms | **Closed** | exit 2 blocks tool call; stderr advisory → Claude | `hook-events.jsonl` — base fields only |
| PreToolUse | git-require-edit | `src/core/hooks/git-require-edit.ts` | `Edit\|Write` | 5000ms | Open | writes `signals/git-require-edit-{sessionId}` marker → `observability.ts` (active gate stats); stdout advisory → Claude | `hook-events.jsonl` — base fields only |
| PreToolUse | context-suggest-edit | `src/core/hooks/context-suggest-edit.ts` | `Edit\|Write` | 3000ms | Open | writes `/tmp/construct-compact-{sessionId}` (internal counter only, never read elsewhere); stdout advisory → Claude | `hook-events.jsonl` — base fields only |
| PreToolUse | security-scan-bash | `src/core/hooks/security-scan-bash.ts` | `Bash` | 5000ms | Open | stderr advisory only → Claude | `hook-events.jsonl` — base fields only |
| PostToolUse | quality-format-edit | `src/core/hooks/quality-format-edit.ts` | `Edit\|Write` | 10000ms | Open | modifies files in place → consumed by Claude and subsequent tools naturally | `hook-events.jsonl` — base fields only |
| PostToolUse | quality-typecheck-edit | `src/core/hooks/quality-typecheck-edit.ts` | `Edit\|Write` | 15000ms | Open | stderr type errors → Claude (advisory) | `hook-events.jsonl` — base fields only |
| PreCompact | context-backup-precompact | `src/core/hooks/context-backup-precompact.ts` | — | 5000ms | Open | writes `signals/compaction-notes.json` → `context-restore-start` (context bridge) | `hook-events.jsonl` — base fields only |

**Base fields** logged by every hook via `reportHook()`: `{ts, hook, event, sessionId}`. All entries land in `~/.construct/signals/hook-events.jsonl` and are visible in the observability UI Hooks page (aggregated by hook name and event type).

**Fails closed** = PreToolUse exit code 2 blocks the tool call. Only PreToolUse hooks can fail closed.  
**Fails open** = hook prints advisory output but cannot prevent the action.

1 hard gate (PreToolUse exit 2), 1 blocking stop hook (git-hygiene-stop), 16 open advisories.

## By area

### Memory (src/memory/hooks/)

**context-restore-start** fires on SessionStart. Shows session count, the last session summary (intent, outcome, tools, edits, messages), a briefing for any background sessions since the last interactive one, and top 5 semantic memories. Also fires `obs-snapshot.ts` fire-and-forget to capture memory health.

**rating-capture-submit** fires on every UserPromptSubmit. Extracts explicit ratings (standalone 1–10, "N/10" pattern, "rate"/"rating" + digit) and appends to `~/.construct/signals/ratings.jsonl`. Ratings 1–3 trigger a console reminder to log what went wrong.

**context-save-stop** fires on Stop. Writes a structured session file to `~/.construct/sessions/YYYY-MM-DD-HHMMSS.md` if the session had ≥4 messages. Contains intent, outcome, milestones, tools, files, and message counts.

**memory-extract-stop** fires on Stop. Auto-extracts high-value memories to the semantic store if the session is substantive (≥6 messages + edits) and Claude has not already called `memory_store` voluntarily.

### Quality (src/core/hooks/)

**quality-format-edit** fires on PostToolUse (Edit/Write). Runs the appropriate formatter by file extension: prettier for TS/JS, ruff for Python, gofmt for Go, rustfmt for Rust. Respects `.claude/quality.json` for project-level overrides. Auto-formats in place.

**quality-typecheck-edit** fires on PostToolUse (Edit/Write on .ts/.tsx). Finds the nearest tsconfig.json and runs `tsc --noEmit`. Reports up to 5 errors. Does not block — edit already happened.

**quality-check-stop** fires on Stop. Scans the current turn for edits. If edits are present but no e2e evidence exists (Playwright, CLI execution, browser tools) and no artifacts (screenshots, saved output), emits an advisory reminder.

### Context (src/core/hooks/)

**context-monitor-stop** fires on Stop. Reads token usage and warns at 80% context, critical alert at 90%. Auto-detects 1M extended context.

**context-backup-precompact** fires on PreCompact. Parses the last ~120 transcript lines and writes a working-state snapshot to `~/.construct/signals/compaction-notes.json` (recent prompts, working files, errors, last assistant snippet). `context-restore-start` injects these notes at next session start if the file is less than 12 hours old, bridging context across compaction boundaries.

**context-suggest-edit** fires on PreToolUse (Edit/Write). Suggests context compaction when appropriate. Advisory only.

### Isolation (src/core/hooks/)

**isolation-block-sql** fires on PreToolUse for SQL MCP tools (`execute_sql`, `apply_migration`, `run_query`). Hard-blocks `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `DELETE FROM` without WHERE, `ALTER TABLE DROP COLUMN`. Exit 2.

### Git (src/core/hooks/)

**git-require-edit** fires on PreToolUse (Edit/Write). Runs `git status --porcelain` and groups dirty files by top-level directory (first 2 path segments, e.g. `src/telemetry`). Emits an advisory when ≥3 distinct dirty groups are detected. Advisory only — never blocks. This detects multiple unrelated logical changes better than raw file counts — editing 10 files in `src/ui/` is one group, but touching `src/ui/`, `src/telemetry/`, and `docs/` is three.

### Routing and security (src/core/hooks/)

**routing-classify-submit** fires on UserPromptSubmit. Classifies prompt depth (QUICK vs FULL), detects architectural keywords, matches the prompt against `skill-rules.json`, writes directive signals for matched skills and dispatch mode, and injects a verification gate reminder for non-question prompts ≥5 words.

**security-scan-bash** fires on PreToolUse (Bash). Scans bash commands for security issues. Advisory only.

## Naming convention

Hook filenames follow `{area}-{verb}-{event}.ts`.

- **area**: quality, context, isolation, git, routing, security, memory
- **verb**: what the hook does (format, typecheck, check, monitor, backup, restore, save, block, require, classify, scan, suggest, extract, capture)
- **event**: edit (Edit/Write Pre/PostToolUse), stop (Stop), submit (UserPromptSubmit), start (SessionStart), precompact (PreCompact), sql (SQL PreToolUse), bash (Bash PreToolUse)

This order puts intent first — scanning a list of hooks by name shows what each does before when it fires. Hooks that form writer/reader pairs become obvious: `context-backup-precompact` + `context-save-stop` both feed `context-restore-start`.

For deferred enforcement — where a non-PreToolUse hook writes a marker and a PreToolUse hook reads it and blocks — use `require-{condition}` for the reader and `check-{condition}` for the writer.
