# UI Module — Agent Guide

Fastify API + React SPA serving Aleph's web interface.

**Dev:** port 3001 — single process with Vite middleware (`bun dev-server.ts` from repo root)
**Prod:** port 3000 — pre-built `web/dist/` served by Fastify (`systemd aleph-ui.service`)

---

## Directory structure

```
src/ui/
  api/src/
    app.ts               — Fastify app factory, route registrations
    server.ts            — process entry point
    config.ts            — env-driven config
    env.ts               — env var declarations
    loop-supervisor.ts   — spawns/monitors one child process per running loop
    routes/              — one file per domain
    db/                  — Drizzle ORM schema + client
    plugins/             — error-handler
  web/src/
    App.tsx              — BrowserRouter + all Route definitions
    api/                 — React Query hooks (one file per domain)
    pages/               — page components (life/, research/, system/)
    components/          — shared UI components
    utils/               — format.ts, chart-helpers.ts
```

---

## API routes (all prefixed `/api`)

| Prefix | File |
|---|---|
| `/categories` | `routes/categories.ts` |
| `/goals` | `routes/goals.ts`, `routes/notes.ts`, `routes/history.ts` |
| `/todos` | `routes/todos.ts` |
| `/habits` | `routes/habits.ts` |
| `/backup` | `routes/backup.ts` |
| `/summary` | `routes/summary.ts` |
| `/webhooks` | `routes/webhooks.ts` |
| `/observability` | `routes/observability.ts` |
| `/research` | `routes/research.ts` |
| `/loops` | `routes/loops.ts` |
| `/api/docs` | Swagger/OpenAPI UI |
| `/public` | `routes/public.ts` (no `/api` prefix) |

---

## Web routes (React Router)

| Path | Page |
|---|---|
| `/summary` | SummaryPage |
| `/goals`, `/goals/:id` | GoalsPage, GoalDetailPage |
| `/todos` | TodosPage |
| `/habits` | HabitsPage |
| `/research` | ResearchLandingPage |
| `/research/monitors` | ResearchMonitorsPage |
| `/research/config` | ResearchConfigPage |
| `/research/:id` | ResearchLoopDetail |
| `/research/queries` | redirect → `/research` |
| `/research/history` | redirect → `/research` |
| `/observability` | OverviewPage |
| `/observability/tools`, `/observability/tools/:name` | ToolsPage, ToolDetailPage |
| `/observability/hooks`, `/observability/hooks/:name` | HooksPage, HookDetailPage |
| `/observability/skills`, `/observability/skills/:name` | SkillsPage, SkillDetailPage |
| `/observability/subagents` | SubagentsPage |
| `/observability/sessions`, `/observability/sessions/:id` | SessionsPage, SessionTracePage |
| `/observability/sessions/:id/turns/:turnIndex` | TurnTracePage |
| `/observability/evals` | EvalsPage |
| `/observability/compaction` | CompactionPage |
| `/observability/events` | EventsPage |
| `/observability/memory` | MemoryPage |
| `/observability/signals` | SignalsPage |
| `/observability/db` | DbStatsPage |
| `/settings` | SettingsPage |

---

## Conventions

**Adding an API route:**
1. Create `src/ui/api/src/routes/<domain>.ts`
2. Import and register in `src/ui/api/src/app.ts` under the `/api` prefix block

**Adding a web page:**
1. Create component in `src/ui/web/src/pages/`
2. Add `<Route>` in `src/ui/web/src/App.tsx`

**API client hooks:** live in `src/ui/web/src/api/` — one file per domain (`research-hooks.ts`, `observability-hooks.ts`, `monitor-hooks.ts`, `hooks.ts` for goals/todos/habits). Add new hooks here, not inline in pages.

**State management:** React Query (`@tanstack/react-query`) for all server state — no Redux, no local fetch calls in components.

**Charts:** custom components in `src/ui/web/src/components/charts/`. Use `ChartContainer` wrapper; use `chartTheme.ts` for consistent colors.

**Database:** Drizzle ORM. Schema in `src/ui/api/src/db/schema.ts`, client in `src/ui/api/src/db/client.ts`. Access via `fastify.db` in route handlers.

**TypeScript:** strict mode. All props and API response shapes must be typed. Run `tsc --noEmit` before claiming done.

---

## LoopSupervisor

`src/ui/api/src/loop-supervisor.ts` spawns one child process per running loop on `POST /api/loops/start`. Each child runs the loop engine to completion and persists every step to `cycle_ledger` so a SIGKILL mid-run resumes idempotently on respawn. There is no long-running worker pool — children come and go with loops.
