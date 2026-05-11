# Research UI — mockup punch list

Tracks what's landed, deferred, and next for the research UI, against the mockups in this directory (`queries.html`, `events.html`, `query-detail.html`, `common.css`).

Last updated: 2026-04-18 by Claude.

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

### Cross-session SSE + workers-page live activity rail (`routes/research.ts`, `api/research-hooks.ts`, `ResearchWorkersPage.tsx`)
Branch: `feat/research-stream-sse`.

- **Backend:** new `GET /research/stream` — multiplexed SSE across all sessions. 500 ms polling cursor per client over findings/threads/steps/jobs/sessions; 15 s heartbeat comment. Cursors are initialised off current max-timestamps, so reconnects don't replay history.
- **Hook:** `useCrossSessionStream(enabled, maxEvents)` → bounded in-memory ring of `StreamEvent`s; `StreamEvent` union extended with a `session` variant.
- **Workers page:** adds an `ActivityRail` (right column on `xl:`) with recent-concepts chips on top and a live activity feed below (no pills; colored uppercase kind labels at the 14 px floor). Layout wraps in `xl:grid-cols-[minmax(0,1fr)_320px]`.

### Exhausted / Halted session statuses (`types.ts`, `engine.ts`, `worker.ts`, queries/detail/sessions pages)
Branch: `feat/research-statuses`.

- **Schema + engine:** `ResearchQuery.status` union extended with `'exhausted' | 'halted'`. Budget transitions in `worker.ts` now write `halted` (not `paused`). `engine.runOnce()` flips an otherwise-active session to `exhausted` when it finishes with no queued/active threads remaining.
- **UI:** queries-page status chip + dot palette updated (`halted` → red, `exhausted` → muted); session list/detail pages render the new badges; detail's Enable button now labelled **Resume** and shown for paused/halted/exhausted alike.

### Doc-tab typography: concept-link, fact-box, pullquote (`ResearchQueryDetailPage.tsx`, `engine.ts`)
Branch: `feat/research-doc-typography`.

- **Renderer:** `DocumentView.cleanDoc` now rewrites `[[Concept Name]]` wiki-links into `[Name](#concept:slug)`. The `a` component detects the `#concept:` scheme and calls `onNavigateToConcept`, which the parent page wires to `setTab('knowledge')` + a `pendingConceptName` that `KnowledgeView` resolves on next render (by canonical name or alias, slug-matched). `blockquote` upgraded to the mockup's pullquote style (accent border, bg-secondary, rounded, italic). New `code` override renders ` ```facts ` fenced blocks as a `<dl>` fact-box with `Term = Value` rows; all other fenced blocks use the standard `<pre>`.
- **Generator:** per-concept section prompt in `engine.ts` documents the three constructs and lists the sibling top-concept names so `[[wiki-links]]` only point at concepts the doc actually covers.

### Other recent landings (pre-this-branch)
- Config tab layout fixes, MapView off on Process tab, SourcesView useMemo hoist, new-query form populates from server defaults, tighter thread/depth default caps, research-redesign mockup removed.

---

## Not doing

- **Separate Events page** — user decided the main event view stays on query-detail; workers page absorbs any cross-session event data instead.
- **Monitors sidebar link under Research** — user said ignore.

---

## Next

All punch-list items landed. Further research-UI polish is open-ended; no queued work.

---

## Open branches / in-flight

None. `feat/research-stream-sse`, `feat/research-statuses`, and `feat/research-doc-typography` all merged and their local branches deleted.

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
