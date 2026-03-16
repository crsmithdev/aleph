# Goal Tracker — Product Requirements Document

## Overview

A personal, web-based application for managing long-term goals and day-to-day TODOs. Designed for a single user, accessed from multiple devices over the internet, with cloud-hosted data and backups. The architecture should be clean enough to support a future AI agent layer without major refactoring.

---

## 1. Data Model

### 1.1 Goals

| Field       | Type                  | Details                                      |
|-------------|-----------------------|----------------------------------------------|
| Title       | string                | Short title (primary identifier)             |
| Priority    | enum                  | Low, Medium, High, Critical                  |
| State       | enum                  | Not Started, Actionable, Scheduled, Waiting, Done, Canceled |
| Categories  | many-to-many          | A goal can be tagged with multiple categories |
| Created     | datetime (auto)       | Set once at creation                         |
| Updated     | datetime (auto)       | Set on any mutation                          |
| Archived    | boolean               | Hides from all views unless toggled          |

**§1.1.1 — State transitions:** Freeform. Any state can transition to any other state. No enforced workflow. The UI should provide a quick-complete toggle button that sets state to Done (or back to its previous state), in addition to the full state dropdown.

**§1.1.2 — No separate description field.** Goals have a title and notes. Notes serve as all detailed context.

### 1.2 Categories (Themes)

| Field | Type   | Details          |
|-------|--------|------------------|
| Name  | string | Unique label     |
| Color | string | Optional, for UI |

Full CRUD. Deleting a category removes it from all tagged goals (does not delete goals).

### 1.3 Notes (per Goal)

Notes are an ordered, timestamped list attached to a goal. They are the primary way to track context and progress.

| Field   | Type              | Details                                  |
|---------|-------------------|------------------------------------------|
| Content | string            | The note text (Markdown supported)       |
| Created | datetime (auto)   | When the note was first added            |
| Updated | datetime (auto)   | When the note was last edited            |

- **Append-first:** The default action is adding a new note entry.
- **Mutable:** Any existing note can be edited or deleted.
- **History preserved:** Edits and deletions are captured in the goal's history log (§1.5).

### 1.4 TODOs

TODOs are lightweight, day-oriented tasks. They can be standalone or linked to a goal.

| Field       | Type                 | Details                                        |
|-------------|----------------------|------------------------------------------------|
| Title       | string               | Short description                              |
| Done        | boolean              | Simple completion flag                         |
| Note        | string (optional)    | Single free-text note (no versioning/history)  |
| Due Date    | date (optional)      | For one-off scheduled TODOs                    |
| Goal        | FK (optional)        | Link to a parent goal                          |
| Created     | datetime (auto)      |                                                |
| Updated     | datetime (auto)      |                                                |

**No priority on TODOs.** They are intentionally lightweight.

**Carryover behavior:** Any TODO not marked Done by end-of-day automatically appears on the next day's list, visually distinguished as carried over / overdue.

### 1.5 Recurring TODOs

Recurring TODOs are a **template**, not a projection. They define a task that should appear at a given frequency. There is no calendar of future generated instances.

| Field       | Type                 | Details                                        |
|-------------|----------------------|------------------------------------------------|
| Title       | string               | Short description                              |
| Frequency   | enum                 | Daily, Weekly, Monthly                         |
| Goal        | FK (optional)        | Link to a parent goal                          |
| End Date    | date (optional)      | When recurrence stops; null = indefinite       |
| Active      | boolean              | Can be paused without deleting                 |

**Completion model:** A recurring TODO is a persistent template, not a generator of discrete instances. Each period (day/week/month), the template surfaces as completable. Completing it satisfies the current period. If not completed:

- It is visually flagged as missed/late for the current period.
- When the next period begins, the slate resets — a fresh "due" appears. There is no pile-up of overdue instances.
- Whether the previous period was missed should be visible (e.g. a "missed last time" indicator), but old periods do not accumulate as separate items.

**Implementation note:** Recurring TODOs are fundamentally a different type from one-off TODOs and from goals. They share some surface-level UI behavior but should not be forced into the same data model. They are templates with period-scoped completion state, not task instances.

