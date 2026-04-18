# Research UI — mockup punch list

Tracks what's landed, deferred, and next for the research UI, against the mockups in this directory (`queries.html`, `events.html`, `query-detail.html`, `common.css`).

Last updated: 2026-04-17 by Claude.

---

## Landed on `main`

### Summary endpoint + UI cards (`services/queries.ts`, `ResearchQueriesPage.tsx`, `ResearchWorkersPage.tsx`)
Branch: `feat/research-summary`.

- **Backend:** new `GET /research/summary` → `{ topConcepts, extractionQueue, stepsPerHour, recentConcepts }`. Implementation in `getResearchSummary()` — four small SQL queries (top concepts joined through `research_finding_concepts`, extraction queue grouped by `extraction_status`, steps/hr windowed on `idx_rs_session_created`, recent concepts joined to `research_queries.title`). `extraction_status = 'claimed'` → UI-facing `running`.
- **Queries page:** summary cards footer below the list — Top concepts this month (pill chips with finding_count), Extraction queue (total + running/queued/failed breakdown), Spend last 7 days (number + polyline sparkline from existing `/research/stats`). Only renders when there are visible queries; degrades gracefully with empty arrays.
- **Workers page:** throughput strip expanded from 4 to 6 `StatCard`s — adds **Steps / hr** and **Extraction Backlog** (running + pending, with failed shown in the detail line).
- **Hook:** `useResearchSummary()` refetches every 15s (matches other near-live dashboards).

### Queries page — per-row stats (`ResearchQueriesPage.tsx`, `services/queries.ts`)
Branch: `feat/research-queries-stats`.

- **Backend:** new `listQueriesWithStats()` + `computeQueryStats()` in `src/research/src/services/queries.ts`. Returns per-session `{ findings, concepts, sources, threads, cost, last_step_at, findings_by_day[7] }` aggregate. One SQL query per metric (5 total), `IN (…)`-filtered by visible ids, uses existing `idx_*_session_*` indexes. `listQueries` itself is unchanged — internal callers (engine, tests) keep the original fast path.
- **API:** `GET /research/queries` now returns `stats` on each query.
- **UI:** each query card footer shows `N F · M C · K S` count triple, a 7-day findings sparkline, and last-step relative time (`3m`, `2h`). Hides gracefully for queries with no activity. Card layout otherwise unchanged.
- **Type:** `ResearchQuery.stats?: QueryStats` added to `src/ui/web/src/api/research-hooks.ts` (optional so single-query `getQuery` callers don't need to change).

### Workers page (`ResearchWorkersPage.tsx`)
Commit: `b28c037` (merged in `e977089`).

- **Throughput strip** (new top row, 4 cards): Active Queries · Findings Today · Spend Today · 7d Cost. Derived from `/research/stats?range=7d&granularity=day`, no new backend.
- **In Flight table** (merged running + queued). Sorted running-first by status rank. Adds Worker + Elapsed columns. Cancel × works for both running and pending.
- **Fix:** completed history no longer includes running/claimed jobs.
- Page name still "Workers"; revisit when a cross-session event feed lands.

### Queries page — header + chips (`ResearchQueriesPage.tsx`)
Commit: `afcac07` (merged in `9e2528a`).

- **Header subtitle** now shows `N queries · K active · $X spent · 7d` (conditional segments).
- **Chip filters** show per-bucket counts inline (`All 14`, `Active 3`, etc.).

### Other recent landings (pre-this-branch)
- Config tab layout fixes, MapView off on Process tab, SourcesView useMemo hoist, new-query form populates from server defaults, tighter thread/depth default caps, research-redesign mockup removed.

---

## Deferred — needs new backend aggregates

These are the drivers for the upcoming "research aggregates" endpoint work.

### For queries page (`queries.html`)
- **Exhausted / Halted statuses** — schema change to `ResearchQuery.status`; not just UI.

### For workers page (future "Activity" rename)
- **Right-rail live event feed** cross-session — SSE stream is per-session only today (`/research/queries/:id/stream`). Needs a new multiplexed `/research/stream` endpoint.
- **Right-rail recent-concepts chips** — data is available (`summary.recentConcepts`), just not yet placed on the workers page. Defer until the event rail lands so we can design the right rail as one unit.

### For query-detail `#doc` tab
Typographic affordances in generated documents:
- Inline `concept-link` (dotted-underline jump to Knowledge tab).
- `fact-box` / `fact-row dt` table-of-facts block.
- `pullquote` blockquote style.

These require changes in the doc **generator** (what it emits as markdown/HTML), not just in the renderer. Out of scope for pure UI work.

---

## Not doing

- **Separate Events page** — user decided the main event view stays on query-detail; workers page absorbs any cross-session event data instead.
- **Monitors sidebar link under Research** — user said ignore.

---

## Next — backend aggregates

Endpoints #1 (`/research/queries` + stats) and #2 (`/research/summary`) have landed.

### 3. (Later) Cross-session SSE stream

`GET /research/stream` — fanout of all per-session streams. Only needed when we actually add the live-event rail to the workers page. Defer until we decide to build the event rail.

---

## Open branches / in-flight

None. `feat/research-queries-stats` and `feat/research-summary` both merged.

Remote branches remain (not deleted per CLAUDE.md rule):
- `feat/research-extraction` — merged, can be deleted by user.
- `feat/queries-page-metadata` — merged, can be deleted by user.
- `feat/research-queries-stats` — merged, can be deleted by user.
- `docs/research-punch-list` — merged (commit `d7e9b1c`), local-only, can be deleted by user.

---

## Working rules for this stream of work

- "Use what's there already" — prefer existing hooks/endpoints over new ones.
- Things needing new backend data → log in "Deferred" above; do not half-build.
- One small branch per UI-only change; land each before starting the next.
- Verify with `bun test.ts` + `bun run build` in `src/ui/web` + a headless Playwright smoke check before committing.
- Never delete remote branches without explicit permission.
