# Sketch: provider-call ledger (Tavily / OpenRouter / Jina usage over time)

## Problem

Today we know **per-loop aggregate LLM cost** (`loops.envelope_consumed.cost_usd`,
written via `bumpUsage`) and not much else. There's no way to answer either of
these from inside Construct:

1. **Per-query**: for loop `swift-vale-hill-2f4c`, how many Tavily searches did
   it make, how many OpenRouter completions broken down by step
   (planner / processor / synthesis / iteration_check), and how many tokens?
2. **Per-period**: across the last 7 / 30 days, how many Tavily calls did I
   make total, on which days, and how does that map to my Tavily plan's credit
   ceiling?

Tavily's own dashboard is canonical for the second question, but it can't
answer the first (which loop burned the credits) and roundtripping through a
web UI breaks the dogfood story. We need a local ledger.

The existing `envelope_consumed.cost_usd` is a sum, not a stream — it can't
be sliced by provider, endpoint, time bucket, or step. Adding more fields to
that JSON blob would be the wrong direction; what's missing is a row-per-call
event log alongside the aggregate.

## Change

A new table `provider_calls`, one row per outbound call to a paid (or
rate-limited) external API, plus three thin wrappers at the existing call
sites. The aggregate `envelope_consumed.cost_usd` stays — it remains the
fast path for History row stats; the new ledger is the granular source.

### Table

```sql
CREATE TABLE IF NOT EXISTS provider_calls (
  id              TEXT PRIMARY KEY,
  ts              TEXT NOT NULL DEFAULT (datetime('now')),
  provider        TEXT NOT NULL,   -- 'openrouter' | 'tavily' | 'jina' | 'brave' | 'duckduckgo' | 'readability'
  endpoint        TEXT NOT NULL,   -- 'chat/completions' | 'search' | 'reader' | 'fetch'
  loop_id         TEXT,            -- nullable: out-of-loop calls (manual probes) are fine
  cycle_id        TEXT,            -- nullable
  step            TEXT,            -- 'planner' | 'processor' | 'derivation' | 'renderer'
                                   --   | 'iteration_check' | 'post_mortem' | 'document'
                                   --   | 'detect_shape' | 'detect_question' | 'detect_role'
                                   --   | 'url_grounding'
  model           TEXT,            -- OpenRouter only; null otherwise
  ok              INTEGER NOT NULL,-- 1 success, 0 failure
  status_code     INTEGER,         -- HTTP status; null for non-HTTP
  duration_ms     INTEGER,
  prompt_tokens   INTEGER,         -- OpenRouter only (populated from response.usage)
  completion_tokens INTEGER,       -- OpenRouter only
  cost_usd        REAL,            -- best-known cost: tokens × pricing for OpenRouter,
                                   --   flat per-call for Tavily, NULL for free providers
  metadata        TEXT             -- JSON: { query, url, error_message, retry_attempt, ... }
);
CREATE INDEX IF NOT EXISTS idx_provider_calls_ts       ON provider_calls(ts);
CREATE INDEX IF NOT EXISTS idx_provider_calls_loop     ON provider_calls(loop_id);
CREATE INDEX IF NOT EXISTS idx_provider_calls_provider ON provider_calls(provider, ts);
```

Indexed for the two real queries: `WHERE loop_id = ?` (per-query) and
`WHERE provider = ? AND ts > ?` (per-period).

DDL goes in `src/research/src/ddl.ts` alongside the rest of the loops schema.

### Recording — where calls happen now

| Call site (file:func) | Provider | Wrap point |
|---|---|---|
| `src/research/src/providers/openrouter.ts` `complete` | openrouter | After `fetchWithRetry` resolves; payload already has tokens + cost data |
| `src/research/src/providers/openrouter.ts` `searchWeb` | openrouter (twice: search + completion) | Inside `searchWeb` — the Tavily call goes through `fetchSearchResults`, plus the synthesis LLM call |
| `src/research/src/providers/websearch.ts` `tavilySearch` | tavily | Around the `fetch` |
| `src/research/src/providers/websearch.ts` `fetchPageContent` / `fetchViaJina` | jina | Around the `fetch` |
| `src/research/src/providers/websearch.ts` `braveSearch` | brave | Around the `fetch` (currently dead path; instrument anyway) |
| `src/research/src/providers/websearch.ts` `duckduckgoSearch` | duckduckgo | Around the `fetch` (free; record for visibility) |
| `src/research/src/providers/websearch.ts` `fetchViaReadability` | readability | Around the `fetch` — free, but useful to count URL-grounding hits and Jina-fallback rate |

