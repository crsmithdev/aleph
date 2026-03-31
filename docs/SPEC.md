# Construct — Functional Specification

Behavior-oriented spec for functional testing and drift detection. Every claim here is testable.

For the telemetry system architecture, see [TELEMETRY.md](TELEMETRY.md).

## Session Lifecycle

### Starting a session

On `SessionStart`, the user sees:

```
=== Session Start ===
Sessions: <N>

Last session (<filename>):
  - Intent: ...
  - Outcome: ...
  - Tools: ...; files: ...
  - Edits: ...
  - Messages: ...

[memory] Search semantic memory (memory_search) for relevant project context before starting work.
====================
```

- Session count is the number of `.md` files in `data/sessions/`.
- The last session block is shown only when at least one session file exists.
- If sessions occurred since the last interactive session, a background work summary is shown classifying them as completed/in-progress/blocked.
- The 5 most recent semantic memories are recalled from the memory DB and displayed.
- The hook also detects git worktrees and displays the branch name.

### During a session

**Depth classification** — on every prompt (>=3 words), `routing-submit-classify.ts` classifies depth:
- FULL if prompt matches architectural keywords (`architect|redesign|refactor|migrate|schema|structure|plan|propose|authenticat*|authorizat*|integrat*|api endpoint|rename all|move all|replace all|across all|every file|all files|end to end|full stack`) or is >=40 words.
- QUICK otherwise (silent).
- Output when FULL (architectural keywords): `[Construct] Depth: FULL — architectural keywords. Use design-first pipeline.`
- Output when FULL (>=40 words): `[Construct] Depth: FULL — complex request. Consider design-first pipeline.`

**Verification gate injection** — same hook injects e2e requirements for non-question prompts >=5 words: `[Construct] Verification gate active — after making changes, you MUST verify end-to-end: 1. Start the dev server or run the actual system 2. Interact with it (Playwright, Chrome DevTools, or run the CLI) 3. Produce an artifact: screenshot or captured output saved to a file`. Unit tests alone are not sufficient. The Stop hook checks for e2e evidence.

**Skill matching** — same hook checks prompt against `skill-rules.json` keywords. On match: `[Construct] Matched skills: <names>. Activate via Skill() before proceeding.` No match = silent. Project-local skill extensions (`.claude/skills/<skill>.md`) are appended to the base skill when matched.

**Rating capture** — on every prompt, `rating-capture.ts` checks for explicit ratings:
1. Standalone integer 1-10 as the entire prompt
2. N/10 pattern anywhere (e.g. `8/10`)
3. Words "rate"/"rating" plus a 1-10 digit

Matched ratings are appended to `data/signals/ratings.jsonl`:
```json
{"timestamp":"<ISO>","rating":8,"type":"explicit","context":"<first 100 chars>"}
```
Ratings 1-3 trigger a console message: `[Construct] Low rating (N) — store what went wrong via memory_store`. Ratings 4-10 are silent.

**Quality hook** — after every `Edit` or `Write` tool use, `quality-post-format.ts` auto-formats the saved file:
- If `.claude/quality.json` exists in the project, runs its `format` and `lint` commands with `$FILE` substituted.
- Otherwise, extension-based defaults: `.py` -> ruff, `.ts/.tsx/.js/.jsx` -> prettier, `.go` -> gofmt, `.rs` -> rustfmt.
- Skips silently if the formatter binary isn't installed.
- Failures are logged to trace and printed to stderr.

**TypeScript gate** — after every `Edit` or `Write` on `.ts/.tsx` files, `quality-post-typecheck.ts` finds the nearest `tsconfig.json` and runs `tsc --noEmit`. If errors are found, prints a summary of up to 5 errors.

