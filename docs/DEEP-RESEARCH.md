# Deep Research — Feature Specification

**Project:** Construct
**Version:** 0.2
**Date:** 2026-03-30
**Status:** Ready for implementation

---

## 1. Overview

Deep Research is an autonomous, long-running research capability within Construct. Given a topic, the system conducts iterative, expanding research over days or weeks — but the key insight is that the research topic itself evolves. The system doesn't just answer the original question more thoroughly; it mutates, branches, and drifts into territory the user would never have thought to explore. It follows tangents for multiple hops, deliberately perturbs its own search parameters, cross-pollinates across unrelated knowledge, and treats serendipitous discovery as a primary output — not a side effect.

This is not "the same question, researched harder." It explores unknown unknowns through systematic randomness, perspective shifting, and aggressive branching. Results accumulate into a structured, navigable knowledge base. The output supports real-world decision-making and, eventually, autonomous action.

### 1.1 Design Principles

1. **Divergence is the point.** The most valuable output is often something adjacent or unexpected the user would never have searched for. Perturbation, tangent-following, and topic evolution are the core mechanism. A session returning only findings on the exact topic asked about has failed.
2. **Autonomy with oversight.** Runs independently for hours or days. The user can check in, steer, pause, or redirect at any time.
3. **Breadth before depth, then depth where it matters.** Cast a wide net first. Even deep threads should occasionally spawn sideways explorations.
4. **Cost-awareness as a first-class concern.** Track spend, use cheaper models where appropriate, respect configurable budgets.
5. **Structured output, not just text.** Findings are nodes in a research graph — filterable, navigable, exportable.
6. **Steerability over automation.** User hints have outsized influence, including which tangents to pursue and which perturbation strategies are producing value.

---

## 2. Data Model

### 2.1 Research Session

Top-level container for a research effort. Persists indefinitely until archived.

```
ResearchSession {
  id: string (uuid)
  title: string
  seed_query: string
  status: "active" | "paused" | "completed" | "archived"
  config: SessionConfig            // see §8 for full config schema
  summary: string                  // auto-generated rolling summary
  user_notes: string
  created_at: datetime
  updated_at: datetime
}
```

### 2.2 Research Thread

A line of inquiry. Threads branch from findings, user prompts, or the perturbation system. Perturbation-spawned threads are first-class citizens — tagged for tracking but treated identically in the execution loop.

```
ResearchThread {
  id: string (uuid)
  session_id: string (fk)
  parent_thread_id: string | null
  spawned_from_finding_id: string | null
  query: string
  origin: "seed" | "follow_up" | "perturbation" | "user_injected" | "monitor_alert"
  perturbation_strategy: string | null
  status: "queued" | "active" | "paused" | "exhausted" | "pruned"
  priority: float (0.0 - 1.0)
  depth: int
  max_depth: int
  created_at: datetime
  updated_at: datetime
}
```

### 2.3 Finding

A discrete unit of discovered knowledge. Primary output — what the user reads, what threads branch from, what the knowledge base accumulates.

```
Finding {
  id: string (uuid)
  thread_id: string (fk)
  content: string                  // 1-3 paragraphs
  summary: string                  // one-line
  source_urls: string[]
  source_quality: float (0.0 - 1.0)
  tags: string[]
  confidence: float (0.0 - 1.0)
  novelty: float (0.0 - 1.0)
  actionability: float (0.0 - 1.0)
  user_rating: "promising" | "not_useful" | "critical" | null
  follow_up_questions: string[]
  created_at: datetime
}
```

### 2.4 Research Step

Execution record for a single unit of work. Used for cost tracking, debugging, replay.

```
ResearchStep {
  id: string (uuid)
  thread_id: string (fk)
  finding_id: string | null
  model: string
  provider: string
  prompt_tokens: int
  completion_tokens: int
  cost_usd: float
  tool_calls: ToolCall[]
  duration_ms: int
  error: string | null
  created_at: datetime
}
```

### 2.5 Research Plan

Snapshot of the upcoming research queue, generated each iteration and included in digests. Enables user steering via numbered item references.