### Plumbing the loop context to the recorder

Provider modules don't know about `loop_id` / `cycle_id` / `step` today — and
threading those through every call signature would be invasive. Two viable
shapes:

**Option A (recommended): AsyncLocalStorage scope.**
A single `callContext` ALS set at the engine cycle boundary and at each
detector / planner / template-hook invocation. Provider wrappers read the
current value; out-of-context calls land with nullable loop fields.

```ts
// src/research/src/observability/call-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
export interface CallScope { loop_id?: string; cycle_id?: string; step?: string }
export const callContext = new AsyncLocalStorage<CallScope>();
export function withCallScope<T>(scope: CallScope, fn: () => Promise<T>): Promise<T> {
  return callContext.run(scope, fn);
}
```

Engine wires it in `runCycle` and around each step's `runOnce`:

```ts
// engine.ts (sketch)
await withCallScope({ loop_id, cycle_id: cycle.id, step: 'processor' }, () =>
  runOnce(sqlite, {...}, () => template.processor(state)));
```

`ensureScheduleArtifact` wraps the three detectors and the planner the
same way (steps `detect_shape`, `detect_question`, `detect_role`,
`planner`, `url_grounding`).

**Option B: pass an explicit `tracer` arg through every LLMProvider /
search call.** Cleaner contract but ~12 call-site changes vs. Option A's 4-6.

Option A wins on blast radius and matches the existing `withCostTracker`
pattern (which already does something similar at a coarser level).

### Recording helper

```ts
// src/research/src/observability/provider-calls.ts
export interface ProviderCallRecord {
  provider: 'openrouter' | 'tavily' | 'jina' | 'brave' | 'duckduckgo' | 'readability';
  endpoint: string;
  model?: string;
  ok: boolean;
  status_code?: number;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cost_usd?: number;
  metadata?: Record<string, unknown>;
}

export function recordProviderCall(sqlite: Sqlite, rec: ProviderCallRecord): void {
  const scope = callContext.getStore() ?? {};
  sqlite.prepare(`
    INSERT INTO provider_calls (
      id, provider, endpoint, loop_id, cycle_id, step,
      model, ok, status_code, duration_ms,
      prompt_tokens, completion_tokens, cost_usd, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), rec.provider, rec.endpoint,
    scope.loop_id ?? null, scope.cycle_id ?? null, scope.step ?? null,
    rec.model ?? null, rec.ok ? 1 : 0, rec.status_code ?? null, rec.duration_ms,
    rec.prompt_tokens ?? null, rec.completion_tokens ?? null, rec.cost_usd ?? null,
    rec.metadata ? JSON.stringify(rec.metadata) : null,
  );
}
```

Provider wrappers call this in a `finally` so failures get recorded too —
the failure rate per provider is itself useful telemetry (e.g. "how often
is OpenRouter rate-limiting me?").

Pricing for Tavily is a flat `~$0.005-0.01` per `search_depth: 'basic'`
call depending on plan; encode as a const in `tavilySearch` so cost_usd is
populated even though Tavily doesn't return it.

### Read APIs

```ts
// src/research/src/observability/provider-calls.ts
export function listForLoop(sqlite: Sqlite, loop_id: LoopId): ProviderCallRow[];

export function summarize(sqlite: Sqlite, opts: {
  from?: string;                      // ISO timestamp
  to?: string;
  provider?: string;
  groupBy: 'hour' | 'day' | 'week' | 'provider' | 'loop' | 'step';
}): Array<{ bucket: string; calls: number; tokens: number; cost_usd: number; failures: number }>;
```

Two HTTP endpoints sit on top:

| Endpoint | Use |
|---|---|
| `GET /api/loops/:id/provider-calls` | The "Cost & Calls" panel on the Activity tab |
| `GET /api/providers/usage?from=&to=&groupBy=day&provider=tavily` | The period view on `/research/providers` |

### UI surfaces

**Per-loop (Activity tab).**
Add a "Cost & Calls" block at the top of `ActivityTab` in
`ResearchLoopDetail.tsx`, between the existing KPI strip and the cycle-state
list. Compact table:

```
PROVIDER       CALLS  TOKENS    COST
openrouter        18  46.2 k    $0.0042
  planner          1   2.1 k    $0.0002
  processor        6  18.4 k    $0.0021
  synthesis        6  17.8 k    $0.0019
  detectors        3   2.4 k    $0.0002
  iteration_check  2   5.5 k    $0.0003
