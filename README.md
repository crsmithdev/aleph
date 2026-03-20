# Construct

A minimal, ergonomic Claude Code-native personal AI infrastructure, assistant, and life manager. Structured learning, signal capture, quality hooks, and skill routing — all built on hooks and CLAUDE.md rules, no external dependencies.

## Design Principles

- Claude Code is the runtime. No daemons, no Electron, no external servers.
- Favor CLAUDE.md rules over code wherever behavior can be captured in text.
- Every component must earn its place. If native Claude Code already does it, don't replicate it.
- Minimal viable first. Expand when friction is felt, not in anticipation of it.
- No external API keys required. All hooks use context injection.

## Modules

Five modules, installed in order. Each is independent after its dependencies are met.

| Module | Depends on | What it provides |
|------|-----------|-----------------|
| `construct-core` | — | CLAUDE.md, settings.json, statusline, optional identity files |
| `construct-memory` | core | Session hooks, memory dirs, ratings |
| `construct-skills` | core | Skill routing, quality hook, notify hook, skill playbooks |
| `construct-meta` | core | /construct subcommands |
| `construct-dashboard` | core | Goal/TODO tracking, web UI, MCP server |

All modules are deployed together. Core is always required; the rest are inert if unused.

See [INSTALL.md](INSTALL.md) for installation, upgrade, and mandatory post-install verification.

## Directory Layout

```
construct/                                # source modules (installed to ~/.claude/construct/)
├── core/
│   ├── hooks/                           # (none currently — statusline via ccstatusline)
│   └── identity/                        # optional semantic identity layer
│       ├── SOUL.md                      # purpose, values, mental models
│       ├── IDENTITY.md                  # name, tone, personality
│       ├── STYLE.md                     # output formatting, conventions
│       ├── USER.md                      # principal profile, environment
│       └── BOOTSTRAP.md                 # session initialization sequence
├── memory/
│   ├── sessions/                        # session summaries
│   ├── signals/ratings.jsonl            # explicit + implicit ratings
│   └── hooks/                           # session-start, rating-capture, session-summary, memory-gate
├── skills/
│   ├── skill-rules.json                 # keyword routing config
│   ├── hooks/format-reminder.ts         # depth classification + skill eval
│   ├── hooks/quality.ts                 # per-file lint/format on Edit/Write
│   ├── hooks/notify.ts                  # WSL toast / macOS alert / terminal bell
│   ├── research/SKILL.md               # research methodology
│   ├── verification/SKILL.md           # verification-before-completion
│   ├── debugging/SKILL.md              # systematic root cause debugging
│   ├── subagent-dev/SKILL.md           # subagent-driven development
│   ├── code-review/SKILL.md           # dead code, unused imports, code quality
│   ├── docs-review/SKILL.md          # doc drift detection
│   ├── instructions-review/SKILL.md  # instruction quality audit
│   └── ralph-loop/SKILL.md            # autonomous iterative loop
├── meta/
│   ├── README.md                        # cross-module utilities reference
│   └── INSTALL.md                       # post-install checks
└── dashboard/
    ├── api/                             # Fastify REST API + SQLite
    ├── web/                             # React SPA (Vite + Tailwind)
    ├── mcp/                             # MCP server for AI integration
    └── shared/                          # Zod validators, shared types

dotclaude/                                # install sources (installed to ~/.claude/)
├── CLAUDE.md                            # install source for ~/.claude/CLAUDE.md (not loaded directly)
├── settings.json                        # permissions, statusline, hooks
└── commands/
    └── construct.md                     # slash command router

.claude/                                  # dev-time config only (never installed)
├── CLAUDE.md                            # dev-only rules, loaded at runtime for this repo
├── settings.json                        # local hook testing (paths point to construct/)
└── MEMORY.md                            # ephemeral working notes
```

## Hooks

| Event | Hook | Module | Purpose |
|-------|------|------|---------|
| StatusUpdate | ccstatusline | core | Model, branch, dir, context %, tokens, lines ±, cost, duration |
| SessionStart | session-start.ts | memory | Surface last session summary |
| UserPromptSubmit | rating-capture.ts | memory | Capture explicit N/10 ratings |
| UserPromptSubmit | format-reminder.ts | skills | Depth classification + keyword-matched skill eval |
| Stop | memory-gate.ts | memory | Enforce memory_store before exit |
| Stop | session-summary.ts | memory | Structured session summary |
| PostToolUse | quality.ts | skills | Per-file lint/format on Edit/Write |
| Notification | notify.ts | skills | WSL toast / macOS alert / terminal bell |

## Slash Commands

| Command | Module | Purpose |
|---------|------|---------|
| `/construct install` | meta | Install/reinstall Construct globally to `~/.claude` |
| `/construct verify` | meta | Run all module post-install checks |
| `/construct grasp` | meta | Surface Claude's current mental model + project commandments |
| `/construct status` | meta | Context, identity files, skills, memory stats |
| `/construct retain` | meta | Promote insights to semantic memory |
| `/construct trace` | meta | Toggle hook tracing (or one-shot trace a command) |
| `/construct audit` | meta | Full project audit: code, refs, instructions, docs, spec, stats |

## Identity Architecture

Two layers:

- **Identity** (slow-changing): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, `BOOTSTRAP.md` — who you are, how you think, how you present. Optional files in construct-core.
- **Memory** (fast-changing): semantic memory via mcp-memory-service — decisions, patterns, preferences. Automatic storage and retrieval.

## Skills

Domain-specific playbooks in `construct/skills/<name>/SKILL.md`. The `format-reminder.ts` hook reads `skill-rules.json` and matches skills whose keywords appear in the current prompt.

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

## CLAUDE.md Structure

Core behavioral rules are installed by construct-core; each module appends its own `##` section. See [SPEC.md](SPEC.md) § Modules for the full section-by-section breakdown.
