# Construct

A minimal, ergonomic Claude Code-native personal AI infrastructure, assistant, and life manager. Structured learning, signal capture, quality hooks, and skill routing — all built on hooks and CLAUDE.md rules, no external dependencies.

## Design Principles

- Claude Code is the runtime. No Electron, no external process managers.
- Favor code over AI instructions wherever behavior can be enforced programmatically.
- Every component must earn its place. If native Claude Code already does it, don't replicate it.
- Minimal viable first. Expand when friction is felt, not in anticipation of it.
- No external API keys required for core functionality. The research module optionally uses Anthropic, OpenRouter, or Jina keys.

## Modules

Nine modules, installed in order. Each is independent after its dependencies are met.

| Module | Depends on | What it provides |
|------|-----------|-----------------|
| `construct-core` | — | CLAUDE.md, settings.json, statusline, optional identity files |
| `construct-memory` | core | Session hooks, memory dirs, ratings |
| `construct-skills` | core | Skill routing, quality hook, notify hook, skill playbooks |
| `construct-data` | — | Shared SQLite persistence layer, path resolution |
| `construct-telemetry` | data | JSONL parser, aggregator, pricing, CLI status |
| `construct-eval` | — | Agent SDK eval harness, test scenarios |
| `construct-goals` | data | Goal/TODO domain logic, MCP server, /goal and /todo commands |
| `construct-research` | data | Autonomous multi-threaded research engine, worker supervisor, monitors |
| `construct-ui` | data, goals, telemetry, research | Web UI (Fastify API + React SPA) |

All modules are deployed together. Core is always required; the rest are inert if unused.

See [INSTALL.md](INSTALL.md) for installation, upgrade, and mandatory post-install verification.

## Directory Layout

```
src/                                      # all Construct code (symlinked or synced to ~/.claude/construct/)
├── core/
│   ├── CLAUDE.md                        # Construct behavioral rules (@imported by ~/.claude/CLAUDE.md)
│   ├── hooks/
│   │   └── settings-hooks.json          # hook registrations + statusLine config
│   └── identity/                        # optional semantic identity layer
│       ├── SOUL.md, IDENTITY.md, STYLE.md, USER.md
├── commands/                            # slash commands (copied to ~/.claude/commands/)
│   ├── finish.md, gist.md, goal.md, todo.md
├── memory/
│   └── hooks/                           # session-start, rating-capture, session-summary, memory-extract
├── skills/
│   ├── skill-rules.json                 # keyword routing config
│   ├── hooks/                           # 9 hook scripts (quality, git, isolation, context, routing, notify)
│   └── */SKILL.md                       # 13 skill playbooks
├── data/                                # shared SQLite persistence, path resolution
├── eval/                                # Agent SDK eval harness + scenarios
├── telemetry/                           # JSONL parser, aggregator, pricing
├── goals/                               # Goal/TODO domain logic + MCP server
├── research/                            # autonomous research engine, worker supervisor, monitors
└── ui/                                  # Fastify API + React SPA

.claude/                                  # project-local config (never installed)
├── CLAUDE.md                            # repo-specific dev rules, loaded at runtime
└── settings.json                        # permissions, statusline, MCP config (no hooks)
```

## Hooks

| Event | Hook | Module | Purpose |
|-------|------|------|---------|
| SessionStart | session-start.ts | memory | Surface last session summary, background work briefing |
| UserPromptSubmit | rating-capture.ts | memory | Capture explicit N/10 ratings |
| UserPromptSubmit | routing-submit-classify.ts | skills | Depth classification + skill matching |
| Stop | quality-stop-check-e2e.ts | skills | E2e advisory check |
| Stop | context-stop-monitor.ts | skills | Context window usage warning (80%/90%) |
| Stop | session-summary.ts | memory | Structured session summary |
| Stop | memory-extract.ts | memory | Auto-extract memories to semantic store |
| PreToolUse | git-pre-require-commit.ts | skills | Require commit before more edits |
| PreToolUse | isolation-pre-block-destructive-sql.ts | skills | Block destructive SQL operations |
| PostToolUse | quality-post-format.ts | skills | Per-file lint/format on Edit/Write |
| PostToolUse | quality-post-typecheck.ts | skills | TypeScript type-check on Edit/Write |
| PreCompact | context-precompact-backup.ts | skills | Transcript backup before compaction |
| Notification | notify-event-toast.ts | skills | WSL toast / macOS alert / terminal bell |

The statusline (`ccstatusline`) is configured via the `statusLine` key in settings.json, not as a hook.

## Slash Commands

### Installed globally (`src/commands/` -> `~/.claude/commands/`)

