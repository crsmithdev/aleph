# Research UI — mockup punch list

Tracks what's landed, deferred, and next for the research UI, against the mockups in this directory (`queries.html`, `events.html`, `query-detail.html`, `common.css`).

Last updated: 2026-04-17 by Claude.

---

## Landed on `main`

### Workers page (`ResearchWorkersPage.tsx`)
Commit: `b28c037` (merged in `e977089`).

- **Throughput strip** (new top row, 4 cards): Active Queries · Findings Today · Spend Today · 7d Cost. Derived from `/research/stats?range=7d&granularity=day`, no new backend.
- **In Flight table** (merged running + queued). Sorted running-first by status rank. Adds Worker + Elapsed columns. Cancel × works for both running and pending.
- **Fix:** completed history no longer includes running/claimed jobs.
- Page name still "Workers"; revisit when a cross-session event feed lands.

### Queries page (`ResearchQueriesPage.tsx`)
Commit: `afcac07` (merged in `9e2528a`).

- **Header subtitle** now shows `N queries · K active · $X spent · 7d` (conditional segments).
- **Chip filters** show per-bucket counts inline (`All 14`, `Active 3`, etc.).

### Other recent landings (pre-this-branch)
- Config tab layout fixes, MapView off on Process tab, SourcesView useMemo hoist, new-query form populates from server defaults, tighter thread/depth default caps, research-redesign mockup removed.

---

## Deferred — needs new backend aggregates

These are the drivers for the upcoming "research aggregates" endpoint work.

### For queries page (`queries.html`)
- **Per-row count triple** (findings · concepts · sources) in the queries table — needs per-session aggregates.
- **7-day activity sparkline** per query — needs per-session `findings_by_day[]`.
- **Exhausted / Halted statuses** — schema change to `ResearchQuery.status`; not just UI.
- **Summary cards footer** (3 cards in mockup):
  - Top concepts this month (cross-session) — needs concept aggregation.
  - Extraction queue counts (running / pending / failed) — needs cross-session sources aggregate.
  - Spend last 7 days with sparkline — partially doable today (we have the number + `byDay`), but looks half-built as a lone card.

### For workers page (future "Activity" rename)
- **Mini metrics**: Steps/hr, Extraction backlog — need cross-session steps + sources aggregates.
- **Right-rail live event feed** cross-session — SSE stream is per-session only today (`/research/queries/:id/stream`). Needs a new multiplexed `/research/stream` endpoint.
- **Right-rail extraction queue panel**, **recent concepts chips** — same cross-session aggregates as above.

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

## Next — backend aggregates (design in progress)

Goal: unlock the deferred UI items with two additive endpoints. Neither breaks existing callers.

### 1. Enrich `GET /research/queries`

Return each query with joined stats. Keep current fields, append:

```ts
interface ResearchQuery {
  // ... existing fields ...
  stats: {
    findings: number;
    concepts: number;
    sources: number;
    threads: number;
    cost: number;
    last_step_at: string | null;   // for "Last step · 3m ago"
    findings_by_day: number[];     // length 7, oldest → newest (for sparkline)
  };
}
```

Implementation: SQLite aggregate joins on `findings`, `concepts`, `sources`, `threads`, `steps`, grouped by `session_id`. One query, returned alongside the list.

Risk: perf on large N. Mitigate by making the aggregate query indexed on `session_id`. Fine for expected scale (dozens to low hundreds of queries).

### 2. New `GET /research/summary`

Cross-session roll-up. Returns:

```ts
interface ResearchSummary {
  topConcepts: Array<{
    name: string;
    session_count: number;    // how many sessions it appears in
    finding_count: number;    // total findings linking to it
  }>;                         // top 10 by finding_count, last 30 days
  extractionQueue: {
    running: number;
    pending: number;
    failed: number;
    total: number;
  };
  stepsPerHour: number;       // count of steps in last 60 minutes
  recentConcepts: Array<{     // last 10 newly-discovered concepts
    name: string;
    session_id: string;
    session_title: string;
    created_at: string;
  }>;
}
```

### 3. (Later) Cross-session SSE stream

`GET /research/stream` — fanout of all per-session streams. Only needed when we actually add the live-event rail to the workers page. Defer until the first two endpoints ship and we decide to build the event rail.

---

## Open branches / in-flight

None. `main` is up to date. Two remote branches remain (not deleted per CLAUDE.md rule):
- `feat/research-extraction` — merged, can be deleted by user.
- `feat/queries-page-metadata` — merged, can be deleted by user.

---

## Working rules for this stream of work

- "Use what's there already" — prefer existing hooks/endpoints over new ones.
- Things needing new backend data → log in "Deferred" above; do not half-build.
- One small branch per UI-only change; land each before starting the next.
- Verify with `bun test.ts` + `bun run build` in `src/ui/web` + a headless Playwright smoke check before committing.
- Never delete remote branches without explicit permission.
