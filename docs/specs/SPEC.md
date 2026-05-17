# Construct — Functional Specification

Behavior-oriented spec for functional testing and drift detection. Every claim here is testable.

For the telemetry system architecture, see [TELEMETRY.md](TELEMETRY.md).
For the autonomous research system, see [RESEARCH.md](RESEARCH.md).

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

**Depth classification** — on every prompt (>=3 words), `routing-classify-submit.ts` classifies depth:
- FULL if prompt matches architectural keywords (`architect|redesign|refactor|migrate|schema|structure|plan|propose|authenticat*|authorizat*|integrat*|api endpoint|rename all|move all|replace all|across all|every file|all files|end to end|full stack`) or is >=40 words.
- QUICK otherwise (silent).
- Output when FULL (architectural keywords): `[Construct] Depth: FULL — architectural keywords. Use design-first pipeline.`
- Output when FULL (>=40 words): `[Construct] Depth: FULL — complex request. Consider design-first pipeline.`

**Verification gate injection** — same hook injects e2e requirements for non-question prompts >=5 words: `[Construct] Verification gate active — after making changes, you MUST verify end-to-end: 1. Run the actual system 2. Interact with it (Playwright, Chrome DevTools, or run the CLI) 3. Produce an artifact: screenshot or captured output saved to a file`. Unit tests alone are not sufficient. The Stop hook checks for e2e evidence.

**Skill matching** — `routing-classify-submit.ts` also checks prompt against `skill-rules.json` keywords. On match: `[Construct] Matched skills: <names>. Activate via Skill() before proceeding.` No match = silent. Project-local skill extensions (`.claude/skills/<skill>.md`) are appended to the base skill when matched.

**Rating capture** — on every prompt, `rating-capture-submit.ts` checks for explicit ratings:
1. Standalone integer 1-10 as the entire prompt
2. N/10 pattern anywhere (e.g. `8/10`)
3. Words "rate"/"rating" plus a 1-10 digit

Matched ratings are appended to `data/signals/ratings.jsonl`:
```json
{"timestamp":"<ISO>","rating":8,"type":"explicit","context":"<first 100 chars>"}
```
Ratings 1-3 trigger a console message: `[Construct] Low rating (N) — store what went wrong via memory_store`. Ratings 4-10 are silent.

**Quality hook** — after every `Edit` or `Write` tool use, `quality-format-edit.ts` auto-formats the saved file:
- If `.claude/quality.json` exists in the project, runs its `format` and `lint` commands with `$FILE` substituted.
- Otherwise, extension-based defaults: `.py` -> ruff, `.ts/.tsx/.js/.jsx` -> prettier, `.go` -> gofmt, `.rs` -> rustfmt.
- Skips silently if the formatter binary isn't installed.
- Failures are logged to trace and printed to stderr.

**TypeScript gate** — after every `Edit` or `Write` on `.ts/.tsx` files, `quality-typecheck-edit.ts` finds the nearest `tsconfig.json` and runs `tsc --noEmit`. If errors are found, prints a summary of up to 5 errors.

