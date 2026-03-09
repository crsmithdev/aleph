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
| `construct-memory` | core | Session hooks, memory dirs, ratings, /dashboard, /update-learned |
| `construct-dev` | core | Quality hook, notify hook, /worktree command |
| `construct-skills` | core | format-reminder, skill-rules.json, research example skill |
| `construct-meta` | core | META.md, /common-ground, /verify commands |

Selective install: skip any optional pack you don't need. Core is always required.

## Directory Layout

```
.claude/
├── CLAUDE.md                          # behavioral contract (core + pack sections)
├── MEMORY.md                          # Claude's working notes (auto-written)
├── settings.json                      # permissions, statusline, hooks
├── commands/                          # slash commands
└── construct/
    ├── core/
    │   ├── hooks/statusline.sh
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
    │   └── hooks/                     # quality.sh, notify.sh
    ├── skills/
    │   ├── skill-rules.json           # keyword routing config
    │   ├── research/SKILL.md          # example skill
    │   └── hooks/format-reminder.sh   # depth classification + skill eval
    ├── eval/                          # functional tests (not a pack)
    │   ├── test.sh                    # Layer 1 — hook unit tests
    │   ├── compare.sh                 # Layer 2 — bare vs scaffolded via claude -p
    │   └── fixture/                   # test fixtures
    └── meta/
        └── META.md                    # cross-pack utilities reference
```

## Hooks

| Event | Hook | Pack | Purpose |
|-------|------|------|---------|
| StatusUpdate | statusline.sh | core | Model, branch, dir, context %, tokens, lines ±, cost, duration |
| SessionStart | session-start.sh | memory | Surface focus, recent learnings, snapshots |
| UserPromptSubmit | rating-capture.sh | memory | Capture explicit N/10 ratings |
| UserPromptSubmit | format-reminder.sh | skills | Depth classification + keyword-matched skill eval |
| Stop | sentiment-capture.sh | memory | Context-injected implicit satisfaction rating |
| Stop | session-summary.sh | memory | Context-injected 3-bullet session summary |
| PostToolUse | quality.sh | dev | Per-file lint/format on Edit/Write |
| Notification | notify.sh | dev | WSL toast / macOS alert / terminal bell |

All hooks use context injection — they emit text that Claude processes inline. No API keys needed.

## Slash Commands

| Command | Pack | Purpose |
|---------|------|---------|
| `/common-ground` | meta | Surfaces Claude's current mental model. Use at session start. |
| `/worktree` | dev | Create isolated git worktree for a task |
| `/verify` | meta | Run all pack post-install checks |
| `/dashboard` | memory | Session signals, recent sessions, learned insights |
| `/update-learned` | memory | Promote session insights to LEARNED.md |
| `/context-report` | meta | Which files/skills are in context |
| `/clear-snapshot` | meta | Manage memory/snapshots/ |
| `/test` | eval | Functional tests — hook unit tests + bare-vs-scaffolded comparison |

## Identity Architecture

Semantic/episodic split:

- **Semantic** (slow-changing): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, `BOOTSTRAP.md` — who you are, how you think, how you present. Optional files in construct-core.
- **Episodic** (fast-changing): `CONTEXT.md`, `LEARNED.md` — what you're working on, what you've learned. Lives in construct-memory.

## Skills

Domain-specific playbooks in `.claude/construct/skills/<name>/SKILL.md`. The `format-reminder.sh` hook reads `skill-rules.json` and only injects the forced-eval block for skills whose keywords match the current prompt. Ships with `research/` as a worked example.

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

## Eval Suite

Not a pack — lives at `construct/eval/` and is optional.

**Layer 1** (`test.sh`): Hook unit tests. Tests each hook in isolation with crafted payloads. No Claude session needed. Run via `/test hooks`.

**Layer 2** (`compare.sh`): Sends the same prompt via `claude -p` twice — once from a bare temp directory, once from the project root. Compares structural signals (ISC, depth, thinking tools, plan, verify) in each response. Run via `/test compare`.
