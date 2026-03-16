# construct-dashboard

Web-based goal tracking, TODO management, and system dashboard. Fastify API + React SPA + SQLite, with an MCP server for Construct integration.

**Depends on:** construct-core

## Contents

- `api/` — Fastify 5 REST API with Drizzle ORM + better-sqlite3
- `web/` — React 19 SPA with Vite, Tailwind CSS v4, TanStack Query
- `mcp/` — MCP server wrapping the REST API (stdio transport)
- `shared/` — Zod validators and TypeScript types shared between api/web
- `scripts/seed.ts` — sample data seeder
- `e2e/` — Playwright tests (not yet written)
- `requirements.md` — original product requirements document

## Usage

### Running locally

```bash
cd construct/dashboard
npm install
npm run dev    # API on :3001, Vite on :5173
```

### Building

```bash
npm run build  # builds shared → api → web
npm test       # Vitest API integration tests
npm run seed   # seed sample data
```

### MCP integration

The MCP server at `mcp/` wraps the REST API for AI agent use. Configure in Claude Code's MCP settings:

```json
{
  "mcpServers": {
    "dashboard": {
      "command": "npx",
      "args": ["tsx", "construct/dashboard/mcp/src/index.ts"],
      "env": {
        "GOAL_TRACKER_URL": "http://localhost:3001",
        "GOAL_TRACKER_TOKEN": ""
      }
    }
  }
}
```

MCP tools: list_goals, get_goal, create_goal, update_goal, delete_goal, list_categories, create_category, delete_category, list_notes, add_note, update_note, delete_note, list_todos, create_todo, update_todo, delete_todo, list_recurring_todos, create_recurring_todo, complete_recurring_todo, get_summary, get_history.

## Architecture

- **App factory:** `createApp(opts?)` in `api/src/app.ts`. Tests use `:memory:` SQLite.
- **Event bus:** Typed EventEmitter. Mutation routes emit events; history service and webhook dispatcher listen.
- **Auth:** WebAuthn/Passkeys. Dev bypass when no credentials registered. API token auth for agents.
- **Schema:** Raw SQL `CREATE TABLE IF NOT EXISTS` in Fastify's `onReady` hook.
- **Frontend proxy:** Vite proxies `/api` to Fastify in dev. Production: API serves built frontend via @fastify/static.

## Data

SQLite at `./data/goals.db` (WAL mode). Tables: goals, categories, goal_categories, notes, todos, recurring_todos, recurring_todo_completions, history_logs, webauthn_credentials, api_tokens, webhooks.

## Verification

Post-install checks: see [INSTALL.md](INSTALL.md).