### 1.6 History Log (per Goal)

Automatic, append-only changelog attached to each goal.

Tracked events:
- State changes (old → new)
- Priority changes (old → new)
- Category additions / removals
- Note added, edited, or deleted (with content snapshot)
- TODO linked or unlinked
- Archive / unarchive

Each entry: `{ timestamp, event_type, details }`.

---

## 2. Views & UI

### 2.1 Goal View (Default)

- Goals grouped by category
- Within each group, show: title, priority, state, created date, updated date, latest note
- Sortable and filterable by priority, state, updated date
- **Toggle: Show/hide completed goals** (state = Done)
- **Toggle: Show/hide archived goals**

### 2.2 TODO View

- Focused on "today" with navigation to other days
- Sections: Overdue / Carried Over, Today, Recurring (due this period)
- One-off TODOs with a future due date are visible on their respective day
- Each TODO shows its linked goal (if any) as a subtle label/link
- Quick-add for new TODOs from this view

### 2.3 Summary / Export View

- Select an arbitrary date range, or use presets: This Week, Last Week, This Month, Last Month, This Quarter, This Year, Custom
- Shows:
  - Goals created, completed, or state-changed in the range
  - TODOs completed in the range
  - Notes added in the range
- Export as **Markdown** file

### 2.4 General UI Requirements

- Modern, minimal design
- Dark color scheme
- Responsive (usable on desktop and mobile browsers)
- Fast — no unnecessary loading states for a single-user app

---

## 3. Infrastructure

### 3.1 Hosting

- Cloud-hosted on a VPS (DigitalOcean, AWS, or Google Cloud) or a lightweight platform like Fly.io / Railway
- Must support persistent disk storage (for the SQLite database file)
- No managed database needed — SQLite runs in-process
- Accessible over the internet via HTTPS
- Litestream runs as a sidecar for continuous replication (see §3.3)

### 3.2 Database

- **SQLite** via `better-sqlite3`, running on the same host as the application
- Single file database — no separate database process
- Single user — no concurrency concerns; SQLite's single-writer model is a non-issue
- Schema migrations managed in code via **Drizzle ORM** (drizzle-kit for migrations)
- The database file lives on persistent storage on the VPS

### 3.3 Continuous Replication (Litestream)

- **Litestream** runs as a sidecar process alongside the application
- Continuously replicates SQLite WAL changes to a remote destination in near-real-time
- **Primary destination:** Google Cloud Storage (pairs with existing Google account; also satisfies the Google Drive backup preference)
- **Secondary destination:** S3-compatible storage (for redundancy or if preferred)
- **Restore:** Single command (`litestream restore`) downloads the latest replica and reconstructs the database file
- This provides automatic, continuous, off-machine backup with no cron jobs
- Litestream is mature, battle-tested, and designed specifically for this use case

### 3.4 Authentication

- Passkeys / WebAuthn
- Single-user: only one registered credential set
- Session-based after initial auth
- No passwords, no OAuth dependency

### 3.5 Backups

Backup operates in two layers:

**Layer 1 — Litestream (continuous, automatic):**
- Always running. Handles the "off-machine persistence" requirement with no user intervention.
- Near-real-time replication to Google Cloud Storage and/or S3.
- Restore is a single CLI command.

**Layer 2 — Application-level snapshots (manual + scheduled):**
- **Manual:** Create, list, and restore named snapshots from the UI. A snapshot copies the current SQLite file to a timestamped backup in remote storage.
- **Automatic:** Configurable schedule (e.g. daily at 3 AM) creates a named snapshot. This provides discrete restore points in addition to Litestream's continuous stream.
- **Destinations:** Google Cloud Storage (primary), S3-compatible (secondary).
- **Restore from UI:** List available snapshots, select one, confirm, and the app swaps in the restored database file and restarts.

### 3.6 Future: Desktop Wrapper

- Architecture should not preclude wrapping in Electron or Tauri later
- No desktop-specific work now — just don't use browser APIs that would break in a webview

---

