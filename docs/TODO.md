# TODO

Code-level improvements, fixes, and bugs. Managed via `/todo`.

## Telemetry

- [ ] [low] [redundant logic] Consider single-pass aggregation when multiple endpoints are called together (`aggregator.ts`)
- [ ] [medium] [complexity debt] Remove `granularity` param from reducers, API routes, and UI hooks — already removed from aggregator, but `reducers.ts`, `observability.ts`, and frontend still pass it

## API

- [ ] [medium] [redundant logic] `parseDaysPreHandler` loads all entries into memory then filters — add pagination or streaming (`routes/observability.ts`)
- [ ] [low] [redundant logic] `rangeToDays('1h')` returns 1 (same as `'1d'`) — loads full day for 1h request, filters wastefully (`routes/observability.ts:40-41`)

## Database

- [ ] [medium] [redundant logic] Add composite index on `historyLogs(eventType, createdAt)` for date-range queries (`goals/src/schema.ts`)
- [ ] [medium] [redundant logic] Add index on `todos(done, updatedAt)` for completed items query (`goals/src/schema.ts`)
- [ ] [low] [redundant logic] Add index on `goals(createdAt)` for date-range queries (`goals/src/schema.ts`)
- [ ] [low] [redundant logic] `getSummary()` loads all matching rows with `.all()` and no LIMIT (`goals/src/services/summary.ts`)

## UI

- [ ] [medium] [misnamed identifiers] `ringColor` in `ColorDots.tsx:42` is not a CSS property — selected ring color is a no-op
- [ ] [medium] [redundant logic] `CategoryManager.tsx:72-74` color update only invalidates one goal's cache, not all goals using that category
- [ ] [medium] [redundant logic] `errorsOnly` filter is client-side while pagination is server-side — count/display mismatch (`EventsPage.tsx:228`)
- [ ] [low] [misnamed identifiers] `SessionTracePage.tsx:48` and `TurnTracePage.tsx:144` use `useState` for a value that never changes — should be const
- [ ] [low] [redundant logic] `SummaryPage.tsx` parent and child both call `useSummary` with same args — pass data as prop instead
- [ ] [low] [redundant logic] `modelColumns` defined inside render path, re-created every render — lift to module scope (`TokensCostPage.tsx:36`)
- [ ] [low] [redundant logic] `accentColors` map re-created every render inside `StatCard` — lift to module scope (`StatCard.tsx:27`)
- [ ] [low] [redundant logic] `ChartContainer.tsx:9` `fill={active ? 'currentColor' : 'currentColor'}` — both branches identical
- [ ] [low] [redundant logic] `MemoryPage.tsx:292,300` type/tag selects bypass the "commit on Search" pattern — inconsistent with text search
- [ ] [low] [duplicate utilities] Pagination controls duplicated above and below table — extract component (`EventsPage.tsx:326-378`)
- [ ] [low] [complexity debt] `hideInactive`/`showUnused` state lifted to `HooksPage` but only used in `ByHookView` — push down
- [ ] [low] [redundant logic] `TurnTracePage.tsx:297` IIFE to render event table — extract component or hoist the `const`
- [ ] [low] [unreferenced functions] Delete `useGoalCategories` hook — never imported (`hooks.ts:95`)
- [ ] [low] [complexity debt] Inline `obsQueryParams` into `obsQuery` — only called from one place (`observability-hooks.ts:13`)
- [ ] [low] [complexity debt] Delete `src/ui/web/src/utils/cn.ts` — `cn()` is just `clsx()` with no `twMerge`; replace 28 imports with direct `clsx`
- [ ] [low] [complexity debt] Remove `useChartType` hook — it's `useState` with a type narrowing, no encapsulated logic (`ChartContainer.tsx:36-39`)
- [ ] [low] [complexity debt] `tooltipStyle()` is a zero-arg function returning a static object — make it a `const` (`chartTheme.ts:11-19`)
- [ ] [low] [misnamed identifiers] `streak` type cast in `HabitsPage.tsx:77` — update `Habit` type instead of inline `as` hack

## Hooks

- [ ] [low] [redundant logic] `parse-transcript.ts:56,70` double truncation — blocks truncated individually then join truncated again

## Consolidation

Duplicated logic across files — extract to shared utilities:

- [ ] [low] [duplicate utilities] Local date formatters in `GoalCard.tsx`, `NoteEditor.tsx`, `HistoryTimeline.tsx` — use existing `utils/format.ts` exports
- [ ] [low] [duplicate utilities] Priority/state option arrays derived identically in `GoalForm.tsx:14` and `GoalFilters.tsx:19` — share
- [ ] [low] [duplicate utilities] Trace-line splitting in `test.ts` (`runHook` + `run` x2) — extract `splitTrace()`

## Cleanup

- [ ] [low] [complexity debt] `ensureDataDirs` in paths module mixes side effects with path resolution — inline at call sites or move

## Docs

_(none)_

## Tests

_(none)_
