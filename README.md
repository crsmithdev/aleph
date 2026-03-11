# Construct

A minimal, Claude Code-native personal AI infrastructure for a solo software engineer. Structured learning, signal capture, quality hooks, and skill routing — all built on hooks and CLAUDE.md rules, no external dependencies.

## Design Principles

- Claude Code is the runtime. No daemons, no Electron, no external servers.
- Favor CLAUDE.md rules over code wherever behavior can be captured in text.
- Every component must earn its place. If native Claude Code already does it, don't replicate it.
- Minimal viable first. Expand when friction is felt, not in anticipation of it.
- No external API keys required. All hooks use context injection.

## Packs

Five packs, installed in order. Each is independent after its dependencies are met.

| Pack | Depends on | What it provides |
|------|-----------|-----------------|
| `construct-core` | — | CLAUDE.md, settings.json, statusline, optional identity files |
| `construct-memory` | core | Session hooks, memory dirs, ratings |
| `construct-dev` | core | Quality hook, notify hook |
| `construct-skills` | core | format-reminder, skill-rules.json, research example skill |
| `construct-meta` | core | /construct subcommands |

Selective install: skip any optional pack you don't need. Core is always required.

See [INSTALL.md](INSTALL.md) for installation, upgrade, and mandatory post-install verification.

## Directory Layout

```
.claude/
├── CLAUDE.md                          # behavioral contract (core + pack sections)
├── MEMORY.md                          # Claude's working notes (auto-written)
├── settings.json                      # permissions, statusline, hooks
├── commands/                          # slash commands
└── construct/
    ├── core/
    │   ├── hooks/statusline.ts
    │   └── identity/                  # optional semantic identity layer
    │       ├── SOUL.md                # purpose, values, mental models
    │       ├── IDENTITY.md            # name, tone, personality
    │       ├── STYLE.md               # output formatting, conventions
    │       ├── USER.md                # principal profile, environment
    │       └── BOOTSTRAP.md           # session initialization sequence
    ├── memory/
    │   ├── CONTEXT.md                 # active project state
    │   ├── LEARNED.md                 # durable insights
    │   ├── sessions/                  # session summaries
    │   ├── snapshots/                 # mental model snapshots
    │   ├── signals/ratings.jsonl      # explicit + implicit ratings
    │   └── hooks/                     # session-start, rating-capture, sentiment-capture, session-summary
    ├── dev/
    │   └── hooks/                     # quality.ts, notify.ts
    ├── skills/
    │   ├── skill-rules.json           # keyword routing config
    │   ├── research/SKILL.md          # example skill
    │   └── hooks/format-reminder.ts   # depth classification + skill eval
    └── meta/
        └── README.md                  # cross-pack utilities reference
```

## Hooks

| Event | Hook | Pack | Purpose |
|-------|------|------|---------|
| StatusUpdate | statusline.ts | core | Model, branch, dir, context %, tokens, lines ±, cost, duration |
| SessionStart | session-start.ts | memory | Surface focus, recent learnings, snapshots |
| UserPromptSubmit | rating-capture.ts | memory | Capture explicit N/10 ratings |
| UserPromptSubmit | format-reminder.ts | skills | Depth classification + keyword-matched skill eval |
| Stop | sentiment-capture.ts | memory | Heuristic implicit satisfaction rating |
| Stop | session-summary.ts | memory | Structured 3-bullet session summary |
| PostToolUse | quality.ts | dev | Per-file lint/format on Edit/Write |
| Notification | notify.ts | dev | WSL toast / macOS alert / terminal bell |

No external API keys needed.

## Slash Commands

| Command | Pack | Purpose |
|---------|------|---------|
| `/construct install` | meta | Install/reinstall Construct globally to `~/.claude` |
| `/construct verify` | meta | Run all pack post-install checks |
| `/construct grasp` | meta | Surface Claude's current mental model + project commandments |
| `/construct status` | meta | Context, identity files, skills, memory stats |
| `/construct retain` | meta | Promote insights to LEARNED.md |

## Identity Architecture

Semantic/episodic split:

- **Semantic** (slow-changing): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, `BOOTSTRAP.md` — who you are, how you think, how you present. Optional files in construct-core.
- **Episodic** (fast-changing): `CONTEXT.md`, `LEARNED.md` — what you're working on, what you've learned. Lives in construct-memory.

## Skills

Domain-specific playbooks in `.claude/construct/skills/<name>/SKILL.md`. The `format-reminder.ts` hook reads `skill-rules.json` and matches skills whose keywords appear in the current prompt. Ships with `research/` as a worked example.

## CLAUDE.md Structure

Core behavioral rules are installed by construct-core. Each subsequent pack appends its own `##` section:

- `## Behavior` — core behavioral contract
- `## Task Execution` — depth levels, 7-phase algorithm, capability selection
- `## Thinking Tools` — six opt-out tools for FULL tasks
- `## Pack Installation` — post-install verification rule
- `## Memory Files` — MEMORY.md / LEARNED.md / CONTEXT.md roles (memory pack)
- `## Identity Files` — semantic identity layer reference (memory pack)
- `## Dev Conventions` — commit style, docs policy (dev pack)
- `## Agent Personas` — Architect / Engineer / QATester (dev pack)
- `## Worktree Convention` — isolated task sessions (dev pack)