**Database guard** — before any MCP SQL tool call (`execute_sql`, `apply_migration`, `run_query`), `isolation-pre-block-destructive-sql.ts` blocks destructive operations: `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `DELETE FROM` without WHERE, `ALTER TABLE DROP COLUMN`.

### Ending a session

On `Stop`, five hooks fire:

**1. Verification gate** (`quality-stop-check-e2e.ts`) — checks whether the current turn included e2e evidence and an artifact when files were edited:
- If no edits: skips silently.
- If edits present: checks for e2e signals (devserver startup, Playwright/Cypress, browser MCP tools) and artifacts (screenshots, saved output).
- If both e2e evidence and artifact are found: passes silently.
- Otherwise: writes a `require-e2e` marker file and emits a one-shot reminder listing edited files and what was missing. The next Edit or Write tool call is hard-blocked (exit 2) by `quality-pre-require-e2e.ts` until e2e evidence is provided.

**2. Dispatch reminder** (`dispatch-stop-remind.ts`) — if the session ran inline (gate bypassed), emits a reminder to use dispatched mode for future tasks.

**3. Context monitor** (`context-stop-monitor.ts`) — reads token usage from the last assistant message. Warns at 80% of context limit, critical alert at 90%.

**4. Session summary** (`session-summary.ts`) — writes a summary file if the session had >=4 messages:
- Output: `data/sessions/YYYY-MM-DD-HHMMSS.md`
- Contains: intent, outcome, milestones, tools used, files edited, message counts, assistant notes.

**5. Memory extraction** (`memory-extract.ts`) — auto-extracts high-value memories and stores them in semantic memory:
- Skips if session is not substantive (<6 messages or no edits).
- Skips if Claude already called `memory_store` voluntarily.
- Extracts: session summary, user corrections, error resolutions.
- All auto-extracted memories tagged with `auto_extract`.

**Pre-compaction backup** (`context-precompact-backup.ts`) — on `PreCompact`, copies the current transcript JSONL to `~/.claude/transcript-backups/` before Claude compacts the conversation.

## Statusline

Rendered continuously via `StatusUpdate` event:

```
<model name>  ⎇ <git branch>  <dir name>  [████░░░░░░] 42%
```

Uses `ccstatusline` binary. Shows model display name, git branch, cwd, context window bar + percentage.

## Notifications

On `Notification` events (`idle`, `permission`, `complete`):
- **WSL**: Windows Toast via PowerShell WinRT APIs.
- **macOS**: `osascript display notification`.
- **Fallback**: terminal bell.

## Skills

Skills are domain-specific playbooks activated by keyword matching. Each lives in `construct/skills/<name>/SKILL.md`.

| Skill | Activated by | Purpose |
|---|---|---|
| research | research, investigate, compare, survey | Structured research with parallel search and source evaluation |
| verification | verify that, confirm passing, prove it works | Iron-law gate: no completion claim without running evidence |
| debugging | debug, bug, broken, failing, error, crash | Four-phase root-cause-first methodology |
| build | build, implement, add feature, refactor, overhaul | Unified implementation lifecycle: design, plan, TDD execute, review, finish |
| code-review | dead code, unused, clean up, code review | Scan for 9 categories of issues, verify before removing |
| docs-review | doc sync, docs drift, documentation mismatch | Verify every factual claim in docs against truth sources |
| hooks-review | hook review, hook audit | Review hook scripts for correctness, safety, and settings.json alignment |
| commands-review | command review, command audit | Review slash command definitions for clarity and registration |
| skills-review | skill review, skill audit | Review SKILL.md files for quality and skill-rules.json alignment |
| config-review | config review, settings review | Review settings.json and CLAUDE.md for consistency |
| ralph-loop | ralph, autonomous loop, keep iterating | Iterative autonomous development via subagents |
| finishing-branch | finish branch, merge branch, create pr | Verify tests, present merge/PR/keep/discard options |
| git-worktrees | worktree, create worktree, isolated branch | Set up isolated worktree with dependency install and baseline tests |

## Slash Commands

### Installed globally (`dotclaude/commands/` -> `~/.claude/commands/`)

| Command | Behavior |
|---------|----------|
| `/gist` | Surface Claude's current mental model + project understanding |
| `/goal` | Manage goals: list, create, update, delete, show, done, archive |
| `/todo` | Manage todos: list, add, recurring, delete |
| `/finish` | Mark a todo or goal as done (done/undone operations) |

### Project-level (`.claude/commands/` — Construct repo only)

| Command | Behavior |
|---------|----------|
| `/install` | Runs `bun install.ts`, then auto-runs post-install verification |
| `/trace` | Toggle hook tracing (or one-shot trace a command) |
| `/audit` | Full project audit: code, refs, instructions, docs, spec |
| `/devserver` | Kill dev ports, start UI dev server in background |
| `/todo` | File items from review output into `docs/TODO.md` |

## UI — Life Pages

### Summary (`/summary`)

Daily activity digest. Shows stat cards (goals created/completed, todos completed, notes added) and a plain-text summary block for the selected period. Presets: Today, Yesterday, This Week, Last Week, Custom (date pickers). Copy button exports the summary as plain text.

### Goals (`/goals`)

Browse and manage goals. Filterable by state, priority, and category. Toggles for archived and completed goals. Group-by-category view with colour-coded section headers. Inline goal creation form.

### Goal Detail (`/goals/:id`)

Full goal view with inline-editable title, priority/state selects, category management (add/remove chips with colour picker), notes (add/edit/delete with Markdown), and a history timeline of all changes. Finish/reopen and archive/unarchive actions.

### Todos (`/todos`)

Daily task list split into Active and Completed Today sections. Quick-add bar at top. Each todo supports inline title editing, note expansion, completion, deletion, and linked goal display.

### Habits (`/habits`)

Daily/weekly/monthly habit tracker. Create habits with frequency selection. Toggle completion for the current period. Shows streak count (gold <7d, green >=7d) and missed-period warnings. Inactive habits dimmed at bottom.

## UI — Observability Pages

All observability pages share a control bar with time range selector (Session/1h/1d/7d/30d), optional granularity picker (Hour/Day), and filter toggles. Each page shows server-side query timing.

For the data behind these pages, see [TELEMETRY.md](TELEMETRY.md).

### Overview (`/observability/overview`)

Dashboard with stat cards: Sessions, Messages, Tool Calls, Tool Success %, Total Cost, API Latency (avg + p95), Compactions, Lines Changed, Commits. Area/bar chart of messages and sessions over time.

### Tools (`/observability/tools`)

Ranked tool table: status dot, name, count, errors, %, avg/p95 latency, usage bar. Chart of tool calls over time. "Active only" filter. Click to drill down.

### Tool Detail (`/observability/tools/:name`)

Stats: invocations, errors, success rate. Chart over time. Table of recent invocations with expandable params JSON. "Errors only" filter. Error rows highlighted.

### Hooks (`/observability/hooks`)

Two views toggled by segmented control:
- **By Hook**: ranked table (status, command, event, count, errors, success %, timing), chart over time, active/unused filters.
- **By Event**: event summary cards (count + registered hooks), filterable invocation table with expandable per-hook timing.

### Hook Detail (`/observability/hooks/:name`)

Stats: executions, avg/p50/p95 latency, success rate. Chart over time. Recent executions table with exit codes, duration, output. Hook source code viewer at bottom.

### Skills (`/observability/skills`)

Ranked skill table with usage bars. Unused skills shown dimmed. Chart over time. Click to drill down.

### Skill Detail (`/observability/skills/:name`)

Stats: invocations, errors, success rate. Chart over time. Recent invocations table with user request context. Full skill source rendered as Markdown.

### Tokens & Cost (`/observability/tokens`)

Stats: total cost, daily average, cache efficiency %, total tokens (input/output). Stacked area chart of token types per day. Cost chart per day. Model cost breakdown table.

### Sessions (`/observability/sessions`)

Stats: session count, avg duration, user/assistant messages, lines changed, commits. Daily session chart. Activity chart. Session table (up to 50) with duration, messages, tools, cost, lines, commits, branch. Subagent sessions shown indented. "Subagent" and "Dispatcher" filter toggles. Sessions-by-project table.

### Session Trace (`/observability/sessions/:id`)

Turn-by-turn breakdown: duration, turns, tool calls, hook runs, tokens, cost. Turn table with prompt preview, tools, hooks, errors, cost. "Tool" and "Subagent" filters. Click to drill into individual turns.

### Turn Trace (`/observability/sessions/:id/turns/:turnIndex`)

Deepest drill-down. User prompt text. Stats: duration, tools, hooks, tokens, cost, errors. Colour-coded sequence bar (waterfall): blue=tool, purple=hook, red=error, dark=LLM thinking. Event table with type, name, start offset, duration, % of total. Expandable detail (tool params JSON, subagent links). "Internal" toggle to show/hide LLM thinking segments. Prev/next turn navigation.

### Events (`/observability/events`)

Raw event log. Paginated table (100/page): time, type badge, detail, info preview, session. Event type filter toggles, errors filter, debounced search. Expandable row details (full params, hook output, error messages, token breakdowns).

### Memory (`/observability/memory`)

Stats from latest snapshot: total memories, health score, stale count, store/search counts. Store+search operations chart. By-type and top-tags tables (clickable to filter browser). Memory count trend chart. Memory browser: searchable/filterable list of individual items with content preview, type, age, tags. "Take Snapshot" button.

### Database (`/observability/db`)

Per-database: file size, WAL size (warning if >10MB), table count, total rows. Table-level row counts.

## UI — Settings (`/settings`)

### Build

Git revision (short hash + branch), commit count, last commit message + date, install timestamp (greyed dash if absent), Bun version, platform/arch.

### Paths

`CLAUDE_ROOT` shown prominently. All derived paths (source repo, construct, commands, skills, databases, sessions, ratings, backups) shown dimmed. Absent values displayed as a greyed dash.

### Runtime

Node environment, API port, DB size on disk.

### Backup

List of existing backups with filename, creation date, file size. Create and restore controls.

## Installer

**Invocation:** `bun install.ts` from repo root.

**Steps:**
1. Ensure data directories exist (`data/{sessions,signals,backups}`)
2. Migrate data from old locations (one-time)
3. Back up preserved files (ALL CAPS `.md` in `core/identity/` and `memory/`) to temp dir
4. Back up the database (last 5 backups kept)
5. Stop UI service
6. Sync `src/` -> `~/.claude/construct/` (overwrite + delete stale, skip `.db` files and `node_modules`)
7. Install UI dependencies
8. Restore preserved files (byte-size verified)
9. Sync commands from `dotclaude/commands/` and register skills as commands
10. Merge `settings.json` — replaces `hooks` and `statusLine` only, rewrites paths to absolute
11. Update `CLAUDE.md` — replaces `# Construct` section in-place, preserves surrounding content
12. Verify critical files (byte-size check)
13. Write build manifest (git info, paths, timestamps)
14. Restart UI service

