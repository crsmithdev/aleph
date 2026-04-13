# UI Module — Agent Guide

Fastify API + React SPA serving Construct's web interface.

**Dev:** port 3001 — single process with Vite middleware (`bun dev-server.ts` from repo root)
**Prod:** port 3000 — pre-built `web/dist/` served by Fastify (`systemd construct-ui.service`)

---

## Directory structure

```
src/ui/
  api/src/
    app.ts               — Fastify app factory, route registrations, WorkerSupervisor init
    server.ts            — process entry point
    config.ts            — env-driven config
    env.ts               — env var declarations
    worker-supervisor.ts — spawns/monitors research worker child processes
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
| `/api/docs` | Swagger/OpenAPI UI |

---

## Web routes (React Router)

| Path | Page |
|---|---|
| `/summary` | SummaryPage |
| `/goals`, `/goals/:id` | GoalsPage, GoalDetailPage |
| `/todos` | TodosPage |
| `/habits` | HabitsPage |
| `/research` | ResearchQueriesPage |
| `/research/:id` | ResearchQueryDetailPage |
| `/research/:id/plan` | ResearchPlanPage |
| `/research/workers` | ResearchWorkersPage |
| `/research/config` | ResearchConfigPage |
| `/observability` | OverviewPage |
| `/observability/tools`, `/observability/tools/:name` | ToolsPage, ToolDetailPage |

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

## WorkerSupervisor

`src/ui/api/src/worker-supervisor.ts` spawns N research worker processes (`src/research/src/worker.ts`) as child processes. Count defaults to `WORKER_COUNT` env var (default 3). Started in `app.ts` on server boot (skipped in test mode). Do not bypass `supervisor.start()`/`supervisor.stop()` lifecycle.