**SQL guard** — before any MCP SQL tool call (`execute_sql`, `apply_migration`, `run_query`), `isolation-block-sql.ts` blocks destructive operations: `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `DELETE FROM` without WHERE, `ALTER TABLE DROP COLUMN`.

**Context compaction advisory** — before every `Edit` or `Write` tool use, `context-suggest-edit.ts` checks token usage. When context is approaching limits, emits an advisory suggesting compaction. Advisory only — does not block the tool call.

**Security scan** — before every `Bash` tool use, `security-scan-bash.ts` scans the command for security issues (credential exposure, dangerous patterns, etc.). Advisory only — emits a warning but does not block execution.

### Ending a session

On `Stop`, four hooks fire:

**1. E2e advisory** (`quality-check-stop.ts`) — checks whether the current turn included e2e evidence and an artifact when files were edited:
- If no edits: skips silently.
- If edits present: checks for e2e signals (CLI execution, Playwright/Cypress, browser MCP tools) and artifacts (screenshots, saved output).
- If missing: emits an advisory reminder listing edited files and what was missing.

**2. Context monitor** (`context-monitor-stop.ts`) — reads token usage from the last assistant message. Warns at 80% of context limit, critical alert at 90%.

**3. Session summary** (`context-save-stop.ts`) — writes a summary file if the session had >=4 messages:
- Output: `data/sessions/YYYY-MM-DD-HHMMSS.md`
- Contains: intent, outcome, milestones, tools used, files edited, message counts, assistant notes.

**4. Memory extraction** (`memory-extract-stop.ts`) — auto-extracts high-value memories and stores them in semantic memory:
- Skips if session is not substantive (<6 messages or no edits).
- Skips if Claude already called `memory_store` voluntarily.
- Extracts: session summary, user corrections, error resolutions.
- All auto-extracted memories tagged with `auto_extract`.

**Pre-compaction backup** (`context-backup-precompact.ts`) — on `PreCompact`, copies the current transcript JSONL to `~/.claude/transcript-backups/` before Claude compacts the conversation.

## Statusline

Rendered continuously via `StatusUpdate` event:

```
<model name>  ⎇ <git branch>  <dir name>  [████░░░░░░] 42%
```

Uses `ccstatusline` binary. Shows model display name, git branch, cwd, context window bar + percentage.

## Notifications

_(Not yet implemented — no Notification hook is registered in `settings-hooks.json`.)_

On `Notification` events (`idle`, `permission`, `complete`):
- **WSL**: Windows Toast via PowerShell WinRT APIs.
- **macOS**: `osascript display notification`.
- **Fallback**: terminal bell.

## Skills

Skills are domain-specific playbooks activated by keyword matching. Each lives in `src/skills/<name>/SKILL.md` (source) and is installed to `construct/skills/<name>/SKILL.md`.

| Skill | Purpose |
|---|---|
| `agent-browser` | Browser automation CLI for AI agents |
| `agents-audit` | Audit subagent definitions against rules |
| `agents-fix` | Apply fixes for agents-audit findings |
| `address` | Read vibe-annotations, summarize, implement, then clear |
| `agent-browser` | Browser automation CLI for AI agents |
| `agent-review` | Review all AI-runtime config (CLAUDE.md, hooks, skills, personas) — audit + fix modes |
| `code-review` | Review code — audit + fix modes; fix shapes: slop removal, propagation, consolidation, restructure |
| `context-compact` | Guide context compaction at logical task phase boundaries |
| `debug` | Systematic four-phase root-cause debugging |
| `design-review` | Review UI design — audit (agent-backed) + fix + enforce modes |
| `docs-review` | Review docs — audit + fix + enforce modes |
| `dogfood` | Qualitative single-run dogfood review of a tool or skill |
| `git` | Full git workflow — branch, implement, land via merge or PR |
| `interview` | Relentless interactive Q&A with the user about a plan |
| `omnibus` | Run a verb across domains in parallel, merge findings |
| `ralph-loop` | Iterative autonomous work toward a well-defined goal |
| `red-team` | Parallel adversarial review of an artifact (plan, RFC, PR) |
| `search` | Quick web research — search, synthesize, report with sources |
| `skill-creator` | Create new skills, modify and improve existing skills |
| `test-webapp` | Front door for browser testing — agent-browser CLI or Playwright |

## Slash Commands

### Installed globally (`src/commands/` -> `~/.claude/commands/`)

| Command | Behavior |
|---------|----------|
| `/audit` | Run audit leaves via the omnibus orchestrator |
| `/code-conform` | Apply a code pattern from one file across peers |
| `/code-review` | Review code for issues then refactor |
| `/design-conform` | Apply a UI pattern from one file across peers |
| `/design-fix` | Apply a UI pattern from one file across peers |
| `/design-standards` | Audit UI code against web interface best practices |
| `/design-type` | Professional typography rules for UI design |
| `/feature` | Start and complete feature work in isolated worktrees |
| `/finish` | Mark a todo or goal as done |
| `/fix` | Run fix leaves via the omnibus orchestrator |
| `/gist` | Surface your current understanding of the project |
| `/goal` | Manage goals (empty command stub) |
| `/handoff` | Save a session handoff so a fresh context can pick up |
| `/install` | Deploy Construct to `~/.claude` |
| `/pickup` | Resume from the most recent /handoff in a fresh context |
| `/research` | Deep autonomous research — long-running investigations |
| `/search` | Quick web research — search, synthesize, report with sources |
| `/ship` | Merge all outstanding feature branches and push to GitHub |
| `/sketch` | Build a design sketch for an idea |
| `/ss` | Read the user's latest screenshot |
| `/sub` | Dispatch a subagent to handle a request |
| `/suggest` | Run suggest leaves via the omnibus orchestrator |
| `/todo` | Manage todos: list, add, recurring |

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

### Overview (`/observability`)

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

Stats: session count, avg duration, user/assistant messages, lines changed, commits. Daily session chart. Activity chart. Session table (up to 50) with duration, messages, tools, cost, lines, commits, branch, and Gate Mode column showing `inline` (yellow) / `dispatched` (purple) / `—` badges per session. Subagent sessions shown indented. "Subagent" and "Dispatcher" filter toggles. Sessions-by-project table.

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

## UI — Research Pages

Research pages provide a UI for the autonomous research system. For the full data model, engine behavior, and API, see [RESEARCH.md](RESEARCH.md).

### Sessions (`/research`)

List of all research sessions. Shows title, seed query, status badge, thread/finding counts, total cost, last updated. Status filter tabs (all, active, paused, completed). "New Session" form: seed query (required), title (optional). Each row links to the detail page.

### Session Detail (`/research/:id`)

Four-tab interface:

- **Document** — ranked findings with source URLs, confidence/novelty/actionability bars, thumbs rating. Sortable by recency or quality score.
- **Timeline** — live SSE-driven event feed of steps, thread transitions, job events.
- **Graph** — ReactFlow DAG of thread hierarchy, nodes colour-coded by status (`queued`=grey, `active`=blue, `exhausted`=green). Click a node to see its findings.
- **Config** — inline-editable session config: model, provider, budget, schedule, perturbation weights. Changes are PATCHed to the session on save.

Controls: Run (5-iteration burst), Run All (start background jobs for all active sessions), Stop All, session status toggle, Inject Thread modal.

Live cost summary pulled from `/api/research/sessions/:id/costs`.

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
1. Ensure data directories exist (`~/.construct/{sessions,signals,backups,memory}`)
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

## Dev and Production Ports

- **Dev:** port 3001 — `bun dev-server.ts` from repo root, Vite HMR, live from `src/`
- **Prod:** port 3000 — systemd `construct-ui.service`, deployed via `bun install.ts`

## Path Resolution

Two roots: `~/.claude` for code/config, `~/.construct` for user data.

| Path | Location |
|---|---|
| `construct/` | `~/.claude/construct` |
| `commands/` | `~/.claude/commands` |
| `projects/` | `~/.claude/projects` |
| `construct.db` | `~/.construct/construct.db` (overridable via `CONSTRUCT_DATA_ROOT`) |
| `memory/sqlite_vec.db` | `~/.construct/memory/sqlite_vec.db` (overridable via `MEMORY_DB_PATH`) |
| `sessions/` | `~/.construct/sessions` |
| `signals/ratings.jsonl` | `~/.construct/signals/ratings.jsonl` |
| `backups/` | `~/.construct/backups` |

## Identity Layer

Four optional files in `construct/core/identity/`, preserved on upgrade:

| File | Purpose |
|------|---------|
| SOUL.md | Values, mental models, known biases |
| IDENTITY.md | Tone, personality, boundaries |
| STYLE.md | Code and communication formatting |
| USER.md | Principal profile, environment, preferences |

## Hook Registration

All hooks registered in `settings-hooks.json` (source: `src/core/hooks/settings-hooks.json`):

| Event | Hooks (in order) | Timeouts |
|-------|-----------------|----------|
| SessionStart | `src/memory/hooks/context-restore-start.ts` | 5000ms |
| UserPromptSubmit | `src/memory/hooks/rating-capture-submit.ts`, `src/memory/hooks/feedback-capture-submit.ts`, `src/core/hooks/routing-classify-submit.ts` | 2000ms, 2000ms, 3000ms |
| Stop | `src/core/hooks/quality-check-stop.ts`, `src/core/hooks/git-hygiene-stop.ts`, `src/core/hooks/context-monitor-stop.ts`, `src/memory/hooks/context-save-stop.ts`, `src/memory/hooks/memory-extract-stop.ts`, `src/memory/hooks/memory-consolidate-stop.ts` | 3000ms, 5000ms, 3000ms, 3000ms, 5000ms, 3000ms |
| PreToolUse | `src/core/hooks/isolation-block-sql.ts` (matcher: `mcp__.*(?:execute_sql\|apply_migration\|run_query)`), `src/core/hooks/git-require-edit.ts` (matcher: `Edit\|Write`), `src/core/hooks/context-suggest-edit.ts` (matcher: `Edit\|Write`), `src/core/hooks/security-scan-bash.ts` (matcher: `Bash`) | 3000ms, 5000ms, 3000ms, 5000ms |
| PostToolUse | `src/core/hooks/quality-format-edit.ts` (matcher: `Edit\|Write`), `src/core/hooks/quality-typecheck-edit.ts` (matcher: `Edit\|Write`), `src/memory/hooks/signal-capture-posttooluse.ts` (matcher: `Edit\|Write`) | 10000ms, 15000ms, 1000ms |
| PreCompact | `src/core/hooks/context-backup-precompact.ts` | 5000ms |

## Module Detection

| Module | Detection file |
|------|---------------|
| construct-core | `~/.claude/CLAUDE.md` |
| construct-memory | `construct/memory/hooks/context-restore-start.ts` |
| construct-skills | `construct/skills/skill-rules.json` |
| construct-data | `construct/data/src/client.ts` |
| construct-eval | `construct/eval/runner.ts` |
| construct-goals | `construct/goals/src/index.ts` |
| construct-ui | `construct/ui/api/src/app.ts` |

## Common Questions

**Q: How do I add a new hook?**
Add the script to `src/core/hooks/` (or `src/memory/hooks/` for session/memory hooks), register it in `src/core/hooks/settings-hooks.json` with event, command, and timeout, then run `bun install.ts` to deploy. Validate the JSON with `npm run validate`.

**Q: What triggers FULL depth classification?**
Architectural keywords in the prompt (`architect`, `redesign`, `refactor`, `migrate`, `schema`, `structure`, `plan`, `propose`, `authenticat*`, `authorizat*`, `integrat*`, `api endpoint`, `rename all`, `move all`, `replace all`, `across all`, `every file`, `all files`, `end to end`, `full stack`) or prompt length ≥ 40 words. QUICK classification is silent.

**Q: How do I prevent the SQL guard from blocking a query?**
The guard only blocks: `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `DELETE FROM` without a WHERE clause, and `ALTER TABLE DROP COLUMN`. Add a WHERE clause to DELETE queries. Qualified deletes (e.g. `DELETE FROM t WHERE id = ?`) are allowed.

