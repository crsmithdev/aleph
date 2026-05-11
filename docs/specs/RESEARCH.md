# Construct — Research Specification

Behavior-oriented spec for the autonomous research system. Every claim here is testable.

See [SPEC.md](SPEC.md) for the application lifecycle. See [TELEMETRY.md](TELEMETRY.md) for observability.

## Purpose

The research module runs persistent, multi-threaded web research sessions. A user seeds a topic or question; the engine spawns sub-questions, searches the web, scores findings for novelty and confidence, detects gaps, and adapts its strategy using perturbation until the topic is covered or a budget is hit.

## Architecture Overview

```
User creates session with seed_query
        │
        ▼
Worker (research/src/worker.ts)
  ├── Claims a pending job from research_jobs
  ├── Runs research engine iterations
  │     ├── Select highest-priority queued thread
  │     ├── Call LLM provider (web search)
  │     ├── Score finding (confidence, novelty, actionability)
  │     ├── Detect follow-up questions
  │     ├── Spawn new threads for follow-ups
  │     ├── Run gap analysis (if enabled)
  │     └── Apply perturbation strategy (if needed)
  └── Updates job heartbeat / marks complete

API server (WorkerSupervisor)
  ├── Spawns N worker processes (default 3)
  ├── Monitors heartbeats, restarts on crash
  └── Exposes /api/research/* routes
```

## Data Model

### `research_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `title` | TEXT | Defaults to `seed_query` if not provided |
| `seed_query` | TEXT | The initial topic or question |
| `status` | TEXT | `active` \| `paused` \| `completed` \| `archived` |
| `config` | TEXT | JSON `SessionConfig` |
| `summary` | TEXT | Auto-generated or user-written summary |
| `user_notes` | TEXT | Free-form user annotations |
| `created_at`, `updated_at` | TEXT | ISO datetime |

### `research_threads`

Each thread is a single search question within a session.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `session_id` | TEXT FK | Cascade delete |
| `parent_thread_id` | TEXT FK | null for seed thread |
| `spawned_from_finding_id` | TEXT | Finding that triggered this thread |
| `query` | TEXT | The search question |
| `node_type` | TEXT | `question` \| `topic` (classified by `classify()`) |
| `origin` | TEXT | `seed` \| `follow_up` \| `gap` \| `perturbation` \| `user_injected` |
| `perturbation_strategy` | TEXT | Strategy name if `origin = perturbation` |
| `status` | TEXT | `queued` \| `active` \| `exhausted` |
| `priority` | REAL | 0–1. Seed thread starts at 1.0, follow-ups at 0.5–0.9 |
| `depth` | INT | Distance from seed thread |
| `max_depth` | INT | Defaults to `session.config.max_thread_depth` |

### `research_findings`

A scored research result from a single LLM + web search step.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `thread_id`, `session_id` | TEXT FK | Cascade delete |
| `content` | TEXT | Full finding content |
| `summary` | TEXT | Short summary |
| `source_urls` | TEXT | JSON array of cited URLs |
| `source_quality` | REAL | 0–1, estimated from search result quality |
| `tags` | TEXT | JSON array of topic tags |
| `confidence` | REAL | 0–1, how reliable the information appears |
| `novelty` | REAL | 0–1, how new this is relative to prior findings |
| `actionability` | REAL | 0–1, how useful this is |
| `user_rating` | TEXT | `thumbs_up` \| `thumbs_down` \| null |
| `follow_ups` | TEXT | JSON array of candidate follow-up queries |
| `follow_up_analysis` | TEXT | JSON `FollowUpAnalysis` object |

### `research_steps`

One LLM + web search call. Multiple steps may belong to one thread.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `thread_id`, `session_id` | TEXT FK | |
| `finding_id` | TEXT FK | If this step produced a finding |
| `model` | TEXT | Model used |
| `provider` | TEXT | `anthropic` \| `openrouter` \| `ollama` |
| `prompt_tokens`, `completion_tokens` | INT | |
| `cost_usd` | REAL | Calculated from model pricing |
| `tool_calls` | TEXT | JSON array |
| `duration_ms` | INT | |
| `error` | TEXT | Error message if step failed |

