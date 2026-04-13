# Construct — Agent Entry Point

Construct is Claude Code-native personal AI infrastructure. Source lives in `src/`, installs to `~/.claude/construct/` via `bun install.ts`. User data lives in `~/.construct/` (never touched by installer).

**Dev:** `bun dev-server.ts` → port 3001 (Vite HMR, live from `src/`)
**Prod:** systemd `construct-ui.service` on port 3000
**Both share:** `~/.construct/` data directory

---

## Directory map

| Path | Contents |
|---|---|
| `src/core/hooks/` | All non-memory hooks (quality, isolation, git, context, routing, security) |
| `src/memory/hooks/` | Session lifecycle hooks (session-start, rating-capture, session-summary, memory-extract) |
| `src/skills/` | Skill playbooks (`<name>/SKILL.md`) + `skill-rules.json` routing config |
| `src/agents/` | Agent definition files |
| `src/data/src/paths.ts` | Source of truth for all path constants |
| `src/ui/api/src/` | Fastify API (routes, server, worker supervisor) |
| `src/ui/web/src/` | React SPA (pages, components, API hooks) |
| `src/research/src/` | Autonomous research engine, worker, providers |
| `src/telemetry/src/` | JSONL parser, reducers, pricing |
| `install.ts` | 14-step installer: deploys `src/` → `~/.claude/construct/` |
| `test.ts` | Test runner: scans `src/tests/`, requires 90% pass |

---

## Source-of-truth files

- **Hook registrations:** `src/core/hooks/settings-hooks.json`
- **Skill keyword routing:** `src/skills/skill-rules.json`
- **All path constants:** `src/data/src/paths.ts` — never hardcode `~/.construct` or `~/.claude`

---

## Naming conventions

- Hook files: `{area}-{event}-{verb}.ts` (e.g., `quality-post-format.ts`)
- Hook areas: quality, context, isolation, git, routing, security, session, memory
- Skills: each in `src/skills/<name>/SKILL.md`

---

## Testing

```
bun test.ts              # unit tests, requires 90% pass
npm run ui:e2e           # Playwright browser tests
npm run validate         # JSON lint: settings-hooks.json + skill-rules.json
```

Never claim done without running tests against the actual running system.

---

## What NOT to do

- Never place hooks in `src/skills/hooks/` — that directory does not exist
- Never write to `~/.claude/` directly — use `bun install.ts` to deploy
- Never hardcode paths — use `dataPaths`/`claudePaths` from `src/data/src/paths.ts`
- Never add a hook without registering it in `src/core/hooks/settings-hooks.json`
- Never add a skill without adding keyword triggers to `src/skills/skill-rules.json`
- Never edit `~/.claude/construct/` files directly — edit `src/` then reinstall
- Never write to `~/.claude/CLAUDE.md` — behavioral rules live in `src/core/CLAUDE.md`

---

## Where to start for each module

| Module | Read first |
|---|---|
| Hooks | `src/core/hooks/settings-hooks.json`, `src/trace.ts`, `docs/HOOKS.md` |
| Skills | `src/skills/skill-rules.json`, `docs/SKILLS.md` |
| UI API | `src/ui/api/src/app.ts` (route registrations) |
| UI Web | `src/ui/web/src/App.tsx` (router), `src/ui/web/src/pages/` |
| Telemetry | `src/telemetry/src/adapter.ts`, `src/telemetry/src/reducers.ts` |
| Research | `src/research/src/engine.ts`, `src/research/src/worker.ts` |
| Install | `install.ts` lines 1–50 (step overview), `src/data/src/paths.ts` |

---

## Workflow

1. Edit source in `src/`
2. Verify at http://localhost:3001 (`bun dev-server.ts`)
3. Run `bun test.ts`
4. Run `bun install.ts` to deploy to production (port 3000)
5. Verify: `systemctl --user status construct-ui` and `curl http://localhost:3000/api/system/info`