```
ResearchPlan {
  id: string (uuid)
  session_id: string (fk)
  digest_id: string | null (fk)
  items: ResearchPlanItem[]
  generated_at: datetime
  status: "proposed" | "acknowledged" | "modified"
}

ResearchPlanItem {
  rank: int
  thread_id: string (fk)
  thread_query: string
  parent_thread_title: string | null
  origin: "follow_up" | "perturbation" | "user_injected" | "monitor_alert"
  perturbation_strategy: string | null
  estimated_cost: float
  rationale: string
}

PlanModification {
  id: string (uuid)
  plan_id: string (fk)
  action: "veto" | "boost" | "deprioritize" | "inject" | "note" | "config_change"
  target_item_rank: int | null
  target_thread_id: string | null
  payload: string
  source: "cli" | "ui" | "email_reply" | "chat"
  raw_input: string | null
  created_at: datetime
}
```

### 2.6 Monitor

A recurring search that runs on a schedule, diffs results against a baseline, and surfaces changes. Unlike research threads (divergent), monitors are convergent — same query, repeated, detect the delta. Can exist standalone or linked to a session.

```
Monitor {
  id: string (uuid)
  session_id: string | null
  title: string
  status: "active" | "paused" | "archived"
  queries: string[]
  fetch_urls: string[]
  schedule: string                  // cron expression
  timezone: string
  match_criteria: MatchCriteria
  model: string
  cost_per_cycle_estimate: float
  budget_daily_usd: float | null
  created_at: datetime
  updated_at: datetime
}

MatchCriteria {
  keywords_include: string[]
  keywords_exclude: string[]
  price_range: { min: float, max: float } | null
  location_filter: string | null
  relevance_prompt: string          // LLM-evaluated natural language filter
  urgency_rules: string
  severity_rules: { urgent: string, notable: string }
}
```

### 2.7 Monitor Snapshot & Alert

```
MonitorSnapshot {
  id: string (uuid)
  monitor_id: string (fk)
  cycle_number: int
  raw_results: string               // JSON blob, gzip-compressed after 14 days
  result_hash: string
  item_count: int
  cost_usd: float
  created_at: datetime
}

MonitorAlert {
  id: string (uuid)
  monitor_id: string (fk)
  snapshot_id: string (fk)
  alert_type: "new_item" | "removed_item" | "changed_item" | "threshold_crossed" | "custom"
  title: string
  content: string
  source_url: string | null
  matched_criteria: string[]
  severity: "info" | "notable" | "urgent"
  status: "unread" | "read" | "acted_on" | "dismissed"
  spawned_thread_id: string | null
  created_at: datetime
}
```

Alert deduplication uses a two-key system: **item identity** (URL or fuzzy title match) determines "same thing," **essential data hash** (price, acreage, status for real estate; title, date for news) determines "same state." Same identity + same hash within `dedup_window_days` (default: 7) → suppress. Different hash → new alert.

### 2.8 Proposed Monitor

Auto-generated when a research thread crosses a depth/actionability threshold and the topic is "monitor-shaped" (ongoing market, recurring events, policy changes).

```
ProposedMonitor {
  id: string (uuid)
  session_id: string (fk)
  thread_id: string (fk)
  proposed_queries: string[]
  proposed_fetch_urls: string[]
  proposed_criteria: MatchCriteria
  proposed_schedule: string
  rationale: string
  status: "proposed" | "accepted" | "rejected"
  created_at: datetime
}
```

### 2.9 Research Artifact (Phase 4)

Archived documents, images, and data files discovered during research. Web pages are NOT archived. No OCR or text extraction — the `description` field holds an LLM-generated summary of the artifact's content based on available metadata and context.

```
ResearchArtifact {
  id: string (uuid)
  finding_id: string (fk)
  session_id: string (fk)
  filename: string
  mime_type: string
  size_bytes: int
  storage_path: string              // relative path in artifact dir
  source_url: string
  description: string               // LLM-generated
  created_at: datetime
}
```

Storage rules: PDFs < 25 MB, images/data/docs < 10 MB, video/audio/HTML not archived. Per-session budget: 500 MB default. Stored in `~/.construct/research/artifacts/<session-id>/`.

### 2.10 Cross-Session Knowledge (Phase 4)

All findings across all sessions share a global embedding index (sqlite-vec). When formulating queries, the engine retrieves semantically related findings from ANY session and injects them as background context.

```
FindingCrossReference {
  id: string (uuid)
  source_finding_id: string (fk)
  referencing_session_id: string (fk)
  referencing_thread_id: string (fk)
  relevance_score: float
  created_at: datetime
}
```

### 2.11 Proposed Action (Phase 5)

```
ProposedAction {
  id: string
  session_id: string
  finding_id: string
  action_type: string
  description: string
  draft_content: string | null
  status: "proposed" | "approved" | "executed" | "rejected"
  requires_approval: boolean        // always true in Phase 5
  created_at: datetime
  executed_at: datetime | null
}
```