### `research_plans`

Gap analysis output: a ranked list of research priorities.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `session_id` | TEXT FK | |
| `items` | TEXT | JSON `ResearchPlanItem[]` — ranked list of open questions |
| `status` | TEXT | `proposed` |

### `research_plan_modifications`

User or system changes to a plan.

| Column | Type | Notes |
|---|---|---|
| `action` | TEXT | `prioritize` \| `deprioritize` \| `remove` \| `add` |
| `target_item_rank` | INT | |
| `target_thread_id` | TEXT | |
| `source` | TEXT | `ui` \| `cli` |

### `research_jobs`

A single run request. Tracks execution state.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `session_id` | TEXT FK | |
| `status` | TEXT | `pending` \| `claimed` \| `running` \| `completed` \| `failed` \| `cancelled` |
| `mode` | TEXT | `burst` \| `background` \| `scheduled` |
| `max_iterations` | INT | Only used for `burst` mode; null = unlimited |
| `iterations_completed` | INT | |
| `heartbeat_at` | TEXT | Updated every iteration by the worker |

### `research_monitors`

Recurring monitoring tasks that run on a cron schedule.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `session_id` | TEXT FK | Optional link to research session |
| `title` | TEXT | |
| `status` | TEXT | `active` \| `paused` |
| `queries` | TEXT | JSON array of search queries |
| `schedule` | TEXT | Cron expression, default `0 8 * * *` |
| `timezone` | TEXT | Default `America/Los_Angeles` |
| `match_criteria` | TEXT | JSON filter for what counts as a new signal |
| `model` | TEXT | Default `claude-haiku-4-5` |
| `budget_daily_usd` | REAL | Optional spend limit |

### `research_monitor_snapshots`

One snapshot per monitor cycle.

| Column | Type | Notes |
|---|---|---|
| `cycle_number` | INT | Monotonically increasing |
| `raw_results` | TEXT | JSON search results |
| `result_hash` | TEXT | SHA of results, used for change detection |
| `item_count` | INT | |
| `cost_usd` | REAL | |

### `research_monitor_alerts`

Triggered when a monitor detects a change worth surfacing.

| Status values | `new` \| `acknowledged` \| `dismissed` |

## Engine Workflow

### Session Creation

`POST /api/research/sessions` with `{ seed_query, title?, config? }`:
1. Creates a `research_sessions` row with merged `DEFAULT_SESSION_CONFIG + config`.
2. Creates the seed thread: `{ query: seed_query, origin: 'seed', priority: 1.0, depth: 0 }`.
3. Returns the session object.

### Job Lifecycle

`POST /api/research/sessions/:id/run` with `{ mode?, iterations? }`:
1. Validates session exists and has no active job.
2. Creates a `research_jobs` row with `status: 'pending'`.
3. Returns `{ status: 'queued', job_id }`.

A worker picks up the job, sets `status: 'claimed'`, then `status: 'running'`, and runs iterations until:
- `max_iterations` reached (burst mode)
- Job is cancelled externally
- All threads are exhausted

On completion: sets `status: 'completed'`.

### Iteration Loop

Each iteration:

