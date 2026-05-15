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
├── memory/         hooks/ (context-restore-start, rating-capture-submit, context-save-stop, memory-extract-stop)
├── skills/         skill-rules.json, 37 skill dirs
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
| SessionStart | `src/memory/hooks/context-restore-start.ts` | memory | Surface last session summary |
| UserPromptSubmit | `src/memory/hooks/rating-capture-submit.ts` | memory | Capture N/10 ratings |
| UserPromptSubmit | `src/memory/hooks/feedback-capture-submit.ts` | memory | Capture session feedback |
| UserPromptSubmit | `src/core/hooks/routing-classify-submit.ts` | core | Depth classification + skill matching |
| Stop | `src/core/hooks/quality-check-stop.ts` | core | E2e advisory check |
| Stop | `src/core/hooks/git-hygiene-stop.ts` | core | Git hygiene checks |
| Stop | `src/core/hooks/context-monitor-stop.ts` | core | Context window usage warning |
| Stop | `src/memory/hooks/context-save-stop.ts` | memory | Structured session summary |
| Stop | `src/memory/hooks/memory-extract-stop.ts` | memory | Auto-extract memories to semantic store |
| Stop | `src/memory/hooks/memory-consolidate-stop.ts` | memory | Consolidate semantic memory |
| PreToolUse (SQL) | `src/core/hooks/isolation-block-sql.ts` | core | Block destructive SQL |
| PreToolUse (Edit/Write) | `src/core/hooks/git-require-edit.ts` | core | Require commit before more edits |
| PreToolUse (Edit/Write) | `src/core/hooks/context-suggest-edit.ts` | core | Suggest compact when context high |
| PreToolUse (Bash) | `src/core/hooks/security-scan-bash.ts` | core | Pre-commit security scan |
| PostToolUse (Edit/Write) | `src/core/hooks/quality-format-edit.ts` | core | Lint/format on save |
| PostToolUse (Edit/Write) | `src/core/hooks/quality-typecheck-edit.ts` | core | TypeScript type-check on save |
| PostToolUse (Edit/Write) | `src/memory/hooks/signal-capture-posttooluse.ts` | memory | Capture edit signals |
| PreCompact | `src/core/hooks/context-backup-precompact.ts` | core | Transcript backup before compaction |

Full hook detail: [docs/specs/HOOKS.md](docs/specs/HOOKS.md)

---

## Slash Commands

**Global** (`src/commands/` → `~/.claude/commands/`):

| Command | Purpose |
|---|---|
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

Full skills and commands: [docs/specs/SKILLS.md](docs/specs/SKILLS.md)

---

## Skills

37 skill playbooks in `src/skills/<name>/SKILL.md`. The `routing-classify-submit.ts` hook reads `skill-rules.json` and activates matching skills based on prompt keywords. Skills can also be invoked explicitly via the `Skill()` tool.

| Skill | Purpose |
|---|---|
| `agent-browser` | Browser automation CLI for AI agents |
| `agents-audit` | Audit subagent definitions against rules |
| `agents-fix` | Apply fixes for agents-audit findings |
| `code-audit` | Audit TypeScript/JavaScript code under src/ |
| `code-conform` | Apply a code pattern from one file across peers |
| `code-debug` | Systematic four-phase root-cause debugging |
| `code-fix` | Apply fixes for code-audit findings |
| `code-refactor` | Refactor code for better organization and maintainability |
| `code-review` | Review code for issues then refactor |
| `code-simplify` | Remove AI-generated slop and over-engineering |
| `config-audit` | Full health check for Claude Code agent configuration |
| `context-compact` | Guide context compaction at logical task phase boundaries |
| `design-audit` | Systematic UI/UX design audit (18 dimensions) |
| `design-construct` | Construct design system — tokens, surfaces, type scale, iconography |
| `design-fix` | Apply fixes for peer-drift findings in UI surfaces |
| `docs-audit` | Post-hoc review of existing documentation |
| `docs-author` | Create, update, or enhance documentation |
| `docs-author-v2` | Create/update documentation (ENFORCEMENT MODE pilot) |
| `docs-conform` | Reference-based propagation across peer docs |
| `docs-fix` | Apply fixes for docs-audit findings |
| `docs-optimize` | Optimize docs for AI coding assistants and LLMs |
| `dogfood` | Qualitative single-run dogfood review of a tool or skill |
| `eval-harness` | Define and run evals to measure AI development reliability |
| `git-workflow` | Full git workflow — branch, implement, land via merge or PR |
| `grill-me` | Relentless interview about a plan or design |
| `hooks-audit` | Audit Claude Code hooks against rules |
| `hooks-fix` | Apply fixes for hooks-audit findings |
| `omnibus` | Run a verb across domains in parallel, merge findings |
| `ralph-loop` | Iterative autonomous work toward a well-defined goal |
| `search` | Quick web research — search, synthesize, report with sources |
| `security-audit` | Audit TypeScript/JavaScript code for vulnerabilities |
| `security-fix` | Apply remediations for security-audit findings |
| `skill-creator` | Create new skills, modify and improve existing skills |
| `skills-audit` | Audit SKILL.md files against rules |
| `skills-fix` | Apply fixes for skills-audit findings |
| `test-webapp` | Playwright toolkit for testing local web applications |
| `verify-completion` | Evidence-based completion gate before claiming success |

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
