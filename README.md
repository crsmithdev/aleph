# Construct

Claude Code-native personal AI infrastructure. Hooks, skills, memory, research, and a web UI — all running inside your Claude Code environment.

**Install target:** `~/.claude/construct/` · **User data:** `~/.construct/` (never touched by installer) · **DB:** `~/.construct/construct.db`

---

## Quick Start

```bash
git clone <repo> ~/construct && cd ~/construct
bun install.ts           # deploy to ~/.claude/construct/, set up systemd, verify DB

bun dev-server.ts        # dev: hot-reload at http://localhost:3001
```

See [INSTALL.md](INSTALL.md) for full installation, upgrade, and verification steps.

---

## Modules

Nine modules, deployed together. Core is always required; others are inert if unused.

| Module | Depends on | Provides |
|---|---|---|
| `construct-core` | — | CLAUDE.md, settings.json, statusline, identity files |
| `construct-memory` | core | Session hooks, semantic memory, ratings |
| `construct-skills` | core | Skill routing, quality hooks, skill playbooks |
| `construct-data` | — | Shared SQLite persistence, path resolution |
| `construct-telemetry` | data | JSONL parser, aggregator, pricing, CLI status |
| `construct-eval` | — | Agent SDK eval harness, test scenarios |
| `construct-goals` | data | Goal/TODO domain logic, MCP server, `/goal` + `/todo` commands |
| `construct-research` | data | Autonomous multi-threaded research engine, worker supervisor |
| `construct-ui` | data, goals, telemetry, research | Fastify API + React SPA |

---

## Directory Layout

```
src/
├── core/           CLAUDE.md, hooks/, identity/ (SOUL.md, STYLE.md, USER.md)
├── memory/         hooks/ (session-start, rating-capture, session-summary, memory-extract)
├── skills/         skill-rules.json, 19 skill dirs
├── agents/         agent definition files
├── commands/       slash command .md files
├── data/           SQLite persistence, path resolution
├── eval/           Agent SDK eval harness + scenarios
├── telemetry/      JSONL parser, aggregator, pricing
├── goals/          Goal/TODO domain logic + MCP server
├── research/       autonomous research engine + workers
└── ui/             Fastify API + React SPA (web/)

.claude/            project dev config (never installed)
docs/               HOOKS.md, SKILLS.md, TESTS.md, AGENTS.md, spec/
install.ts          installer
test.ts             test runner
```

---

## Hooks

| Event | Script | Module | Purpose |
|---|---|---|---|
| SessionStart | `src/memory/hooks/session-start.ts` | memory | Surface last session summary |
| UserPromptSubmit | `src/memory/hooks/rating-capture.ts` | memory | Capture N/10 ratings |
| UserPromptSubmit | `src/core/hooks/routing-submit-classify.ts` | core | Depth classification + skill matching |
| Stop | `src/core/hooks/quality-stop-check-e2e.ts` | core | E2e advisory check |
| Stop | `src/core/hooks/context-stop-monitor.ts` | core | Context window usage warning |
| Stop | `src/memory/hooks/session-summary.ts` | memory | Structured session summary |
| Stop | `src/memory/hooks/memory-extract.ts` | memory | Auto-extract memories to semantic store |
| PreToolUse (SQL) | `src/core/hooks/isolation-pre-block-destructive-sql.ts` | core | Block destructive SQL |
| PreToolUse (Edit/Write) | `src/core/hooks/git-pre-require-commit.ts` | core | Require commit before more edits |
| PreToolUse (Edit/Write) | `src/core/hooks/context-compact-suggest.ts` | core | Suggest compact when context high |
| PreToolUse (Bash) | `src/core/hooks/security-scan-pre-commit.ts` | core | Pre-commit security scan |
| PostToolUse (Edit/Write) | `src/core/hooks/quality-post-format.ts` | core | Lint/format on save |
| PostToolUse (Edit/Write) | `src/core/hooks/quality-post-typecheck.ts` | core | TypeScript type-check on save |
| PreCompact | `src/core/hooks/context-precompact-backup.ts` | core | Transcript backup before compaction |

Full hook detail: [docs/specs/HOOKS.md](docs/specs/HOOKS.md)

---

## Slash Commands

**Global** (`src/commands/` → `~/.claude/commands/`):

| Command | Purpose |
|---|---|
| `/gist` | Surface Claude's current project understanding |
| `/goal` | Manage goals: list, create, update, delete, archive |
| `/todo` | Manage todos: list, add, recurring |
| `/finish` | Mark goal/todo done; undo; complete recurring |
| `/research` | Manage research sessions: start, status, findings, pause, resume |

**Project-only** (`.claude/commands/` — Construct repo only):

| Command | Purpose |
|---|---|
| `/install` | Deploy repo to `~/.claude` with post-install verification |
| `/link` | Symlink `~/.claude/construct` to `src/` for live dev |
| `/wipe` | Wipe all research data |

Full skills and commands: [docs/specs/SKILLS.md](docs/specs/SKILLS.md)

---

## Skills