1. **Select thread** — picks the highest-priority `queued` thread for the session. Priority is a float 0–1; seed thread starts at 1.0, follow-ups at 0.5–0.9 depending on relevance score.
2. **Check scheduling** — if the session's `schedule.mode` is `scheduled` or `background`, checks `isInActiveWindow()`. If outside a window, sleeps until the next window or skips.
3. **Mark thread active** — sets thread `status: 'active'`.
4. **LLM web search call** — calls `provider.searchWeb(model, thread.query)`. The provider fetches URLs and passes source text to the LLM for synthesis.
5. **Score finding** — LLM call to score the result for confidence, novelty, actionability (0–1 each). Tags are extracted from content.
6. **Write finding** — stores `research_findings` row.
7. **Write step** — stores `research_steps` row with token counts and cost.
8. **Coverage check** — `isCovered(threadFindings)`: a thread is covered when it has ≥3 findings AND average confidence >0.65 AND average novelty <0.3. If covered, status → `exhausted`.
9. **Follow-up generation** — LLM call produces `FollowUpAnalysis`: ranked list of candidate follow-up questions with similarity scores. Questions exceeding `dedup_similarity_threshold` (default 0.85) against existing thread queries are dropped. Surviving candidates ≥ `follow_up.min_count` are spawned as child threads.
10. **Gap analysis** (if `gap_analysis.enabled = true`) — periodically calls LLM to identify unexplored areas in the accumulated findings. Spawns gap threads with `origin: 'gap'`. Maximum `gap_analysis.max_gap_searches` gap threads total.
11. **Perturbation** (if coverage is high and novelty is low) — applies a perturbation strategy (see below) to spawn a divergent thread with `origin: 'perturbation'`.
12. **Rate limiting** — respects `min_delay_between_steps_ms` and `max_steps_per_hour`.
13. **Budget check** — compares accumulated `cost_usd` against `budget_daily_usd` and `budget_total_usd`. Stops if exceeded.

### Coverage and Exhaustion

A thread is exhausted (`status: 'exhausted'`) when:
- `isCovered()` returns true: ≥3 findings, avg confidence >0.65, avg novelty <0.3
- OR it has reached `max_thread_depth`
- OR it has hit `min_searches_per_thread` with no new findings

A session completes when all threads are exhausted and no new ones are being spawned.

### Thread Deduplication

Before spawning a new thread, the engine computes Jaccard similarity between the candidate query and all existing thread queries. If similarity ≥ `dedup_similarity_threshold` (default 0.85) against any existing thread, the candidate is dropped.

## Perturbation Strategies

When a thread cluster has high coverage but low novelty — or when the session hits a `forced_diversity_threshold` of consecutive steps without novel findings — a perturbation strategy is selected to escape the current search attractor.

| Strategy | Approach |
|---|---|
| `analogical` | Reframes the query as an analogy from a different domain |
| `contrarian` | Searches for evidence against the dominant view |
| `failure_post_mortem` | Asks what went wrong with past attempts at this topic |
| `temporal_shift` | Shifts to historical context or future projections |

Configuration (`perturbation` in `SessionConfig`):
- `strategy_weights` — relative probability of each strategy being selected
- `strategy_cooldown` — minimum iterations before reusing the same strategy
- `chain_length` — how many perturbation threads to spawn in one go
- `forced_diversity_threshold` — consecutive low-novelty steps before forcing perturbation
- `depth_scaling` — weight strategies differently based on thread depth

The full strategy list in `session.config.perturbation.strategy_weights` also includes: `persona_injection`, `negation`, `geographic`, `scale_shift`, `economics`, `citation_chain`, `social_graph`, `adjacent_community`, `supply_chain`.

## Providers

### Anthropic Provider

Uses the Anthropic SDK with the `web_search_20250305` tool (max 5 uses per call). The tool natively fetches and synthesizes web content. Source URLs and text are extracted from `web_search_tool_result` blocks. Retries up to 3 times on 429/529 (exponential backoff: 10s, 20s).

### OpenRouter Provider

Routes to any model available on OpenRouter (default: `deepseek/deepseek-chat`). For web search:
1. Calls Tavily → Brave → DuckDuckGo to get result URLs.
2. Fetches page content via Jina Reader (`r.jina.ai/<url>`) for each URL.
3. Synthesizes with the configured LLM.

Model rotation: cycles through `config.providers.openrouter_models` across calls.

### Ollama Provider

Calls a local Ollama instance (`OLLAMA_BASE_URL`, default `http://localhost:11435`). Web search uses the same Jina/search pipeline as OpenRouter. Used for `p_serendipity` serendipitous exploration steps when a local model is configured.

### Provider Selection

Configured per-session via `config.providers`:
- `primary`: main provider for all steps
- `fallback`: used if primary fails
- If `OPENROUTER_API_KEY` is set and no explicit primary is chosen, defaults to `openrouter`