---

## 3. Research Engine

### 3.1 Execution Loop

```
while session.status == "active" and within_budget():
    1. CHECK for pending plan modifications — apply vetoes/boosts
    2. SELECT next thread (highest priority, status == "queued" or "active")
    3. FORMULATE search queries (direct + reformulated + decomposed + contrarian + adjacent + temporal — 2-4 strategies per iteration)
    4. EXECUTE searches (web_search, web_fetch, Playwright if needed)
    5. SYNTHESIZE findings from results
    6. EVALUATE each finding (confidence, novelty, actionability)
    7. STORE findings, CHECK for artifact archival
    8. GENERATE follow-up questions
    9. SPAWN child threads from follow-up questions
   10. PERTURB — with probability p_serendipity, spawn tangent threads (§3.3)
   11. UPDATE thread status (exhausted if no new high-novelty findings)
   12. UPDATE session summary
   13. REGENERATE research plan (re-rank queued threads)
   14. CHECK schedule — if outside active hours, pause
   15. CHECK budget — if approaching limit, pause and notify
```

### 3.2 Thread Prioritization

```
priority = (
    0.35 * user_signal
  + 0.25 * parent_quality
  + 0.20 * novelty_potential
  - 0.10 * depth_penalty
  + 0.05 * staleness_boost
  + 0.05 * random_perturbation
)
```

Weights are tunable per session.

### 3.3 Perturbation & Serendipity System

This is the engine behind Design Principle #1. Without perturbation, the system converges on what any competent human researcher would find. With it, the system explores unknown unknowns.

#### Strategy Perturbations (21 strategies, 5 categories)

