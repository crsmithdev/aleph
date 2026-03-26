# Construct

A minimal, ergonomic Claude Code-native personal AI infrastructure, assistant, and life manager. Structured learning, signal capture, quality hooks, and skill routing — all built on hooks and CLAUDE.md rules, no external dependencies.

## Design Principles

- Claude Code is the runtime. No daemons, no Electron, no external servers.
- Favor code over AI instructions wherever behavior can be enforced programmatically.
- Every component must earn its place. If native Claude Code already does it, don't replicate it.
- Minimal viable first. Expand when friction is felt, not in anticipation of it.
- No external API keys required. All hooks use context injection.

## Modules

Seven modules, installed in order. Each is independent after its dependencies are met.

| Module | Depends on | What it provides |
|------|-----------|-----------------|
| `construct-core` | — | CLAUDE.md, settings.json, statusline, optional identity files |
| `construct-memory` | core | Session hooks, memory dirs, ratings |
| `construct-skills` | core | Skill routing, quality hook, notify hook, skill playbooks |
| `construct-data` | — | Shared SQLite persistence layer |
| `construct-eval` | — | Agent SDK eval harness, test scenarios |
| `construct-goals` | data | Goal/TODO domain logic, MCP server, /goal and /todo commands |
| `construct-ui` | data, goals | Web UI (Fastify API + React SPA) |

All modules are deployed together. Core is always required; the rest are inert if unused.

See [INSTALL.md](INSTALL.md) for installation, upgrade, and mandatory post-install verification.

## Directory Layout

```
src/                                      # source modules (installed to ~/.claude/construct/)
├── core/
│   ├── hooks/                           # (none currently — statusline via ccstatusline)
│   └── identity/                        # optional semantic identity layer
│       ├── SOUL.md                      # purpose, values, mental models
│       ├── IDENTITY.md                  # name, tone, personality
│       ├── STYLE.md                     # output formatting, conventions
│       └── USER.md                      # principal profile, environment
├── memory/
│   ├── sessions/                        # session summaries
│   ├── signals/ratings.jsonl            # explicit + implicit ratings
│   └── hooks/                           # session-start, rating-capture, session-summary, memory-extract
├── skills/
│   ├── skill-rules.json                 # keyword routing config
│   ├── hooks/format-reminder.ts         # depth classification + skill eval
│   ├── hooks/quality.ts                 # per-file lint/format on Edit/Write
│   ├── hooks/notify.ts                  # WSL toast / macOS alert / terminal bell
│   ├── research/SKILL.md               # research methodology
│   ├── verification/SKILL.md           # verification-before-completion
│   ├── debugging/SKILL.md              # systematic root cause debugging
│   ├── subagent-dev/SKILL.md           # subagent-driven development
│   ├── code-review/SKILL.md            # dead code, unused imports, code quality
│   ├── docs-review/SKILL.md            # doc drift detection
│   ├── instructions-review/SKILL.md    # instruction quality audit
│   ├── ralph-loop/SKILL.md             # autonomous iterative loop
│   ├── brainstorming/SKILL.md          # design-first exploration with approval gates
│   ├── tdd/SKILL.md                    # red-green-refactor test-driven development
│   ├── writing-plans/SKILL.md          # implementation plan creation with TDD task breakdown
│   ├── executing-plans/SKILL.md        # inline plan execution with checkpoints
│   ├── finishing-branch/SKILL.md       # branch integration: merge / PR / keep / discard
│   ├── git-worktrees/SKILL.md          # isolated worktree setup for parallel work
│   └── parallel-agents/SKILL.md        # dispatch independent failures to parallel agents
├── eval/
│   ├── runner.ts                        # Agent SDK eval harness
│   ├── scenarios/                       # test scenarios (broken-math, todo-app, todo-feature)
│   └── results/                         # eval run results (JSON)
├── data/
│   └── src/client.ts                    # shared SQLite persistence
├── goals/
│   ├── src/                             # domain logic (services, schema, validators)
│   └── mcp/                             # MCP server (direct SQLite, no HTTP)
└── ui/
    ├── api/                             # Fastify REST API (thin wrappers)
    └── web/                             # React SPA (Vite + Tailwind)

dotclaude/                                # install sources (installed to ~/.claude/)
├── CLAUDE.md                            # install source for ~/.claude/CLAUDE.md (not loaded directly)
├── settings.json                        # permissions, statusline, hooks
└── commands/
    ├── goal.md                          # /goal slash command
    ├── todo.md                          # /todo slash command
    └── finish.md                        # /finish slash command

.claude/                                  # dev-time config only (never installed)
├── CLAUDE.md                            # dev-only rules, loaded at runtime for this repo
└── settings.json                        # permissions, statusline, MCP config (no hooks)
```