## Scheduling

Sessions can run in four modes:

| Mode | Behavior |
|---|---|
| `interactive` | Runs immediately, no window checks |
| `burst` | Runs a fixed number of iterations (`max_iterations`), then stops |
| `background` | Runs continuously but only during configured `active_windows` |
| `scheduled` | Like background but started by an external scheduler |

**Active windows** are defined as `{ days: ['mon','tue',...], start: 'HH:MM', end: 'HH:MM' }` in the session config. Overnight windows (end < start) are supported. An empty `active_windows` array means always active.

The scheduler uses `Intl.DateTimeFormat` in the session's configured timezone to evaluate windows.

## Worker Supervisor

The API server runs `N` worker processes (default `WORKER_COUNT=3`) via `WorkerSupervisor`.

- Workers are spawned as child processes running `research/src/worker.ts`.
- If a worker exits with any code, it is restarted with exponential backoff starting at 1s, capping at 60s.
- After `MAX_RESTARTS = 20` restarts, a worker is marked `stopped` permanently.
- On API shutdown, all workers receive SIGTERM. If they don't exit within 30s, they receive SIGKILL.
- Worker status (pid, restarts, uptime, status) is exposed at `GET /api/research/workers`.

## API Endpoints

All routes are under `/api/research/`.

### Sessions

| Method | Path | Description |
|---|---|---|
| GET | `/sessions` | List sessions; `?status=active\|paused\|completed\|archived` |
| POST | `/sessions` | Create session; body: `{ seed_query, title?, config? }` |
| GET | `/sessions/:id` | Get session |
| PATCH | `/sessions/:id` | Update session fields (title, status, summary, user_notes, config) |
| DELETE | `/sessions/:id` | Delete session and all related data (cascade) |

### Threads

| Method | Path | Description |
|---|---|---|
| GET | `/sessions/:id/threads` | List threads; `?status=queued\|active\|exhausted` |
| POST | `/sessions/:id/threads` | Inject a thread; body: `{ query, priority?, max_depth? }`; origin: `user_injected` |
| PATCH | `/threads/:id` | Update thread fields |

### Findings

| Method | Path | Description |
|---|---|---|
| GET | `/sessions/:id/findings` | List findings; `?thread_id`, `?limit`, `?sort=created_at\|novelty\|confidence` |
| GET | `/findings/:id` | Get finding |
| PATCH | `/findings/:id` | Update finding; body: `{ user_rating: 'thumbs_up'\|'thumbs_down' }` |

### Steps

| Method | Path | Description |
|---|---|---|
| GET | `/sessions/:id/steps` | List steps; `?thread_id`, `?limit` |

### Plan

| Method | Path | Description |
|---|---|---|
| GET | `/sessions/:id/plan` | Get latest plan (404 if none) |
| POST | `/sessions/:id/plan/modify` | Add modification; body: `{ action, target_item_rank?, target_thread_id?, payload? }` |

### Costs

| Method | Path | Description |
|---|---|---|
| GET | `/sessions/:id/costs` | Aggregated cost: `{ total_cost_usd, step_count, avg_cost_per_step, by_model[] }` |

### Jobs and Run Control

| Method | Path | Description |
|---|---|---|
| POST | `/sessions/:id/run` | Start a job; body: `{ mode?: 'burst'\|'background'\|'scheduled', iterations?: number }` |
| GET | `/sessions/:id/running` | Check if an active job exists; returns `{ running, job }` |
| GET | `/sessions/:id/jobs` | List all jobs for session |
| GET | `/jobs/:id` | Get job by ID |
| POST | `/jobs/:id/cancel` | Cancel a running job |
| GET | `/sessions/:id/activity` | Live snapshot: running state, active thread, queued/exhausted counts, last 5 steps |
| POST | `/run-all` | Start background jobs for all active sessions with no current job |
| POST | `/stop-all` | Cancel all running jobs |
| GET | `/workers` | Worker supervisor status: array of `{ id, pid, status, restarts, uptimeMs }` |