**Q: What's the difference between context-save-stop and memory-extract-stop?**
`context-save-stop.ts` writes a structured `.md` file to `~/.construct/sessions/` for any session with ≥4 messages — always fires, no conditions on content. `memory-extract-stop.ts` only runs for substantive sessions (≥6 messages and at least one file edit) and skips entirely if Claude already called `memory_store` voluntarily. Session summaries are human-readable digests; extracted memories are semantic store entries intended for future retrieval.

**Q: How do I preserve a custom file across upgrades?**
Name it with ALL CAPS (e.g. `PROJECTS.md`) and place it in `~/.claude/construct/core/identity/` or `~/.claude/construct/memory/`. The installer detects all ALL CAPS `.md` files in those two directories and restores them after syncing. Files with any lowercase letters in the name are overwritten.

**Q: Why does the verification gate fire even on small prompts?**
The gate fires for any non-question prompt ≥5 words. "Small" doesn't exempt it — the threshold is word count, not change size. It fires when edits are present in the turn; if no files were edited, the Stop hook skips silently.

**Q: Where is the UI served during development vs production?**
Dev: `bun dev-server.ts` → `http://localhost:3001` (Fastify + Vite middleware in one process, hot-reload). Prod: systemd `construct-ui.service` → port 3000 (pre-built SPA). Port overridable via `PORT` or `API_PORT` env var.

**Q: How do I add a new skill?**
Create `src/skills/<name>/SKILL.md` with the skill playbook. Add keyword triggers to `src/skills/skill-rules.json`. Run `bun install.ts` to deploy the skill as a slash command and register it for keyword activation.
