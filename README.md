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

## CLAUDE.md Structure

Core behavioral rules are installed by construct-core; each module appends its own `##` section.