## 4. AI Agent Integration

The architecture must support AI agent interaction from Phase 1, with concrete deliverables in Phase 3.

### 4.1 API-First Architecture
- **All data access goes through a RESTful API.** The UI is a client of this API — there is no server-rendered HTML with embedded data mutations.
- API should be well-documented (OpenAPI / Swagger spec, auto-generated from code).
- Auth supports API tokens in addition to WebAuthn sessions (for agent use).
- Clean, predictable resource naming: `/api/goals`, `/api/todos`, `/api/categories`, etc.

### 4.2 MCP Server (Phase 3)
- Build a **Model Context Protocol (MCP) server** that exposes the app's capabilities as MCP tools.
- This allows Claude (via Claude Code, Cowork, or any MCP-compatible client) to interact with goals, TODOs, notes, and categories natively — no custom integration code needed.
- The MCP server wraps the existing REST API, so it's a thin layer, not a parallel data path.
- **Tools to expose:** goal CRUD, TODO CRUD, note append/edit, category management, state changes, summary/export generation, search/filter.
- Package as a standalone npm module that can be pointed at any running instance of the app.

### 4.3 Webhook / Event System (Phase 3)
- Internal event bus that fires on all state-changing operations (goal state change, TODO completion, note added, etc.).
- **Webhook support:** Register external URLs to receive POST notifications on specific event types.
- Events are the same ones tracked in the history log (§1.6), so this is a natural extension.
- Use cases: trigger an AI agent workflow when a goal changes state, send a notification when a recurring TODO is missed, feed events into an external dashboard or logging system.
- Webhooks are optional and configurable via the API and UI (a simple "Webhooks" settings page).

### 4.4 CLAUDE.md and AI Development Conventions
- The repository root contains a `CLAUDE.md` file documenting project conventions, architecture decisions, tech stack, and development workflow.
- This file is the primary reference for Claude Code and any AI agent working on the codebase.
- Custom subagent definitions (for backend, frontend, and testing) should be defined in `~/.claude/agents/` or the repo's `.claude/agents/` directory.
- The project is structured for maximum AI-legibility: consistent naming, comprehensive TypeScript types, minimal indirection, and clear module boundaries.

---

## 5. Tech Stack

### 5.1 Backend
- **Runtime:** Node.js (LTS)
- **Language:** TypeScript
- **Framework:** Fastify (preferred for performance + schema validation + OpenAPI generation via `@fastify/swagger`)
- **ORM:** Drizzle ORM (with `better-sqlite3` driver)
  - SQL-like API with minimal abstraction — more transparent than Prisma, better for AI-assisted development
  - First-class SQLite support; migration tooling via `drizzle-kit`
  - If the app ever needs to move to Postgres, Drizzle supports both with the same schema definitions
- **Database:** SQLite (single file, in-process)
- **Replication:** Litestream (sidecar process for continuous backup to GCS/S3)
- **API style:** REST, with OpenAPI spec auto-generated from Fastify route schemas

### 5.2 Frontend
- **Framework:** React (with Vite)
- **Language:** TypeScript
- **Styling:** Tailwind CSS (dark theme)
- **State management:** React Query (TanStack Query) for server state; minimal client state
- **Routing:** React Router

### 5.3 Testing
- **Unit tests:** Vitest
- **Integration tests:** Vitest + Supertest (API-level)
- **End-to-end tests:** Playwright (high-level abstraction over Chrome DevTools Protocol; runnable headlessly by an AI agent)
- **Test structure:** Co-located with source files for unit; dedicated `e2e/` directory for Playwright
- **Pre-commit requirement:** E2E tests must pass before any commit. Enforce via git hooks (husky + lint-staged or similar). The repo README and contributing docs must emphasize this workflow.

### 5.4 Project Structure
- Monorepo with clear `packages/` or `apps/` separation (e.g. `apps/api`, `apps/web`)
- Shared types package if needed
- Conventional commits, clear README, documented API
- Optimized for AI-assisted development: consistent patterns, good naming, minimal magic
- **`CLAUDE.md`** in repo root: documents architecture, conventions, tech stack, and development workflow for AI agents
- **`.claude/agents/`** directory: custom subagent definitions for backend, frontend, and testing specializations
- **`scripts/`** directory: seed data migrator, backup utilities, development helpers