## Hooks

| Event | Hook | Module | Purpose |
|-------|------|------|---------|
| StatusUpdate | ccstatusline | core | Model, branch, dir, context %, tokens, lines ±, cost, duration |
| SessionStart | session-start.ts | memory | Surface last session summary |
| UserPromptSubmit | rating-capture.ts | memory | Capture explicit N/10 ratings |
| UserPromptSubmit | format-reminder.ts | skills | Depth classification + keyword-matched skill eval |
| Stop | verify-gate.ts | skills | E2e verification gate: checks for browser evidence + artifact when files were edited |
| Stop | session-summary.ts | memory | Structured session summary |
| Stop | memory-extract.ts | memory | Auto-extract memories to semantic store |
| PostToolUse | quality.ts | skills | Per-file lint/format on Edit/Write |
| Notification | notify.ts | skills | WSL toast / macOS alert / terminal bell |

## Slash Commands

| Command | Module | Purpose |
|---------|------|---------|
| `/install` | core | Install/reinstall Construct globally to `~/.claude` (includes post-install checks) |
| `/gist` | core | Surface Claude's current mental model + project understanding |
| `/trace` | core | Toggle hook tracing (or one-shot trace a command) |
| `/audit` | core | Full project audit: code, refs, instructions, docs, spec |
| `/goal` | goals | Manage goals: list, create, update, delete, show, done, archive |
| `/todo` | goals | Manage todos: list, add, done, undone, delete, recurring |
| `/finish` | goals | Mark a todo or goal as done; undo completion; complete recurring todos |

## Identity Architecture

Two layers:

- **Identity** (slow-changing): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md` — who you are, how you think, how you present. Loaded via `@path` imports in CLAUDE.md.
- **Memory** (fast-changing): semantic memory via mcp-memory-service — decisions, patterns, preferences. Automatic storage and retrieval.

## Skills

Domain-specific playbooks in `src/skills/<name>/SKILL.md`. The `format-reminder.ts` hook reads `skill-rules.json` and matches skills whose keywords appear in the current prompt.

| Skill | Purpose |
|-------|---------|
| `research` | Structured research methodology |
| `verification` | Evidence-based completion verification |
| `debugging` | 4-phase systematic root cause debugging |
| `subagent-dev` | Parallel subagent execution with two-stage review |
| `code-review` | Dead code, unused imports, silent failures, dead references |
| `docs-review` | Documentation drift detection, spec completeness |
| `instructions-review` | Instruction quality: vagueness, contradictions, duplication |
| `ralph-loop` | Autonomous iterative development via subagent loops |
| `brainstorming` | Design-first exploration: propose approaches, get approval before building |
| `tdd` | Red-green-refactor cycle; no production code without a failing test first |
| `writing-plans` | Break work into testable tasks with file mappings and TDD steps |
| `executing-plans` | Execute a written plan inline with checkpoints; stop on blockers |
| `finishing-branch` | Verify then integrate: merge, PR, keep, or discard a feature branch |
| `git-worktrees` | Set up isolated worktrees for parallel feature work |
| `parallel-agents` | Dispatch 3+ independent failures to parallel agents for concurrent investigation |

## CLAUDE.md Structure

Core behavioral rules are installed by construct-core; each module appends its own `##` section. See [SPEC.md](SPEC.md) § Modules for the full section-by-section breakdown.
