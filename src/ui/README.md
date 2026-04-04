# construct-ui

General-purpose Construct web UI. Fastify API + React SPA serving goals, todos, observability, research, and system settings.

**Depends on:** @construct/data, @construct/goals, @construct/telemetry, @construct/research

## Contents

- `api/` — Fastify 5 REST API (goals, observability, research, backup, settings routes)
- `web/` — React 19 SPA with Vite, Tailwind CSS v4, TanStack Query

## Usage

### Running locally

```bash
cd construct/ui
npm install
npm run dev    # single server on :3000 (Fastify + Vite HMR)
```

### Building

```bash
npm run build  # builds api → web
npm test       # Vitest API integration tests
```

## Architecture

- **App factory:** `createApp(opts?)` in `api/src/app.ts`. Tests use `:memory:` SQLite.
- **Routes:** Thin wrappers — parse request, call `@construct/goals` service function, format response.
- **Event bus:** Goals EventBus + HistoryService initialized in app.ts. WebhookDispatcher listens for events.
- **Schema:** Goals DDL via `applyDDL()`. Webhooks DDL in `onReady` hook.
- **Frontend proxy:** Vite proxies `/api` to Fastify in dev. Production: API serves built frontend via @fastify/static.
- **No auth:** Single-user project. All routes are open.

## Data

SQLite at `~/.construct/construct.db` (WAL mode, overridable via `CONSTRUCT_DATA_ROOT`).