| Command | Module | Purpose |
|---------|------|---------|
| `/gist` | core | Surface Claude's current mental model + project understanding |
| `/goal` | goals | Manage goals: list, create, update, delete, show, archive |
| `/todo` | goals | Manage todos: list, add, recurring |
| `/finish` | goals | Mark a todo or goal as done; undo completion; complete recurring todos |

### Project-level (`.claude/commands/` — Construct repo only)

| Command | Purpose |
|---------|---------|
| `/install` | Deploy repo to `~/.claude` with post-install verification |
| `/audit` | Full project audit: code, docs |

## Identity Architecture

Two layers:

- **Identity** (slow-changing): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md` — who you are, how you think, how you present. Loaded via `@path` imports in CLAUDE.md.
- **Memory** (fast-changing): semantic memory via mcp-memory-service — decisions, patterns, preferences. Automatic storage and retrieval.

## Skills

Domain-specific playbooks in `src/skills/<name>/SKILL.md`. The `routing-submit-classify.ts` hook reads `skill-rules.json` and matches skills whose keywords appear in the current prompt.

| Skill | Purpose |
|-------|---------|
| `research` | Structured research methodology |
| `verification` | Evidence-based completion verification |
| `debugging` | 4-phase systematic root cause debugging |
| `build` | Unified implementation lifecycle: design, plan, TDD execute, review, finish |
| `code-review` | Dead code, unused imports, silent failures, dead references |
| `docs-review` | Documentation drift detection, spec completeness |
| `hooks-review` | Hook script correctness, safety, settings.json alignment |
| `commands-review` | Slash command clarity, registration, completeness |
| `skills-review` | SKILL.md quality, skill-rules.json alignment |
| `config-review` | settings.json and CLAUDE.md consistency |
| `ralph-loop` | Autonomous iterative development via subagent loops |
| `finishing-branch` | Verify then integrate: merge, PR, keep, or discard a feature branch |
| `git-worktrees` | Set up isolated worktrees for parallel feature work |

## Operations

### Running the UI

**Dev (hot-reload):**
```bash
npm run dev          # from repo root — starts dev server at http://localhost:3000
```
Single server: Fastify API + Vite middleware in one process. React components hot-reload on save. No separate Vite port. Port is `$PORT` or `$API_PORT`, default 3000. Sources `.env` from repo root if present.

**Production (systemd):**
```bash
systemctl --user start   construct-ui       # start
systemctl --user stop    construct-ui       # stop
systemctl --user restart construct-ui       # restart
systemctl --user status  construct-ui       # status + recent logs
```
Serves pre-built SPA from `web/dist/` on port 3000. Installed/updated via `bun install.ts`.

### Running Tests

```bash
npm test             # unit + integration suite (src/tests/*.test.ts), fails if <90% pass
npm run ui:e2e       # Playwright e2e: starts real server, verifies goals UI
npm run ui:e2e:obs   # Playwright e2e: observability flow
npm run validate     # JSON lint on settings-hooks.json and skill-rules.json
```

`npm test` runs `bun test.ts` which scans `src/tests/`, aggregates pass/fail, and exits non-zero if score < 90%.

### Research Workers

Workers are managed two ways simultaneously:

**Auto (WorkerSupervisor):** The UI app spawns 3 workers on startup (`$WORKER_COUNT` to override). They restart automatically on crash with exponential backoff. No manual action needed when using the production systemd service or dev server.

**Systemd (standalone):**
```bash
systemctl --user start   construct-research-worker
systemctl --user stop    construct-research-worker
systemctl --user restart construct-research-worker
journalctl --user -u construct-research-worker -f   # tail logs
```

Workers require `$OPENROUTER_API_KEY`. They poll the SQLite DB for pending research jobs, execute them, and heartbeat every 60s. Graceful shutdown on SIGTERM (finishes current iteration).

**Via slash command:**
```
/research start <topic>    # create + start session
/research status           # list all sessions
/research findings <id>    # show findings with confidence/novelty
/research pause <id>       # pause
/research resume <id>      # resume
```

### Install / Deploy

```bash
bun install.ts       # full deploy: src/ → ~/.claude/construct/, deps, services, DB verify
```

What it does: backs up DB → stops UI service → syncs files → installs deps → merges settings.json + CLAUDE.md → recreates systemd services → verifies DB health. Safe to re-run; all user data is preserved.

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` / `API_PORT` | 3000 | UI server port |
| `OPENROUTER_API_KEY` | — | Required for research workers |
| `ANTHROPIC_API_KEY` | — | Optional, passed to systemd services |
| `WORKER_COUNT` | 3 | Research workers to spawn |
| `DATABASE_URL` | `~/.construct/construct.db` | Override DB path |

Place in `.env` at repo root; automatically sourced by `npm run dev` and worker startup.

## CLAUDE.md Structure

Core behavioral rules are installed by construct-core; each module appends its own `##` section.