### SSE Stream

`GET /sessions/:id/stream` — Server-Sent Events for live session updates.

Connection: `Content-Type: text/event-stream`. Heartbeat comment every 15s to keep connection alive.

Each event is `data: <JSON>\n\n` with shape `{ type, payload }`.

| Event type | Payload | Fired when |
|---|---|---|
| `finding` | `ResearchFinding` | New finding created (deduplicated by ID) |
| `thread` | `ResearchThread` | Thread state changes (deduplicated by `status:updated_at`) |
| `step` | `ResearchStep` | New step created (deduplicated by ID) |
| `job` | `ResearchJob` | Job state changes (deduplicated by `status:updated_at`) |

Poll interval: 500ms server-side.

### Monitors

| Method | Path | Description |
|---|---|---|
| GET | `/monitors` | List monitors; `?status=active\|paused` |
| POST | `/monitors` | Create monitor; body: `{ title, queries, session_id?, schedule?, match_criteria? }` |
| GET | `/monitors/:id` | Get monitor |
| PATCH | `/monitors/:id` | Update monitor fields |
| GET | `/monitors/:id/snapshots` | List snapshots for monitor |
| GET | `/monitors/:id/alerts` | List alerts; `?severity`, `?status` |
| PATCH | `/alerts/:id` | Update alert status; body: `{ status: 'acknowledged'\|'dismissed' }` |
| POST | `/monitors/:id/run` | Run one monitor cycle immediately; body: `{ api_key? }` |

### Stats and Dev

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | Aggregate stats across all sessions; `?range=30d`, `?granularity=day` |
| DELETE | `/reset` | Dev only — truncates all research tables |

## Session Configuration Reference

`DEFAULT_SESSION_CONFIG` (overridable per session):

| Key | Default | Description |
|---|---|---|
| `budget_daily_usd` | 5.0 | Max spend per calendar day |
| `budget_total_usd` | null | Max total spend (null = unlimited) |
| `budget_alert_threshold` | 0.80 | Warn at 80% of budget |
| `max_thread_depth` | 8 | Maximum follow-up depth from seed |
| `p_serendipity` | 0.15 | Probability of a serendipitous Ollama step |
| `max_perturbation_probability` | 0.40 | Cap on perturbation selection chance |
| `novelty_threshold` | 0.3 | Below this novelty, a thread is considered covered |
| `dedup_similarity_threshold` | 0.85 | Jaccard similarity above which a candidate thread is dropped |
| `diminishing_returns_threshold` | 0.25 | Avg novelty below which to trigger diversity |
| `diminishing_returns_window` | 20 | Steps to average over for diminishing returns check |
| `min_delay_between_steps_ms` | 2000 | Rate limiting between LLM calls |
| `max_steps_per_hour` | 60 | Hard rate cap |
| `max_concurrent_threads` | 3 | Parallel thread execution limit (per worker) |
| `model` | `deepseek/deepseek-chat` | Default LLM for all steps |
| `providers.primary` | `openrouter` | Primary provider |
| `schedule.mode` | `interactive` | Scheduling mode |
| `schedule.timezone` | `America/Los_Angeles` | For active window evaluation |
| `follow_up.min_count` | 2 | Minimum follow-ups to spawn per finding |
| `follow_up.max_retries` | 3 | Retry attempts for follow-up generation |
| `follow_up.similarity_threshold` | 0.75 | For ranking follow-up candidates |
| `min_searches_per_thread` | 2 | Minimum steps before marking exhausted |
| `fetch_source_text` | false | Whether to fetch full page text (Jina) |
| `gap_analysis.enabled` | true | Whether to run gap analysis |
| `gap_analysis.max_gap_searches` | 2 | Maximum gap threads to spawn |

## UI Pages

### Research Landing (`/research`)

Hero compose box with inferred-metadata panel. The compose box submits the prompt as soon as the user hits "Start research"; the new query is created server-side and shape/topic detection runs fire-and-forget. The inferred panel below the textarea then populates four rows — Shape, Lenses, Topic, Run plan — each with an inline edit affordance. Below the compose box: 30-day KPI strip (runs, findings, spend, active), running runs, just-finished runs.