---

## 6. Phases

### Phase 1 — Core Goals + Infrastructure
- Goal CRUD (create, read, update, delete)
- Category CRUD + tagging
- Notes system with append/edit/delete
- History log (auto-tracked)
- Default goal view with grouping, sorting, filtering
- Completed/archived toggles
- Dark-themed UI shell
- SQLite database with Drizzle ORM schema + migrations
- Litestream configured for continuous replication to GCS/S3
- WebAuthn single-user auth
- REST API (all data access via API)
- Application-level backup snapshots (manual create/list/restore via API + UI; scheduled via cron)
- Basic deployment (VPS with persistent disk)
- Seed script / migrator to import spreadsheet data
- `CLAUDE.md` and project conventions established
- Internal event bus (fires on all mutations — foundation for history log and future webhooks)

### Phase 2 — TODOs + Recurrence
- TODO CRUD
- Goal ↔ TODO linking
- TODO view (day-focused, with overdue carryover)
- Recurring TODO templates
- Quick-add from TODO view

### Phase 3 — AI Integration, Export & Polish
- Summary view with date range selection + presets
- Markdown export
- OpenAPI spec generation (auto-generated from Fastify route schemas)
- API token auth (for agent and webhook use)
- **MCP server** — npm package wrapping the REST API as MCP tools (§4.2)
- **Webhook system** — register external URLs for event notifications (§4.3)
- E2E test suite (Playwright)
- UI polish, edge cases, performance

---

## 7. Resolved Questions

| # | Question | Resolution |
|---|----------|------------|
| 7.1 | Recurring TODO miss behavior | No pile-up. Recurring TODOs are persistent templates with period-scoped completion. Missed periods reset; a "missed last time" indicator is shown. They are a distinct type from one-off TODOs. |
| 7.2 | "Done" state | Done is the 6th state. UI provides both a state dropdown and a quick-complete toggle button. |
| 7.3 | Name vs. description | Title only. Notes serve as all detailed context. |
| 7.4 | TODO priority | No priority on TODOs. They are title + done/not-done + optional single note (no history). |
| 7.5 | Playwright vs. raw CDP | Playwright. Higher-level, better for AI agents and humans. E2E tests are a pre-commit gate. |
| 7.6 | Database choice | SQLite (via better-sqlite3) + Litestream for continuous replication. Simpler, faster, cheaper than Postgres for single-user. Backup = copy a file. |
| 7.7 | ORM choice | Drizzle ORM. Better SQLite support than Prisma, more SQL-like, less magic, better for AI-assisted development. |
| 7.8 | AI agent tooling | MCP server (Phase 3) + webhook/event system (Phase 3). Claude Code for building the codebase, not Cowork. |
| 7.9 | Build tooling | Claude Code with custom subagents for backend, frontend, and testing. CLAUDE.md in repo root. |

## 8. Remaining Open Questions

### 8.1 Deployment target
Several options are available (DigitalOcean, AWS, GCP). With SQLite + Litestream, a simple **$4-6/mo VPS** (DigitalOcean droplet or equivalent) is sufficient — no managed database add-on needed. The only requirement is persistent disk. Fly.io is also a strong option as it has native Litestream integration. To be decided at Phase 1 implementation time.

### 8.2 Google Cloud Storage / Drive setup
Litestream replicates to Google Cloud Storage (GCS), which requires a GCP project with a storage bucket and service account credentials. This is a one-time setup. If Google Drive is preferred over GCS for the application-level snapshot backups, that requires the Drive API enabled with a service account — to be set up when needed.

### 8.3 Litestream restore workflow
When restoring from Litestream, the application must be stopped, the database file replaced, and the application restarted. The restore-from-UI flow needs to handle this gracefully (e.g. the API triggers a restore script that stops itself, runs `litestream restore`, and restarts via a process manager like systemd or Docker).