**Perspective shifts:** analogical ("what field solved a similar problem?"), contrarian (strongest argument against), persona injection (randomly selected profession's perspective from curated list), negation/inversion ("who deliberately chose NOT to, and why?").

**Dimensional shifts:** geographic transposition (same topic, different region from curated list), temporal shift (50 years ago / 50 years from now), scale shift (10x bigger/smaller/cheaper/more expensive), economics inversion (what makes it unviable? 10x more accessible?).

**Network walking:** citation chain walking (follow references 2 hops from original topic), social graph walking (research people mentioned in findings — what else do they work on?), adjacent community discovery (what ELSE do communities discussing this topic discuss?), supply chain walk (trace dependency graph in both directions).

**Knowledge injection:** news injection (daily headline scan for connections), cross-session pollination (query global finding index for adjacent findings from other sessions), user interest bridging (from Construct profile — unexpected bridges to known interests), metaphor generation (generate metaphors, research the metaphorical domain).

**Deepening:** people deep-dive (find contrarian/experienced voices), failure post-mortem (specific failure stories), second-order effects (consequences of consequences), regulatory/legal scan, academic/patent search.

#### Mechanism Perturbations

1. **Temperature jitter** — bump LLM temp to 0.8-1.2 for wilder query formulation
2. **Model rotation** — different model for tangent generation (different biases, different blind spots)
3. **Random seed word injection** — inject evocative word from curated dictionary into query-generation prompt (not the search query itself)
4. **Source type forcing** — force searches targeting Reddit, academic papers, YouTube transcripts, government reports, etc.
5. **Recency inversion** — search for OLD content ("earliest discussion of [topic]", date ranges like "2005-2010")

#### Perturbation Scheduling

- **Depth-scaled probability:** `p = p_base + (depth / max_depth) * 0.15` — deeper threads get perturbed more
- **Forced diversity:** if last 5 findings are from same domain/source type, next iteration MUST use a mechanism perturbation
- **Perturbation chains:** tangent threads get 2-3 iterations of follow-up before quality evaluation
- **Strategy cooldown:** 3-iteration cooldown per strategy after use
- **Fruitfulness tracking:** adjusts strategy weights based on which produce high-novelty findings. User vetoes of perturbation plan items also reduce that strategy's weight.
- **Session-phase awareness:** early iterations favor breadth strategies (geographic, temporal, scale). Later iterations favor network-walking (citation chains, social graphs).

### 3.4 Deduplication & Novelty Detection

Compare new finding summaries against existing findings. Phase 1-3: LLM-based comparison (cheap-tier model). Phase 4+: embedding similarity via sqlite-vec. Similarity > 0.85 → duplicate (merge or discard). 0.6 < similarity < 0.85 → store but flag as related, lower novelty score.

### 3.5 Convergence & Exhaustion

**Thread exhaustion:** last 3 findings all novelty < 0.3, OR thread exceeded max_depth, OR queries returning already-seen results. Exhausted threads stop but their findings remain — perturbation can still spawn tangents FROM exhausted findings.

**Session completion:** only when user explicitly marks complete OR budget fully exhausted. Sessions do NOT auto-complete when threads exhaust. When all threads exhaust, engine spawns perturbation threads at elevated probability, flags in digest, continues. Default: keep exploring until told to stop or money runs out.

**Diminishing returns:** avg novelty across last 20 findings < 0.25 → advisory flag in digest (not automatic).

### 3.6 Monitor Execution Loop

```
for each monitor where status == "active" and schedule_is_due():
    1. EXECUTE queries via web_search + FETCH urls via Playwright/web_fetch
    2. PARSE results into discrete items
    3. HASH items, LOAD previous snapshot, DIFF (new/removed/changed)
    4. FILTER changes through match_criteria (structured filters first, then LLM)
    5. STORE snapshot, CREATE alerts for passing changes
    6. If linked to session and severity >= "notable": auto-spawn research thread
    7. NOTIFY user if any "urgent" alerts
```

Item identity: URL match → fuzzy title match (Levenshtein < 0.2) → LLM semantic match (fallback only).

---

## 4. Model Strategy

| Task | Model Tier | Rationale |
|------|-----------|-----------|
| Query formulation | Cheap (Haiku, Gemini Flash, DeepSeek) | High volume, low stakes |
| Search result synthesis | Mid (Sonnet) | Needs good comprehension |
| Finding evaluation | Mid (Sonnet) | Needs judgment |
| Tangent generation | Varied (rotate) | Different models = different perspectives |
| Deep analysis / reports | Expensive (Opus) | Quality matters |
| Embeddings | Cheap (OpenRouter) | text-embedding-3-small via OpenRouter |

Providers: Anthropic API (primary), OpenRouter (300+ models, cost optimization, diversity, embeddings).

---

## 5. Scheduling & Execution

Four modes: **interactive** (foreground), **background** (daemon), **scheduled** (configured windows), **burst** (N iterations then pause).

Background execution via pm2/systemd. All state in SQLite — crash-safe resume. Heartbeat every 60s. Graceful shutdown on SIGTERM/SIGINT.

---

## 6. Human-in-the-Loop

### 6.1 Daily Digest

Generated on schedule (default: daily 8am), delivered via email. Contents:

1. Session summary (2-3 paragraphs)
2. New findings since last digest, grouped by thread
3. **Upcoming research plan** — numbered list of next 10-15 topics with rationale, origin tags, perturbation strategy labels, per-item cost estimates, total estimated cost for next window
4. Monitor alerts since last digest
5. Proposed monitors awaiting approval
6. Decision points
7. Cost report (since last digest + cumulative)

#### Steering via Plan

MVP: digest is informational, user steers via CLI (`construct research plan <id> --veto 3,5 --boost 1`). Phase 3: UI with inline action buttons per plan item. Future: reply-to-email parsing and/or chat interface for conversational steering. The `PlanModification` model (§2.5) accepts input from any source channel and feeds back into perturbation weight tracking.

### 6.2 User Feedback

| Action | Effect |
|--------|--------|
| Rate finding (promising / not_useful / critical) | Adjusts thread + children priority |
| Boost / prune thread | Priority change, max_depth change |
| Add note to thread | Context for future query formulation |
| Inject question | New thread at high priority |
| Veto / boost plan items | Immediate priority adjustment for next window |
| Adjust config | Budget, models, schedule, perturbation rate |

### 6.3 Reports

On-demand synthesis (Opus-tier). Sections: executive summary, key findings, **unexpected discoveries** (from perturbation threads — includes strategy and hop chain), topic map, source index, open questions, recommended actions, **perturbation analysis** (strategy effectiveness), appendix.

---

## 7. Autonomous Actions (Phase 5)

System proposes and (with approval) executes real-world actions: draft/send emails, fill forms, schedule calls, create documents, set tasks in Construct goal tracker. All actions require explicit user approval via ProposedAction (§2.11).

---

## 8. Configuration

Single canonical config. All inline references point here.

```yaml
session:
  budget_total_usd: null
  budget_daily_usd: 5.00
  budget_alert_threshold: 0.80

models:
  cheap: "claude-haiku-4-5"
  mid: "claude-sonnet-4-6"
  expensive: "claude-opus-4-6"
  tangent: "rotate"
  embedding: "text-embedding-3-small"  # via OpenRouter

providers:
  primary: "anthropic"
  fallback: "openrouter"
  openrouter_models:
    - "deepseek/deepseek-chat"
    - "google/gemini-2.0-flash-001"
    - "meta-llama/llama-3.3-70b-instruct"

schedule:
  mode: "scheduled"
  active_windows:
    - days: ["mon", "tue", "wed", "thu", "fri"]
      start: "23:00"
      end: "06:00"
    - days: ["sat", "sun"]
      start: "00:00"
      end: "23:59"
  timezone: "America/Los_Angeles"
  min_delay_between_steps_ms: 2000
  max_concurrent_threads: 3
  max_steps_per_hour: 60

engine:
  max_thread_depth: 8
  novelty_threshold: 0.30
  dedup_similarity_threshold: 0.85
  diminishing_returns_threshold: 0.25
  diminishing_returns_window: 20

perturbation:
  p_serendipity: 0.15
  depth_scaling: true
  max_perturbation_probability: 0.40
  chain_length: 2
  strategy_cooldown: 3
  forced_diversity_threshold: 5
  news_injection_frequency: "daily"
  cross_session_pollination: true
  user_interest_bridging: true
  strategy_weights:
    analogical: 1.0
    contrarian: 0.8
    persona_injection: 1.0
    negation: 0.6
    geographic: 1.0
    temporal: 0.8
    scale_shift: 0.6
    economics: 0.7
    citation_chain: 1.2
    social_graph: 1.0
    adjacent_community: 0.9
    supply_chain: 0.7
    news_injection: 0.8
    cross_session: 1.0
    user_interest: 0.5
    metaphor: 0.4
    people_deep_dive: 1.0
    failure_post_mortem: 0.9
    second_order: 0.8
    regulatory: 0.7
    academic: 0.8
  persona_list_path: "~/.construct/research/personas.txt"          # ~100-200 entries
  seed_words_path: "~/.construct/research/seed_words.txt"          # ~100-200 entries
  seed_candidates_path: "~/.construct/research/seed_candidates.txt" # system-proposed additions, user reviews

digest:
  schedule: "0 8 * * *"
  auto_generate: true
  max_findings_per_digest: 30
  plan_items: 15

monitors:
  default_schedule: "0 8 * * *"
  default_model: "claude-haiku-4-5"
  max_snapshots_retained: 90
  snapshot_compress_after_days: 14
  auto_spawn_research_threads: true
  auto_propose_monitors: true
  dedup_window_days: 7
  fetch_mode: "playwright"
  max_consecutive_fetch_failures: 3
  rate_limit_detection: true        # auto-detect 429s, CAPTCHAs, backoff
  default_min_interval_hours: 12    # for scraper-sensitive sites
  backoff_multiplier: 2.0           # exponential backoff on rate limit detection

artifacts:
  storage_dir: "~/.construct/research/artifacts"
  budget_per_session_mb: 500
  max_pdf_size_mb: 25
  max_other_size_mb: 10

notifications:
  provider: "email"
```

---

## 9. API Surface

### REST

```
Sessions:  POST|GET /research/sessions, GET|PATCH|DELETE /research/sessions/:id
Threads:   GET /research/sessions/:id/threads, PATCH /research/threads/:id, POST /research/sessions/:id/threads
Findings:  GET /research/sessions/:id/findings, PATCH|GET /research/findings/:id
Plan:      GET /research/sessions/:id/plan, POST /research/sessions/:id/plan/modify
Digest:    GET /research/sessions/:id/digest
Report:    POST /research/sessions/:id/report
Costs:     GET /research/sessions/:id/costs
Monitors:  POST|GET /research/monitors, GET|PATCH|DELETE /research/monitors/:id
Snapshots: GET /research/monitors/:id/snapshots
Alerts:    GET /research/monitors/:id/alerts, PATCH /research/alerts/:id
Run:       POST /research/monitors/:id/run
Actions:   POST /research/sessions/:id/actions, PATCH /research/actions/:id  (Phase 5)
```

### CLI

```bash
# Research
construct research start "topic"           construct research status [session-id]
construct research pause|resume <id>       construct research findings <id> [--top N --sort quality]
construct research plan <id>               construct research plan <id> --veto 3,5 --boost 1
construct research inject <id> "question"  construct research prune|boost <id> <thread-id>
construct research digest [--generate]     construct research report <id>
construct research cost <id>

# Monitors
construct monitor create "query" [--session <id>]    construct monitor list
construct monitor status|pause|resume <id>           construct monitor alerts [--severity urgent]
construct monitor run <id>                           construct monitor configure <id>
```

### MCP Tools

`research_query`, `research_status`, `research_inject`, `research_findings`, `research_plan`, `research_plan_modify`, `monitor_status`, `monitor_alerts`, `monitor_create`

---

## 10. UI Views

**Session Dashboard:** header (title, status, cost, finding count), summary panel, thread tree (color-coded by status, perturbation threads tagged with strategy icons), recent findings feed with inline rating, cost chart, controls.

**Thread Detail:** query, context, findings with quality scores, child threads, notes/feedback, prune/boost/inject.

**Finding Detail:** full content, sources, quality scores, follow-up questions, spawned threads, rating/notes.

**Plan View:** numbered upcoming items with inline veto/boost/note buttons, perturbation items labeled.

**Digest View:** collapsible sections, inline rating, plan with steering actions, "mark all reviewed."

**Monitor Dashboard:** monitor list (title, schedule, alert counts, cost/cycle), unified alert feed, quick-create form.

**Monitor Detail:** editable config, snapshot timeline spark chart, alert history, diff view, cost per cycle.

---

## 11. Data Storage

SQLite, Litestream replication. Tables prefixed `research_`:

```
sessions, threads, findings, steps, plans, plan_modifications,
monitors, monitor_snapshots, monitor_alerts, proposed_monitors,
artifacts (Phase 4), finding_cross_refs (Phase 4),
actions (Phase 5), digests, feedback
```

Key indexes: findings by session+created_at, findings by session+actionability*confidence, threads by session+status+priority, steps by session+created_at, alerts by monitor+status+created_at, snapshots by monitor+cycle_number desc.

Volume (2-week active session): ~50-200 threads, ~500-2000 findings, ~1000-5000 steps, ~10-50 MB. Per monitor (3 months): ~90 snapshots, ~50-500 alerts, ~5-20 MB.

---

## 12. Error Handling

- **API failures:** exponential backoff (3 attempts), provider fallback, log on step, continue
- **Cost overruns:** hard budget pause + notify. Daily limit → sleep until next day
- **Quality degradation:** avg confidence < 0.3 over 10 steps → warning in digest
- **Infinite loops:** max_depth, steps/hour limit, deduplication catches cycles
- **Crashes:** SQLite state survives, resume from last committed step, heartbeat detects stale processes
- **Monitor fetch failures:** skip cycle, retry next. 3 consecutive failures → alert user

---

## 13. Security & Privacy

- API keys in env vars or Construct secrets store, never in DB
- DB local, encrypted at rest (SQLite encryption or full-disk)
- OpenRouter: exclude privacy-sensitive providers via config (e.g., DeepSeek)
- Autonomous actions require explicit approval
- Playwright stealth: stealth plugin, behavioral simulation, per-site sessions, optional proxy. Shared `StealthFetcher` service configured in `~/.construct/playwright.yaml`.

---

## 14. Implementation Phases

### Phase 1: Core Research Loop (MVP)

**Goal:** Working research engine, CLI-driven, background execution, findings viewable in Construct UI.

**Scope:**
- Data models + migrations: Session, Thread, Finding, Step, Plan, PlanModification
- Core execution loop (single-threaded, Anthropic API only)
- Web search + web fetch tool integration
- Basic query formulation (direct + reformulated)
- Finding synthesis and evaluation
- Thread spawning from follow-up questions
- Basic perturbation — 4 strategies (analogical, contrarian, failure post-mortem, temporal shift) at `p_serendipity` probability. Core behavior, not an enhancement.
- Basic deduplication (LLM-based comparison)
- Cost tracking per step
- Research plan generation (ranked queue + rationale, perturbation items labeled)
- CLI: `start`, `status`, `pause`, `resume`, `findings`, `cost`, `plan`, `plan --veto`, `plan --boost`, `inject`, `prune`, `boost`
- Minimal UI: session list, finding list, plan view
- SQLite storage with Litestream backup

**Not in Phase 1:** OpenRouter, multi-model, full perturbation (21 strategies + mechanisms + scheduling), digests/email, monitors, reports, MCP, artifacts, cross-session knowledge, autonomous actions.

**Testing:**
- Unit: data model CRUD, priority calculation, deduplication logic
- Integration: start session → run N iterations → verify threads spawned, findings stored, cost tracked, plan generated
- Integration: run 20+ iterations → verify perturbation threads spawn at ~`p_serendipity` rate with correct origin tags
- Integration: generate plan → apply veto/boost → verify next iteration respects modifications
- **E2E agent test:** start session on real topic ("sourdough bread baking"), 10-15 iterations against live Anthropic API with web search. Verify: findings are substantive, follow-up questions generated, at least one perturbation thread spawned, cost tracked, plan reflects queued threads. Budget: $1-2.
- CLI smoke tests for all commands

### Phase 2: Multi-Model, Scheduling & Monitors

**Goal:** Cost optimization via model routing, overnight execution, full perturbation, monitors.

**Scope:**
- OpenRouter provider abstraction, model tier routing
- Schedule configuration, active windows, daemon execution (pm2/systemd), heartbeat
- Full perturbation system: all 21 strategies, 5 mechanism perturbations, scheduling (depth scaling, forced diversity, chains, cooldown, fruitfulness tracking, session-phase awareness), persona list + seed word dictionary
- Advanced query formulation (all 6 strategies), budget alerts + auto-pause
- Monitor data model + migrations, execution loop, diffing, alert generation, dedup
- Match criteria evaluation (structured + LLM), StealthFetcher service
- Monitor ↔ session linking, auto-spawn threads, ProposedMonitor system
- CLI: `monitor create|list|status|alerts|run|pause|resume|configure`

**Testing:**
- Unit: provider abstraction, model tier routing, schedule window calc, budget enforcement
- Unit: all 21 perturbation strategies produce valid tangent queries given topic + context
- Unit: mechanism perturbations (temp jitter applied, model rotation cycles, seed word in prompt)
- Integration: fruitfulness tracking — simulate high-novelty strategy → verify weight increases
- Integration: monitor cycle → snapshot stored → source changes → alert generated with correct type/severity
- Integration: monitor dedup — reappear same → suppressed; reappear different price → new alert
- Integration: StealthFetcher fetches JS-rendered page, content extracted
- **E2E agent test:** research session, 30+ iterations across multiple model tiers via OpenRouter. Verify: correct models for task types, perturbation fires, budget accurate across providers, pauses at schedule boundary. Budget: $5-10.
- **E2E monitor test:** real search query, 3 cycles with delays, snapshots accumulate, real changes detected. Budget: $0.50.

### Phase 3: Human-in-the-Loop

**Goal:** Review and steering via digest emails and full UI.

**Scope:**
- Digest generation + email delivery (plan, alerts, proposed monitors, cost)
- PlanModification processing pipeline, notification provider interface (email MVP)
- Full UI: session dashboard, thread detail, finding detail, plan view with inline actions
- Finding rating, thread boost/prune, question injection from UI
- Feedback → priority pipeline (including plan mods → perturbation weights)
- Report generation (Opus-tier, including unexpected discoveries + perturbation analysis)
- Monitor UI: dashboard, detail, alert feed, snapshot diff, quick-create

**Future:** Reply-to-email parsing, chat interface for conversational steering.

**Testing:**
- Unit: digest generation (all sections present, plan numbered correctly, costs accurate)
- Unit: email rendering (valid HTML)
- Integration: rate finding → thread priority changes → plan regenerates
- Integration: veto plan item → thread pruned; boost → priority + max_depth increased
- Integration: report from 50+ findings → all sections present, unexpected discoveries identifies perturbation-origin findings
- **E2E agent test:** full cycle — start session → overnight window → digest delivered → apply steering → second window → report. Verify: digest readable, plan references real threads, steering applied, report accurate. Budget: $5-10.
- UI tests (Playwright): navigate dashboard, rate findings, boost/prune threads, veto plan items

### Phase 4: MCP, Integration & Cross-Session Knowledge

**Goal:** Findings accessible to Construct ecosystem and across sessions.

**Scope:**
- MCP server (research + monitor tools)
- Claude Code integration, cross-module integration (findings → goals/tasks)
- sqlite-vec for embedding-based similarity (replaces LLM dedup)
- Cross-session knowledge (global index, context injection, FindingCrossReference)
- ResearchArtifact pipeline with size thresholds
- Export (markdown, HTML, PDF)

**Testing:**
- Unit: sqlite-vec storage/retrieval, similarity thresholds
- Integration: two sessions on related topics → findings from A appear in B's context, cross-references created
- Integration: artifact archival — PDF link → downloaded, stored, metadata recorded. Oversized → skipped
- Integration: each MCP tool returns correct data from mock Claude Code session
- **E2E agent test:** two related sessions ("climate change" + "homesteading"), 10+ iterations each. Cross-session findings discovered. MCP query from Claude Code session. Budget: $5-10.

### Phase 5: Autonomous Actions

**Goal:** Propose and execute real-world actions with user approval.

**Scope:**
- ProposedAction pipeline, email drafting/sending (Gmail MCP or SMTP)
- Calendar integration (Google Calendar MCP), task creation in Construct goal tracker
- Approval workflow UI, action execution engine

**Testing:**
- Unit: action proposal generation, approval state machine
- Integration: actionable finding → email proposed → approved → drafted (verify content) → sent via test SMTP
- Integration: task creation → appears in Construct goal tracker
- **E2E agent test:** session produces actionable findings → relevant action proposed → approve → executed. Test/sandbox accounts for email+calendar. Budget: $3-5.

---

## 15. Example: "Homesteading" Session

**Day 1:** `construct research start "homesteading"` → 6 child threads (land, farming, infrastructure, legal, financial, climate) → 3-5 findings each.

**Days 2-5:** Overnight runs. "Land" branches into regions, markets, financing. "Farming" into permaculture, animal husbandry, preservation. Perturbation spawns "historical communes — what worked and what failed" → unexpectedly high-quality.

**Day 6:** Digest with 47 findings + plan:
```
UPCOMING RESEARCH (tonight, est. $1.82)
 1. Ozarks land prices — specific counties
 2. Permaculture zone planning for Pacific NW
 3. [PERTURBATION] Scandinavian smallholder winter food storage?
 4. First-year homesteader failure stories
 5. Solar panel brand comparisons
 ...
```
`construct research plan <id> --veto 5 --boost 1,3` → skips solar, focuses Ozarks + Scandinavian storage.

**Days 7-14:** Deep dives → counties, water rights, tax rates. Report: 20-page synthesis, 89 sources.

**Day 14:** Auto-proposed monitors accepted: Josephine County listings (daily), Oregon zoning changes (every 3 days). Day 23: $74k parcel with river frontage → "urgent" → auto-spawns thread on county records, flood maps, soil.

**Day 30+:** Proposed action: draft email to Josephine County planning dept re: agricultural zoning. Approved with edits, sent.

---

## 16. Design Decisions

| # | Decision | Detail |
|---|----------|--------|
| 1 | **Vector storage** | Phase 1-3: LLM comparison. Phase 4: sqlite-vec (pure C, ~68ms at 100k vectors). Upgrade: LanceDB if >100k. |
| 2 | **Embeddings** | text-embedding-3-small via OpenRouter. Local Ollama support deferred. |
| 3 | **Notifications** | Email MVP. Provider interface for Slack/Pushover/Ntfy. |
| 4 | **Cross-session** | Global embedding index, context injection, FindingCrossReference. Phase 4. All sessions searchable by default; session isolation deferred to future. |
| 5 | **Users** | Single user only. |
| 6 | **Archival** | Artifacts (PDFs, images, data) below thresholds. Not web pages. LLM-generated summary stored on the artifact record — no OCR/text extraction, just summarization. |
| 7 | **Local models** | Deferred. All inference (including embeddings) via API for now. Local Ollama support is a future optimization. |
| 8 | **Scraping** | Playwright + stealth plugin, behavioral sim, per-site sessions, optional proxy. |
| 9 | **Alert dedup** | Item identity + essential data hash. Same+same within window → suppress. |
| 10 | **Snapshots** | Full, gzip after 14 days. Hashes always uncompressed. |
| 11 | **Auto-propose monitors** | Yes, when thread crosses depth/actionability threshold. |
| 12 | **Perturbation seed data** | Global persona list + seed word dictionary, not session-specific. Start at ~100-200 entries each. System can propose additions discovered during research — appended to a `candidates` file for user review, not auto-added to the active lists. |
| 13 | **Monitor fetch politeness** | Auto-detect rate limiting (429s, increasing latency, CAPTCHA challenges) and exponential backoff. Default fetch interval: every 12 hours for scraper-sensitive sites, daily for tolerant sites. Per-monitor `min_interval` override in config. |
| 14 | **Perturbation A/B testing** | Deferred. Fruitfulness tracking is sufficient for now. Formal A/B framework is a future enhancement. |