### Research History (`/research/history`)

Rich archive of past runs with summary strip, filter rail (status · verdict · cost band · started window · search), and ledger table sorted by started/cost/findings/duration/verdict. The legacy `/research/queries` URL permanently redirects to `/research/history`.

### Research Session Detail (`/research/:id`)

Multi-tab interface for a single session.

**Tabs:**

| Tab | Content |
|---|---|
| Document | Findings list sorted by recency or novelty/confidence, each with source URLs, quality scores, tags, thumbs up/down rating |
| Graph | Three-pane view (tree · canvas · inspector) merging the prior Knowledge and Process tabs. Canvas hosts the force-directed concept and thread graphs (Cytoscape + fcose); inspector reflects current selection. Below 1600px the inspector pane collapses |
| Sources | Source registry table with extraction status counts and per-source detail |
| Activity | Merged events + telemetry + reviews dashboard (merged from the prior Events / Telemetry / Reviews tabs). Live event feed on the right; lifecycle, thread state, source health panels on the left; latest verdict surfaced at top |
| Config | Editable session config — model, provider, schedule, budget, perturbation weights |

**Controls:**
- Run (priority: 5 iterations) / Run All / Stop All buttons
- Session status toggle (active/paused/completed)
- "Inject Thread" — adds a user-specified query as a new thread
- Thread filtering in graph view by status

**Live updates:** The SSE stream (`/api/research/sessions/:id/stream`) drives real-time updates in the Document and Activity tabs without polling.

**Cost display:** Per-session cost summary from `/api/research/sessions/:id/costs`.

## Module Detection

| Module | Detection file |
|---|---|
| construct-research | `construct/research/src/engine.ts` |

## Common Questions

**Q: How do I start a research session programmatically?**
`POST /api/research/sessions` with `{ seed_query, title?, config? }` to create it, then `POST /api/research/sessions/:id/run` with `{ mode: 'burst', iterations: 5 }` to start workers on it. Workers must be running (started automatically by the UI, or via `systemctl --user start construct-research-worker`).

**Q: Why is a thread not being picked up by workers?**
Check in order: (1) thread `status` must be `queued`, (2) no existing `claimed`/`running` job for the session — check `GET /api/research/sessions/:id/running`, (3) `OPENROUTER_API_KEY` is set in the worker's environment, (4) daily budget not exceeded — check `GET /api/research/sessions/:id/costs`.

**Q: How do I inject a question into a running session?**
`POST /api/research/sessions/:id/threads` with `{ query, priority?, max_depth? }`. The thread gets `origin: 'user_injected'` and is picked up on the next iteration. Set `priority: 1.0` to have it picked up before other queued threads.

**Q: What's the difference between burst, background, and scheduled modes?**
`burst` runs exactly `max_iterations` iterations then stops — good for on-demand runs. `background` runs continuously but only during `active_windows` time slots (configured in session config) — good for overnight research. `scheduled` is like background but intended to be triggered by an external scheduler (e.g. cron). `interactive` runs immediately with no window checks.

**Q: How do I stop all research without losing any findings?**
`POST /api/research/stop-all` cancels all running jobs but preserves every session, thread, finding, and step. Workers exit gracefully (SIGTERM, 30s window). Resume with `POST /api/research/run-all`.

**Q: When does a thread get marked exhausted?**
A thread is exhausted when any of: (1) `isCovered()` returns true — ≥3 findings, avg confidence >0.65, avg novelty <0.3; (2) it has reached `max_thread_depth`; (3) it has completed `min_searches_per_thread` steps with no new findings. A session completes when all threads are exhausted and no new threads are spawning.

**Q: How does deduplication prevent redundant threads?**
Before spawning any new thread (follow-up, gap, or perturbation), the engine computes Jaccard similarity between the candidate query and all existing thread queries. Candidates with similarity ≥ `dedup_similarity_threshold` (default 0.85) against any existing thread are dropped silently.