**Preserved on upgrade:** ALL CAPS `.md` files in `core/identity/` and `memory/`.

**Overwritten on upgrade:** all hooks, skills, meta files, non-ALLCAPS files in construct/.

## Path Resolution

All paths derive from a single root: `CLAUDE_ROOT` (env var, defaults to `~/.claude`).

| Path | Derivation |
|---|---|
| `construct/` | `CLAUDE_ROOT/construct` |
| `commands/` | `CLAUDE_ROOT/commands` |
| `data/` | `CLAUDE_ROOT/data` (overridable via `CONSTRUCT_DATA_ROOT`) |
| `data/construct.db` | `DATA_ROOT/construct.db` |
| `data/memory/sqlite_vec.db` | `DATA_ROOT/memory/sqlite_vec.db` (overridable via `MEMORY_DB_PATH`) |
| `data/sessions/` | `DATA_ROOT/sessions` |
| `data/signals/ratings.jsonl` | `DATA_ROOT/signals/ratings.jsonl` |
| `data/backups/` | `DATA_ROOT/backups` |

**Dev isolation:** when running from the source repo (detected by presence of both `install.ts` and `src/data/src/paths.ts` at or above cwd), `CLAUDE_ROOT` auto-defaults to `<repo>/.dev/` instead of `~/.claude`. This prevents accidental production writes during development.

