# Research Module — Agent Guide

Autonomous multi-threaded research engine. Workers claim jobs from SQLite, run engine iterations, and stream results via SSE.

---

## Key files

| File | Role |
|---|---|
| `src/engine.ts` | Core iteration loop: select thread → search → score → follow-ups → gap analysis → perturbation |
| `src/worker.ts` | Job poller: claims jobs from `research_jobs`, runs engine iterations, updates heartbeats |
| `src/similarity.ts` | `jaccardSimilarity()`, `computeSimilarity()` — deduplication logic |
| `src/perturbation.ts` | Thread perturbation strategies |
| `src/scheduler.ts` | Rate limiting + budget enforcement |
| `src/ddl.ts` | Schema migrations (run at startup via `applyResearchDDL`) |
| `src/types.ts` | All domain types |
| `src/providers/router.ts` | Provider selector (currently only OpenRouter) |
| `src/providers/openrouter.ts` | OpenRouter LLM calls |
| `src/providers/websearch.ts` | Web search provider |
| `src/services/` | One file per table: `sessions.ts`, `threads.ts`, `findings.ts`, `steps.ts`, `jobs.ts`, `plans.ts`, `monitors.ts` |
| `src/services/id.ts` | All ID generation — always use this, never `crypto.randomUUID()` directly |

---

## Database tables

| Table | Purpose |
|---|---|
| `research_queries` | Top-level research sessions (was `research_sessions`, renamed in migration) |
| `research_threads` | Individual research threads/questions |
| `research_findings` | Findings attached to threads |
| `research_steps` | Individual search/LLM steps |
| `research_plans` | Research plans |
| `research_plan_modifications` | Plan change log |
| `research_jobs` | Work queue (claimed by workers) |
| `research_monitors` | Ongoing monitor definitions |
| `research_monitor_snapshots` | Monitor check results |
| `research_monitor_alerts` | Triggered alerts |
| `research_proposed_monitors` | LLM-suggested monitors awaiting approval |

The service file `src/services/sessions.ts` still uses `research_sessions` in its queries — this reflects the pre-migration name that was aliased. The DDL creates `research_queries`. If you see query failures, check which table name the service is using.

---

## SSE stream

`/api/research/queries/:id/stream` — event types: `finding`, `thread`, `step`, `job`

---

## Configuration (per-session, in `research_queries.config`)

| Key | Effect |
|---|---|
| `budget_daily_usd` | Hard cap on daily spend — engine checks before each step |
| `budget_total_usd` | Hard cap on total spend |
| `min_delay_between_steps_ms` | Minimum pause between steps |
| `max_steps_per_hour` | Rate limit |
| `follow_up.similarity_threshold` | Dedup threshold for follow-up questions (default 0.75) |
| `follow_up.min_count` / `max_count` | Follow-up generation bounds |

---

## Environment variables

| Var | Required for |
|---|---|
| `OPENROUTER_API_KEY` | All workers (default provider) |
| `WORKER_COUNT` | Number of worker processes (default 3) |

---

## Rules

- Always generate IDs via `src/services/id.ts` — never inline `crypto.randomUUID()`
- Budget checks happen in `engine.ts` before each iteration — never skip them
- Dedup uses Jaccard similarity via `similarity.ts` — the threshold comes from session config's `follow_up.similarity_threshold`
- When modifying the engine iteration loop, update `docs/specs/RESEARCH.md` to match
- Each running loop spawns one child process via `loop-supervisor.ts` in `src/ui/api/src/`; there is no shared worker pool
