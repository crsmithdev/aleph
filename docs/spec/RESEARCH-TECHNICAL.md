# Construct — Research Technical Reference

Technical companion to [RESEARCH.md](RESEARCH.md). Covers exact implementation mechanics: data flows, state machines, SQL, function signatures, and LLM call patterns.

---

## Table of Contents

1. [Schema & Relationships](#schema--relationships)
2. [Job & Worker System](#job--worker-system)
3. [Worker Supervisor](#worker-supervisor)
4. [Thread Lifecycle](#thread-lifecycle)
5. [Iteration Loop — One Thread, Start to Finish](#iteration-loop--one-thread-start-to-finish)
6. [Follow-Up Evaluation & Similarity Pipeline](#follow-up-evaluation--similarity-pipeline)
7. [Parallelism Architecture](#parallelism-architecture)
8. [Cost Tracking & Budget Enforcement](#cost-tracking--budget-enforcement)
9. [Plan Generation & Modification](#plan-generation--modification)
10. [Scheduling & Rate Limiting](#scheduling--rate-limiting)
11. [LLM Provider Interface](#llm-provider-interface)

---

## Schema & Relationships

Ten tables live in the shared SQLite DB at `~/.construct/construct.db`. The primary cascade chain is:

```
research_queries (session)
  └── research_threads
        ├── research_findings
        │     └── (source_urls, tags, follow_ups — JSON columns)
        └── research_steps  ──→ research_findings (FK, nullable)

research_queries
  └── research_jobs  ──→ research_threads (FK, nullable)
  └── research_plans
        └── research_plan_modifications

research_monitors  (loosely linked to queries)
  └── research_monitor_snapshots
        └── research_monitor_alerts
  └── research_proposed_monitors
```

All cascade deletes flow from `research_queries` downward. `research_jobs.thread_id` uses `ON DELETE SET NULL` (preserving job history if a thread is removed). `research_threads.parent_thread_id` also uses `ON DELETE SET NULL`.

### Key columns by table

**`research_queries`** — `id, title, seed_query, status, config (JSON), summary, document, user_notes`
- `status`: `active | paused | completed | archived`
- `config` holds the full `SessionConfig` JSON, deep-merged with `DEFAULT_SESSION_CONFIG` on read

**`research_threads`** — `id, session_id, parent_thread_id, query, short_query, node_type, origin, perturbation_strategy, status, priority, depth, max_depth, min_searches, fetch_source_text`
- `node_type`: `question | topic` (inferred by `classify()`)
- `origin`: `seed | follow_up | perturbation | user_injected | monitor_alert | verify`
- `status`: `queued | active | paused | exhausted | pruned | deferred`
- `priority`: float 0–1 (seed=1.0, follow-ups=0.5–0.9, perturbations≈0.6–0.7)

**`research_findings`** — `id, thread_id, session_id, content, summary, source_urls (JSON), source_texts (JSON), source_url_meta (JSON), source_quality, tags (JSON), confidence, novelty, actionability, user_rating, follow_ups (JSON), follow_up_analysis (JSON)`
- All numeric scores: float 0–1
- `user_rating`: `promising | not_useful | critical | null`
- `source_url_meta`: `Array<{ url, title, snippet }>`

**`research_steps`** — `id, thread_id, session_id, finding_id (nullable), model, provider, prompt_tokens, completion_tokens, cost_usd, tool_calls (JSON), duration_ms, error, label`
- `tool_calls`: `Array<{ tool, input, output?, error?, jina_fetches? }>`
- `label`: optional diagnostic tag (e.g. `"formulate"`, `"synthesize"`, `"gap_analysis"`)

**`research_jobs`** — `id, session_id, thread_id (nullable), status, mode, max_iterations, iterations_completed, claimed_by, claimed_at, heartbeat_at, started_at, completed_at, error`
- `status`: `pending | claimed | running | completed | failed | cancelled`
- `mode`: `burst | background | scheduled`
- `claimed_by`: worker ID string `worker-{pid}-{timestamp}`

**`research_plans`** — `id, session_id, items (JSON ResearchPlanItem[]), generated_at, status`
- `status`: `proposed | acknowledged | modified`
- Each `ResearchPlanItem`: `{ rank, thread_id, thread_query, parent_thread_title, origin, perturbation_strategy, estimated_cost, rationale }`

---

## Job & Worker System

### Overview

Jobs are the unit of execution. A job maps to either:
- A **session** — the worker drives the full `runIterations()` loop across all queued threads
- A **thread** — the worker executes exactly one thread via `runThread()`

The thread-per-job model (the current architecture) enables multiple workers to parallelize different threads within the same session simultaneously.

### Complete Job Walkthrough

The following traces a single thread job from creation to completion.

#### Phase 1 — Job Queuing

`worker.ts:checkQueuedThreads()` runs every 5 seconds on every worker:

```typescript
function checkQueuedThreads(): void {
  const activeSessions = sessions.listSessions(sqlite, 'active');
  for (const session of activeSessions) {
    if (session.config.schedule.mode === 'scheduled') continue;
    const maxConcurrent = session.config.max_concurrent_threads ?? 3;
    const activeCount = countActiveJobsForSession(sqlite, session.id);
    if (activeCount >= maxConcurrent) continue;
    const slots = maxConcurrent - activeCount;
    const queuedThreads = getQueuedThreadsForNewJobs(sqlite, session.id, slots);
    for (const thread of queuedThreads) {
      createThreadJobIfNone(sqlite, { session_id: session.id, thread_id: thread.id });
    }
  }
}
```

`getQueuedThreadsForNewJobs` uses a LEFT JOIN to find queued threads with no active job:

```sql
SELECT t.id, t.query, t.priority
FROM research_threads t
LEFT JOIN research_jobs j
  ON j.thread_id = t.id AND j.status IN ('pending', 'claimed', 'running')
WHERE t.session_id = ? AND t.status = 'queued' AND j.id IS NULL
ORDER BY t.priority DESC, t.created_at ASC
LIMIT ?
```

`createThreadJobIfNone` uses an atomic `INSERT...SELECT WHERE NOT EXISTS` to prevent the TOCTOU race where multiple workers simultaneously see the same thread as unassigned:

```sql
INSERT INTO research_jobs (id, session_id, thread_id, status, mode, max_iterations, created_at, updated_at)
SELECT ?, ?, ?, 'pending', 'burst', 1, ?, ?
WHERE NOT EXISTS (
  SELECT 1 FROM research_jobs
  WHERE thread_id = ? AND status IN ('pending', 'claimed', 'running')
)
```

If `changes === 0`, another worker won the race and the job is silently dropped.

#### Phase 2 — Job Claiming

Each worker's main loop calls `findPendingJob()` after the queue-check pass:

```sql
SELECT j.* FROM research_jobs j
LEFT JOIN (
  SELECT session_id, MAX(priority) as max_priority
  FROM research_threads WHERE status = 'queued'
  GROUP BY session_id
) t ON j.session_id = t.session_id
WHERE j.status = 'pending'
ORDER BY COALESCE(t.max_priority, 0) DESC, j.created_at ASC
LIMIT 1
```

Jobs from sessions with high-priority queued threads are picked first. Ties break on `created_at ASC` (oldest first).

The worker then atomically claims it:

```sql
UPDATE research_jobs
SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'),
    heartbeat_at = datetime('now'), updated_at = datetime('now')
WHERE id = ? AND status = 'pending'
```

If `changes === 0`, another worker claimed it first. The worker discards and loops.

#### Phase 3 — Job Execution

`executeThreadJob()` takes over after a successful claim:

```
markRunning()          → status: 'claimed' → 'running', started_at = now
budget check           → if daily or total budget exceeded, pause session, completeJob(), return
AbortController setup  → for shutdown + cancel signals
Heartbeat.start(60s)   → updateHeartbeat() every 60 seconds
engine.runThread()     → full thread execution (see Iteration Loop)
completeJob()          → status → 'completed', completed_at = now
```

If `runThread()` throws an `AbortError` (shutdown or cancel), the job is left in `running` state and will be reclaimed by `reclaimStaleJobs()` after 120 seconds. If it throws any other error, `failJob()` sets `status: 'failed'` and records the error string.

The `finally` block always calls `heartbeat.stop()` and clears the shutdown/cancel interval checks.

#### Phase 4 — Stale Reclaim

`reclaimStaleJobs()` runs at the top of every worker's main loop:

```sql
UPDATE research_jobs
SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = datetime('now')
WHERE status IN ('claimed', 'running')
AND heartbeat_at < datetime('now', '-120 seconds')
```

Any job whose heartbeat hasn't been updated in 2 minutes is reset to `pending` and becomes eligible for reclaiming. This handles worker crashes, SIGKILL, and jobs that hang inside a system call where the AbortController can't interrupt.

### Job Status State Machine

```
                      ┌──────────────────────────────────────┐
                      │              cancelled                │
                      │  (POST /jobs/:id/cancel)              │
                      ▼                                       │
pending ──claim──► claimed ──markRunning──► running ──────► completed
   ▲                                           │               │
   │                                           │               └──► failed
   └──────── reclaimStaleJobs ─────────────────┘
             (heartbeat > 120s ago)
```

---

## Worker Supervisor

`WorkerSupervisor` in `src/ui/api/src/worker-supervisor.ts` manages N child processes (default `WORKER_COUNT=3` from env or config).

### Spawn

Workers are spawned as:

```typescript
const args = ['run', '--no-cache', WORKER_SCRIPT];
Bun.spawn(['bun', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
```

`--no-cache` ensures the worker loads fresh bytecode after an install, not a stale Bun compile cache.

`WORKER_SCRIPT` resolves to the installed path: `~/.claude/construct/research/src/worker.ts`.

### Restart Policy

- Exit with any code → scheduled restart with exponential backoff: `min(1000 * 2^restarts, 60000)` ms
- After `MAX_RESTARTS = 20` restarts, worker is permanently marked `stopped`
- On API shutdown: SIGTERM sent to all workers; SIGKILL after 30s if not exited

### Status Reporting

`GET /api/research/workers` returns one entry per worker:

```typescript
{
  id: number,           // 0-indexed slot
  pid: number | null,
  status: 'running' | 'stopped',
  restarts: number,
  uptimeMs: number,
  currentJob: ResearchJob | null   // matched via claimed_by = 'worker-{pid}-...'
}
```

The `currentJob` is found by cross-referencing `listActiveJobs()` against the supervisor's known PIDs:

```typescript
const activeJobs = listActiveJobs(app.sqlite);
const currentJob = w.pid != null
  ? activeJobs.find(j => j.claimed_by?.startsWith(`worker-${w.pid}-`)) ?? null
  : null;
```

---

## Thread Lifecycle

### Status Transitions

```
queued
  │
  ├──claimNextThread()──► active
  │                          │
  │                          ├──runIteration() success──► exhausted
  │                          │
  │                          └──runIteration() error──► queued (re-queue, ≤1 prior errors)
  │                                                  └──► exhausted (>1 prior errors)
  │
  ├──applyPlanModifications(veto)──► pruned
  │
  ├──applyPlanModifications(boost, if exhausted)──► queued
  │
  └──depth ≥ max_depth at creation──► deferred
```

`deferred` threads are parked; they don't appear in the `getQueuedThreadsForNewJobs` query. A plan `boost` modification can promote them to `queued` (and increases `max_depth + 2`).

### Atomic Claiming

`claimNextThread()` prevents two async slots from executing the same thread:

```typescript
// SELECT the best candidate
const thread = selectNextThread(sqlite, sessionId);  // priority DESC, created_at ASC
if (!thread) return null;

// Atomic UPDATE — only succeeds if still 'queued'
const result = sqlite.prepare(
  "UPDATE research_threads SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status = 'queued'"
).run(thread.id);

if (result.changes === 0) return claimNextThread(sqlite, sessionId); // retry
return getThread(sqlite, thread.id);
```

### Priority Calculation

Child thread priority on creation:

```typescript
function calculateChildPriority(parentThread, finding): number {
  return 0.25 * (finding.confidence + finding.novelty) / 2
       + 0.20 * finding.actionability
       + 0.15 * parentThread.priority
       - 0.10 * (parentThread.depth / parentThread.max_depth)
       + 0.05 * Math.random();
}
```

- Seed thread: priority = 1.0
- Follow-ups: 0.5–0.9 depending on parent confidence/novelty
- Perturbations: 0.6 (unforced) or 0.7 (forced)
- User-injected: caller-specified (default 0.5)

### Coverage Check

`isCovered(threadFindings)` gates exhaustion:

```typescript
function isCovered(findings: ResearchFinding[]): boolean {
  if (findings.length < 3) return false;
  const avgConf = mean(findings.map(f => f.confidence));
  const avgNovelty = mean(findings.map(f => f.novelty));
  return avgConf > 0.65 && avgNovelty < 0.3;
}
```

A thread also exhausts if: it has completed `min_searches` steps with no new findings, or it reached `max_depth`.

---

## Iteration Loop — One Thread, Start to Finish

`engine.runIteration(sessionId, thread, config)` is the innermost unit. Tracing through it for a `follow_up` thread at depth=1:

### Step 1 — Task Routing

```typescript
const action = routeTask(thread, threadFindings);
// → 'broad_search'   if thread.findings.length === 0
// → 'targeted_lookup' if some findings exist
// → 'verification'   if thread.origin === 'verify'
```

### Step 2 — Query Formulation

`formulateQueries(thread, config, action)` calls the LLM:

**Prompt (broad_search)**:
> "You are a research assistant. Generate 2–6 diverse search queries to explore: {thread.query}. Context: {session.seed_query}. Previous queries already run: {deduped list}. Return JSON array of strings."

**Prompt (targeted_lookup)**:
> "You are a research assistant. We have {N} findings on '{thread.query}' but need to fill gaps. Generate 2–4 targeted queries. Already searched: {list}. Return JSON array of strings."

Falls back to `[thread.query]` if LLM returns unparseable output. Queries already executed in this session are passed as negative examples so the LLM avoids repeating them.

### Step 3 — Search Execution

`executeSearches(queries, ...)` runs all queries in parallel via `Promise.all`:

```typescript
const results = await Promise.all(queries.map(q => provider.searchWeb(model, q)));
```

For each query, the OpenRouter provider:
1. Calls Tavily → Brave → DuckDuckGo to get result URLs
2. Calls the LLM with source snippets to synthesize an answer
3. Returns `{ text, sourceUrls, sourceUrlMeta, promptTokens, completionTokens, model }`

Each search call is recorded as a `research_steps` row with `tool_calls: [{ tool: 'web_search', input: { query }, output: text }]`.

If `config.fetch_source_text = true`, full page text is additionally fetched via Jina Reader (`r.jina.ai/{url}`) for each source URL and appended to the synthesis context.

### Step 4 — Gap Analysis (conditional)

If `config.gap_analysis.enabled = true`:

```typescript
// Prompt: "Given this draft finding, identify up to N missing aspects. Return JSON: { has_gaps, gap_queries }"
const gaps = await gapAnalysis(thread, draftFinding, config);
if (gaps.length > 0) {
  const gapResults = await executeSearches(gaps, ...);
  allResults.push(...gapResults);   // feeds back into synthesis
}
```

Up to `config.gap_analysis.max_gap_searches` (default: 2) gap queries are executed.

### Step 5 — Synthesis

`synthesizeFinding(thread, allResults, config)` concatenates results and calls the LLM:

```
### Search: {query1}
{text1}

---

### Search: {query2}
{text2}
```

**Prompt**:
> "Analyze the following research results for: '{thread.query}'. Return valid JSON:
> `{ content, summary, source_urls, source_quality, tags, confidence, novelty, actionability }`
> - content: 2–4 paragraphs synthesizing key findings
> - confidence: 0–1, how reliable the information appears
> - novelty: 0–1, how new this is relative to prior context
> - actionability: 0–1, practical usefulness"

JSON is extracted via `stripLLMFences()`, which removes `<think>` blocks, strips triple-backtick fences, and falls back to finding the first `{` or `[` in the output.

### Step 6 — Duplicate Detection

If synthesis produces a finding, `checkDuplicate()` compares it against the 50 most recent session findings:

**Prompt**:
> "Is this new finding essentially the same information as any of these existing findings? Respond with just 'true' or 'false'."

If `true`, the finding's novelty is clamped: `novelty = min(novelty, 0.2)`.

### Step 7 — Finding Persistence

`findings.createFinding()` writes the row with all scored fields. All array columns (source_urls, tags, follow_ups, etc.) are serialized to JSON strings.

### Step 8 — Verification Thread (conditional)

If `finding.confidence < 0.4` and `thread.origin !== 'verify'`:

```typescript
threads.createThread(sqlite, {
  session_id: sessionId,
  parent_thread_id: thread.id,
  spawned_from_finding_id: finding.id,
  query: `Verify: ${finding.summary}`,
  origin: 'verify',
  depth: thread.depth + 1,
  status: depth + 1 >= max_depth ? 'deferred' : 'queued',
  priority: 0.4,   // lower than normal follow-ups
});
```

### Step 9 — Follow-Up Spawning (conditional)

If `!isCovered(threadFindings)` (thread not yet exhausted):

`evaluateFollowUps()` runs the follow-up pipeline (detailed in next section). Accepted questions become child threads:

```typescript
for (const question of acceptedFollowUps) {
  if (question.length < 10) continue;
  if (/\b(they|it|this|these|those|their)\b/i.test(question)) continue;  // pronoun filter
  if (existingQueries.has(question.toLowerCase())) continue;             // exact dedup

  threads.createThread(sqlite, {
    session_id: sessionId,
    parent_thread_id: thread.id,
    spawned_from_finding_id: finding.id,
    query: question,
    origin: 'follow_up',
    depth: thread.depth + 1,
    priority: calculateChildPriority(thread, finding),
    status: depth + 1 >= max_depth ? 'deferred' : 'queued',
  });
  summarizeThreadAsync(threadId, question, ...);  // fire-and-forget short title
}
```

### Step 10 — Thread Exhaustion

After `runIteration()` returns, `runThread()` marks the thread `exhausted`:

```typescript
threads.updateThread(sqlite, thread.id, { status: 'exhausted' });
```

It then calls `maybePerturbate()` (see below), `generatePlan()`, and conditionally `updateSummary()` + `updateDocument()`.

---

## Follow-Up Evaluation & Similarity Pipeline

`evaluateFollowUps()` implements a retry loop to produce `config.follow_up.min_count` accepted questions per finding.

### Stage 1 — Gap Detection

`detectGaps(thread, searchResults, finding, config, rejectionContext?)` calls the LLM with a node_type-aware prompt:

**For `topic` threads**:
> "Identify {max_count} specific subtopics or aspects of '{query}' not yet covered by existing findings. Return noun phrases only, no questions."

**For `question` threads**:
> "Based on these findings, identify {max_count} follow-up questions. Requirements: (1) NO pronouns like they/it/this — use full proper nouns; (2) fully self-contained; (3) directly searchable."

If a previous retry failed, `rejectionContext` is appended:
> "Previously rejected (too similar to existing threads): {list}. Generate different questions."

### Stage 2 — Scoring & Ranking

`scoreAndRankFollowUps()` evaluates each candidate:

**Quality score** (heuristic, 0–1):
- Specificity: word count ≥5, contains numbers/capitals, avoids vague words
- Relevance: Jaccard similarity to parent query (for questions) or keyword containment (for topics)
- Focus: well-formed structure score

**Distance from parent**: `1 - jaccardSimilarity(candidate, parentQuery)`

**Similarity check** via `computeSimilarity()` — three-stage cascade:

```
1. Jaccard similarity (always computed)
   │
   ├── |jaccard - threshold| > 0.15 → decisive, stop here
   │
   └── ambiguous → Stage 2: embedding (if provider.embed available)
                      │
                      ├── |embedding - threshold| > 0.10 → decisive, stop here
                      │
                      └── ambiguous → Stage 3: LLM judge
                                        → binary 0/1 decision
```

**Rank score**: `0.40 * quality + 0.30 * distance_from_parent + 0.30 * (1 - similarity)`

Candidates above the similarity threshold are rejected. Accepted candidates are accumulated until `min_count` is reached.

### Retry Logic

```
attempt 1: detectGaps() → scoreAndRankFollowUps() → if accepted < min_count, build rejection context
attempt 2: detectGaps(rejectionContext) → scoreAndRankFollowUps() → accumulate
...
attempt max_retries (default 3): use whatever was accepted
```

The final `FollowUpAnalysis` object records every candidate with its score, similarity method, and acceptance status — stored in `research_findings.follow_up_analysis` for debugging.

---

## Parallelism Architecture

### Two levels of parallelism

**Level 1 — Worker processes** (managed by `WorkerSupervisor`): each worker is an independent process with its own DB connection. All coordination is via SQLite — atomic `UPDATE WHERE status='pending'` is the mutex.

**Level 2 — Concurrent thread slots** (within `runIterations()`): a session job runs `max_concurrent_threads` async slots simultaneously, each claiming a different thread from the session's queue.

### Job-level parallelism (thread-per-job mode)

Each queued thread gets its own job. With 3 workers and a session with 10 queued threads:

```
Worker 0: job A (thread 1) → completes → picks up job D (thread 4) → ...
Worker 1: job B (thread 2) → completes → picks up job E (thread 5) → ...
Worker 2: job C (thread 3) → completes → picks up job F (thread 6) → ...
```

The `max_concurrent_threads` setting in `checkQueuedThreads` caps how many jobs are created for a single session at once — preventing a session from monopolizing all workers.

### Race conditions prevented

| Risk | Mechanism |
|---|---|
| Two workers create jobs for same thread | `INSERT...SELECT WHERE NOT EXISTS` (atomic) |
| Two async slots claim same thread | `UPDATE WHERE status='queued'` with `changes === 0` retry |
| Two workers claim same job | `UPDATE WHERE status='pending'` with `changes === 0` drop |
| Worker crash leaves job stuck | `reclaimStaleJobs()` resets after 120s heartbeat gap |

### SQLite concurrency settings

```typescript
sqlite.exec('PRAGMA busy_timeout = 5000');
```

All workers share the single SQLite file. Bun's SQLite (libsql) uses WAL mode. The 5-second busy timeout prevents `SQLITE_BUSY` errors under write contention from multiple simultaneous workers.

---

## Cost Tracking & Budget Enforcement

### Cost calculation

Every `research_steps` row stores a pre-calculated `cost_usd`:

```typescript
function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}
```

**Pricing table** (per 1M tokens):

| Model | Input | Output |
|---|---|---|
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| `claude-haiku-4-5-20251001` | $0.80 | $4.00 |
| `claude-opus-4-6` | $15.00 | $75.00 |
| `deepseek/deepseek-chat` | $0.14 | $0.28 |
| `google/gemini-2.0-flash-001` | $0.10 | $0.40 |
| unknown models | $0.00 | $0.00 |

OpenRouter pricing is in `providers/openrouter.ts`; Anthropic/model pricing in `types.ts`.

### Budget aggregation

`getQueryCost(sqlite, sessionId)`:

```sql
SELECT
  SUM(cost_usd) as total_cost,
  COUNT(*) as step_count,
  SUM(CASE WHEN created_at >= date('now') THEN cost_usd ELSE 0 END) as today_cost
FROM research_steps WHERE session_id = ?
```

### Budget enforcement points

1. **Before each thread job** (`executeThreadJob`): checks `today_cost >= budget_daily_usd` and `total_cost >= budget_total_usd`. If exceeded, sets session `status: 'paused'` and calls `completeJob()`.

2. **Inside `runIterations()`**: same check at the top of each iteration slot loop. Stops the slot loop and exits.

Both checks call `sessions.updateQuery(sqlite, sessionId, { status: 'paused' })` — no data is lost, the session resumes when budget resets or is increased.

---

## Plan Generation & Modification

### Generation

`generatePlan(sessionId, config)` runs after each completed thread (or every 5 iterations in session mode).

```typescript
// 1. Fetch up to 15 highest-priority queued/active threads
const threads = listThreads(sqlite, sessionId, 'queued' | 'active')  // top 15

// 2. If session has a summary: ask LLM to re-rank
if (session.summary) {
  // Prompt: "Given what we've learned (summary), re-rank these threads 
  //          from most to least important for completing the research.
  //          For each, provide a 1-sentence rationale."
  // Expect JSON: [{ thread_index, rationale }, ...]
}

// 3. Fallback: static rationale based on origin
// - seed: "Seed thread"
// - follow_up: "Follow-up from {parent.short_query}"
// - perturbation: "Tangent via {strategy}"
// - gap: "Gap identified in {parent.short_query}"
// - user_injected: "User-specified thread"

// 4. Persist
plans.createPlan(sqlite, sessionId, rankedItems);
```

Each item in the plan includes: `rank, thread_id, thread_query, origin, perturbation_strategy, estimated_cost, rationale`.

### Modification

`POST /api/research/sessions/:id/plan/modify` writes a `research_plan_modifications` row. Modifications are applied lazily at the start of the next `runThread()` call via `applyPlanModifications()`:

| Action | Effect |
|---|---|
| `veto` | Sets thread `status: 'pruned'` — excluded from future scheduling |
| `boost` | If exhausted: resets to `'queued'`, adds +0.3 priority, raises `max_depth + 2`. Otherwise: +0.3 priority only |
| `deprioritize` | Subtracts 0.3 from priority |
| `inject` | Creates a new thread with `origin: 'user_injected'` |
| `note` | No engine effect; records user comment in plan history |
| `config_change` | Updates session config fields (processed separately) |

After applying, the plan's `status` is set to `'modified'`.

---

## Scheduling & Rate Limiting

### Active Windows

Windows are defined as `{ days: string[], start: 'HH:MM', end: 'HH:MM' }`. Evaluation:

```typescript
function isInActiveWindow(windows: ScheduleWindow[], timezone: string): boolean {
  if (windows.length === 0) return true;  // always active
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, ... });
  const { day, hour, minute } = formatter.formatToParts(new Date());
  return windows.some(w =>
    w.days.includes(day) && timeInRange(hour, minute, w.start, w.end)
  );
}
```

Overnight windows (e.g. `start: '22:00', end: '06:00'`) are handled by checking if `end < start` and wrapping the comparison.

`msUntilNextWindow()` looks ahead 7 days to find the next window start, returning milliseconds or `null` if no windows are defined.

### Rate Limiting

`StepRateLimiter` is a sliding-window counter:

```typescript
class StepRateLimiter {
  private timestamps: number[] = [];

  canProceed(): boolean {
    this.timestamps = this.timestamps.filter(t => t > Date.now() - 3_600_000);
    return this.timestamps.length < this.maxPerHour;
  }

  record(): void { this.timestamps.push(Date.now()); }

  msUntilNextSlot(): number {
    const oldest = Math.min(...this.timestamps);
    return oldest + 3_600_000 - Date.now();
  }
}
```

`config.max_steps_per_hour` (default 60) is the cap. `config.min_delay_between_steps_ms` (default 2000) is enforced as a `sleep()` call between iterations in session mode.

### Heartbeat

`Heartbeat` drives periodic DB writes to prove a job is alive:

```typescript
class Heartbeat {
  start(intervalMs = 60_000): void {
    this.beat();                          // immediate first beat
    this.timer = setInterval(() => this.beat(), intervalMs);
  }

  private beat(): void {
    this.lastBeat = Date.now();
    this.callback();                      // calls updateHeartbeat(sqlite, jobId, ...)
  }

  stop(): void { clearInterval(this.timer); }
}
```

Both session jobs and thread jobs run a heartbeat. The 60-second interval is well under the 120-second stale threshold.

---

## LLM Provider Interface

All providers implement:

```typescript
interface LLMProvider {
  complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult>;
  searchWeb(model: string, query: string): Promise<WebSearchResult>;
  embed?(text: string): Promise<number[]>;  // optional, enables embedding similarity
}

interface LLMResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

interface WebSearchResult extends LLMResult {
  sourceTexts: string[];
  sourceUrls: string[];
  sourceUrlMeta?: Array<{ url: string; title: string; snippet: string }>;
  jinaFetches?: Array<{ url: string; ok: boolean; content_length: number; error?: string }>;
}
```

### OpenRouter

`fetchWithRetry()` wraps every call with:
- A 120-second `AbortController` timeout (prevents indefinite hangs)
- 3 retry attempts on 429/529 with exponential backoff: `2^(attempt+1) * 5000` ms
- Diagnostic error on missing `choices` field: `throw new Error("OpenRouter bad response (no choices): ...")`

Model rotation: the provider cycles through `config.providers.openrouter_models` on each call, incrementing an internal `modelIndex`. If the caller passes a model containing `/`, that specific model is used instead of rotating.

### Anthropic

Uses the `web_search_20250305` tool (max 5 uses per call). Source URLs and page content are extracted from `web_search_tool_result` content blocks in the response. Retry policy matches OpenRouter (3 attempts, exponential backoff on 429/529).

### Provider Selection (per session)

```typescript
function buildProvider(session): LLMProvider {
  const key = session.config.providers?.openrouter_api_key ?? process.env.OPENROUTER_API_KEY;
  const models = session.config.providers?.openrouter_models?.length
    ? session.config.providers.openrouter_models
    : [session.config.model ?? 'deepseek/deepseek-chat'];
  return new OpenRouterProvider({ apiKey: key, models });
}
```

Anthropic provider is only instantiated if `session.config.providers.primary === 'anthropic'` (future/optional).