tavily             6     —      $0.0300
jina               4     —      $0.0040
readability        9     —       free
─────────────────────────────────────
TOTAL             37  46.2 k    $0.0382
```

Step breakdown is collapsible — default is provider rollup, click expands.

**Per-period (`/research/providers`).**
This page already exists for provider config (keys). Add a "Usage" section
above the keys with:

- Time-range selector (24h / 7d / 30d / custom)
- Stacked bar chart: one bar per day, stacked by provider, height = calls.
  A second toggle flips to cost-stacked or token-stacked.
- Below the chart, a per-provider table: `provider · calls · tokens · cost ·
  failures · last call`.
- Link from each row of the per-provider table to a drill-down: filtered
  list of loops that contributed, sorted by call count.

No new page. Reuses `src/ui/web/src/lib/charts` (existing Recharts wrappers
in the observability views) and the existing time-range component
(`HistoryFilterRail.tsx` has one).

### Tokens question

You flagged tokens as "may not be possible." Reality is split:

- **OpenRouter** returns `usage.prompt_tokens` / `usage.completion_tokens` on
  every response. `openrouter.ts:59-60` already reads them. Storing them in
  `provider_calls` is free.
- **Tavily** is a search API — no token concept. Column stays `NULL`.
- **Jina** Reader returns text, not tokens. `NULL`.
- **Brave / DuckDuckGo / readability** — search/fetch APIs, no tokens. `NULL`.

So tokens **are** trackable, but only for OpenRouter. That's still the
expensive provider; the column does what you want for the LLM side.

## What this enables (downstream, not part of v1)

- **Mode-preset cost tuning.** Once we have real cost-per-loop broken down by
  step, the `MODE_PROFILES` envelope numbers in `modes.ts` can be calibrated
  against actuals instead of "calibrated against the existing
  `cycles_target=3` baseline; expect them to be tuned" (which is the current
  comment).
- **Pre-flight cost estimate.** Compose box could show "default mode typically
  costs $X based on your last 20 runs."
- **Alerting.** A simple "today's Tavily calls > 80% of monthly ceiling" check
  becomes a one-line query.
- **Re-pricing on model changes.** If pricing tables in `openrouter.ts`
  drift, you can backfill `cost_usd` from `prompt_tokens` + `completion_tokens`
  retroactively.

## Open questions

- **Retention.** Do we keep every row forever, or roll up rows older than N
  days into daily summaries? Production DB will accumulate ~50-200 rows per
  loop; at 100 loops/month that's a manageable ~20k rows/year. Probably fine
  to keep raw indefinitely; revisit if the table crosses ~1M rows.
- **Backfill.** Existing loops have `envelope_consumed.cost_usd` but no
  per-call history. Punt — the ledger starts from migration time. Old loops
  show their aggregate cost but their per-loop panel says "no detailed records
  for this run."
- **Multi-loop concurrency.** AsyncLocalStorage is per-async-context, so
  parallel subprocess loops (each in its own `run.ts`) each have their own
  ALS — no cross-contamination. Worth a one-line test to confirm.
- **OpenRouter's internal `searchWeb`.** Each call hits two providers (Tavily
  for results + OpenRouter for synthesis). Sketch records both rows;
  metadata.parent_call_id can link them if drill-down ever needs that, but
  v1 just records them as two separate rows with the same `(loop_id, cycle_id,
  step)`.
- **Pricing for non-LLM providers.** Tavily and Jina have per-call pricing
  (flat-ish); Brave varies; DDG and readability are free. Hardcode known
  rates in a small `provider-pricing.ts` const map. If a plan changes, edit
  the const — that's accurate enough for self-tracking; if anyone ever needs
  finance-grade precision, plug in real billing APIs later.

## Path forward

1. **Schema + helper.** Land `provider_calls` table + `recordProviderCall` +
   `callContext` ALS. No call-site changes yet. Pure additive.
2. **OpenRouter wiring.** Wrap `complete` + `searchWeb` in
   `openrouter.ts` to record. Add `callContext.run(...)` calls around the
   four detector+planner branches in `ensureScheduleArtifact` and the engine's
   `processor` / `derivation` / `renderer` step dispatchers. After this step,
   per-loop "Cost & Calls" block on the Activity tab can ship.
3. **Tavily + Jina wiring.** Add the wrappers in `websearch.ts`. Backfill the
   per-provider table on the loop-detail panel.
4. **Period view.** New `summarize(...)` query, new `/api/providers/usage`
   endpoint, "Usage" section on `/research/providers`.
5. **Pricing const.** Add `provider-pricing.ts` for non-LLM providers; ensure
   cost_usd is populated for Tavily/Jina rows.

Each step is independently mergeable and reversible. Steps 1-3 close the
"per-query" question; step 4 closes "per-period."