## Identity Layer

Four optional files in `construct/core/identity/`, preserved on upgrade:

| File | Purpose |
|------|---------|
| SOUL.md | Values, mental models, known biases |
| IDENTITY.md | Tone, personality, boundaries |
| STYLE.md | Code and communication formatting |
| USER.md | Principal profile, environment, preferences |

## Hook Registration

All hooks in `settings.json`:

| Event | Hooks (in order) | Timeouts |
|-------|-----------------|----------|
| SessionStart | memory/hooks/session-start.ts | 5000ms |
| UserPromptSubmit | memory/hooks/rating-capture.ts, skills/hooks/routing-submit-classify.ts | 2000ms, 3000ms |
| Stop | skills/hooks/quality-stop-check-e2e.ts, skills/hooks/context-stop-monitor.ts, memory/hooks/session-summary.ts, memory/hooks/memory-extract.ts | 3000ms, 3000ms, 3000ms, 5000ms |
| PreToolUse | skills/hooks/isolation-pre-block-destructive-sql.ts (matcher: `mcp__.*(?:execute_sql\|apply_migration\|run_query)`) | 3000ms |
| PostToolUse | skills/hooks/quality-post-format.ts (matcher: `Edit\|Write`), skills/hooks/quality-post-typecheck.ts (matcher: `Edit\|Write`) | 10000ms, 15000ms |
| PreCompact | skills/hooks/context-precompact-backup.ts | 5000ms |
| Notification | skills/hooks/notify-event-toast.ts | 3000ms |

## Trace Mode

- Flag file: `~/.claude/construct/.trace`
- When present: hooks emit trace output to stdout via `trace()` calls
- Toggled by `/trace` command

## Module Detection

| Module | Detection file |
|------|---------------|
| construct-core | `~/.claude/CLAUDE.md` |
| construct-memory | `construct/memory/hooks/session-start.ts` |
| construct-skills | `construct/skills/skill-rules.json` |
| construct-data | `construct/data/src/client.ts` |
| construct-eval | `construct/eval/runner.ts` |
| construct-goals | `construct/goals/src/index.ts` |
| construct-ui | `construct/ui/api/src/app.ts` |