19 skill playbooks in `src/skills/<name>/SKILL.md`. The `routing-submit-classify.ts` hook reads `skill-rules.json` and activates matching skills based on prompt keywords. Skills can also be invoked explicitly via the `Skill()` tool.

| Skill | Purpose |
|---|---|
| `agent-browser` | Browser automation for AI agents |
| `code-debug` | Systematic root-cause debugging |
| `code-refactor` | Code organization and architecture |
| `code-review` | Dead code, issues, quality scan |
| `code-simplify` | Remove over-engineering and slop |
| `context-compact` | Guide context compaction |
| `design-audit` | UI/UX design review (covers all 18 dimensions: hierarchy, typography, a11y, forms, perf, hydration, etc.) |
| `design-fix` | Apply approved design audit findings — peer-drift propagation |
| `docs-author` | Create/update documentation |
| `docs-optimize` | Optimize docs for LLM discoverability |
| `eval-harness` | Define and run evals |
| `git-workflow` | Branch, merge, PR workflow |
| `ralph-loop` | Autonomous iterative development |
| `search` | Quick web research |
| `skill-creator` | Create and improve skills |
| `test-webapp` | Playwright webapp testing |
| `verify-completion` | Evidence-based completion gate |

To add a skill: create `src/skills/<name>/SKILL.md` and add keyword triggers to `src/skills/skill-rules.json`. Run `bun install.ts` to deploy.

---

## Running

### Dev (live-reload)

```bash
bun dev-server.ts        # hot-reload at http://localhost:3001
```

Single process: Fastify API + Vite middleware. React hot-reloads on save. Port: `$PORT` / `$API_PORT`, default **3001**.

### Dev (symlink mode — edit src/ and see changes without reinstalling)

```bash
# One-time setup: symlink ~/.claude/construct/ → src/
/link                    # run in Claude Code — creates symlink, syncs commands/settings

# Then start the dev server
bun dev-server.ts        # live from src/ at http://localhost:3001
```

Run `/install` to switch back to a deployed copy.

### Upgrade

```bash
git pull && bun install.ts   # pulls latest, redeploys, preserves user data
```

What survives an upgrade: ALL CAPS `.md` files in `core/identity/` and `memory/` (e.g. `SOUL.md`, `USER.md`). Everything else in `~/.claude/construct/` is overwritten. `~/.construct/` (DB, sessions, signals) is never touched.

### Production

```bash
systemctl --user start   construct-ui
systemctl --user stop    construct-ui
systemctl --user status  construct-ui
```

Serves pre-built SPA on port **3000**. Deployed via `bun install.ts`.

### Research Workers

Workers are spawned automatically by the UI on startup (`WORKER_COUNT=3` by default). They require `OPENROUTER_API_KEY`. To run standalone:

```bash
systemctl --user start   construct-research-worker
journalctl --user -u construct-research-worker -f   # tail logs
```

Workers poll `construct.db` for pending research jobs, heartbeat every 60s, and restart automatically on crash (exponential backoff, max 20 restarts).

### Tests

```bash
bun test.ts              # unit + integration (src/tests/*.test.ts), fails if <90% pass
npm run ui:e2e           # Playwright e2e: goals UI
npm run validate         # JSON lint (settings-hooks.json, skill-rules.json)
```

### Deploy

```bash
bun install.ts           # src/ → ~/.claude/construct/, deps, systemd, DB verify
```

Safe to re-run. All user data in `~/.construct/` is preserved.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `API_PORT` | 3001 dev / 3000 prod | UI server port |
| `OPENROUTER_API_KEY` | — | Required for research workers |
| `ANTHROPIC_API_KEY` | — | Optional fallback |
| `WORKER_COUNT` | 3 | Research workers to spawn |
| `DATABASE_URL` | `~/.construct/construct.db` | Override DB path |
| `CONSTRUCT_DATA_ROOT` | `~/.construct/` | Override data root |
| `MEMORY_DB_PATH` | `~/.construct/memory/sqlite_vec.db` | Override memory DB path |

Place in `.env` at repo root; sourced automatically on dev start.

---

## Documentation

| Document | Contents |
|---|---|
| [INSTALL.md](INSTALL.md) | Installation, upgrade, verification |
| [docs/specs/SPEC.md](docs/specs/SPEC.md) | Core + UI behavioral spec |
| [docs/specs/HOOKS.md](docs/specs/HOOKS.md) | Hook scripts, events, behavior |
| [docs/specs/SKILLS.md](docs/specs/SKILLS.md) | Skills, commands, routing |
| [docs/specs/TESTS.md](docs/specs/TESTS.md) | Test suite listing |
| [docs/specs/TELEMETRY.md](docs/specs/TELEMETRY.md) | Telemetry spec |
| [docs/specs/RESEARCH.md](docs/specs/RESEARCH.md) | Research module spec |
| [docs/specs/EVAL.md](docs/specs/EVAL.md) | Eval harness spec |
| [docs/AGENTS.md](docs/AGENTS.md) | Agent definitions |
| [src/skills/design-construct/](src/skills/design-construct/) | Design system tokens, kits, previews (registered as the `design-construct` skill) |
