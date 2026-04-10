---
description: Deep autonomous research — long-running investigations with budgets and persistence. For quick lookups use /search.
---
Manage deep research queries. Parse the user's intent from: $ARGUMENTS

The research API is available at the Construct API server (default http://localhost:3000/api/research).

## Actions

- **start <topic>**: POST /research/queries with seed_query. Optionally start running with POST /research/queries/:id/run.
- **status [query-id]**: GET /research/queries (list) or GET /research/queries/:id (detail). Show title, status, finding count, cost.
- **pause <id>**: PATCH /research/queries/:id with status: "paused".
- **resume <id>**: PATCH /research/queries/:id with status: "active".
- **findings <id> [--top N] [--sort quality]**: GET /research/queries/:id/findings. Show as compact list with summary, confidence, novelty.
- **cost <id>**: GET /research/queries/:id/costs. Show total, today, by-model breakdown.
- **plan <id>**: GET /research/queries/:id/plan. Show numbered list with thread query, origin, strategy.
- **plan <id> --veto <ranks>**: POST /research/queries/:id/plan/modify with action: "veto" for each rank.
- **plan <id> --boost <ranks>**: POST /research/queries/:id/plan/modify with action: "boost" for each rank.
- **inject <id> <question>**: POST /research/queries/:id/threads with the question as a user-injected thread.
- **prune <id> <thread-id>**: PATCH /research/threads/:thread-id with status: "pruned".
- **boost <id> <thread-id>**: PATCH /research/threads/:thread-id with increased priority and max_depth.
- **run <id> [--iterations N]**: POST /research/queries/:id/run to execute N iterations (default 5).

## Implementation

Use web_fetch or curl to call the API endpoints. The API key for running research can be passed in the request body or set as ANTHROPIC_API_KEY env var.

## Output format

Keep output concise. Use markdown tables for lists. Show IDs so the user can reference them.
For findings, show: rank, summary (truncated to ~80 chars), confidence, novelty, tags.
For plans, show: rank, query (truncated), origin, perturbation strategy if any.
</id></thread-id></id></thread-id></id></question></id></ranks></id></ranks></id></id></id></id></id></id></topic>