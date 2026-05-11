# Research System Design — Comparative Analysis

## Framing

This document compares the design space for an autonomous deep-research system, drawing on:

- A survey of fifteen inference-time deep-research projects (training-only papers excluded — see methodology at the end)
- Observed question-vs-answer outcomes from ~5 weeks of real queries on the current system

The comparison is organized by feature area. For each area, every surveyed system's approach is listed, and the divergence between approaches is evaluated against the observed failure modes that any new design has to address. The intent is to describe the shape of a system worth building, not to plan a migration from the current one.

Three types of divergence appear throughout: features that are net-new in some comparators (absent from the current system), features that exist in both but differ in implementation, and features that are rare or unique to one or two systems.

---

## Evaluation criteria — observed failure modes

These are the observed failure modes on real queries. They serve as the impact axis for every design decision below.

**F1 — Topic / canon drift.** The system enumerates the wrong base set of things to investigate. A query asking for a comparison of open-source deep-research projects produced sub-queries on deep-learning canon (foundation models, optimizers, ML frameworks) because the topic taxonomy routed it that way. Roughly $0.30 of a $0.50 run was lost before any reactive correction could fire.

**F2 — Output-shape mismatch.** A query that asks for a table, list, or specific layout receives prose that contains the information but not in the requested form. Observed in a comparison-table query about viruses, a "definition + history + best places" query about burgers, and a Bay Area directory query — all returned 50–70 KB of prose with no numbered list or table where one was requested.

**F3 — Silent re-submission.** About 30% of queries in the dataset were re-runs of the same prompt with no annotation (CRDTs ×3, EDM ×2, viruses ×2, Eminem ×2, resume gap ×2, photosynthesis ×2). The system has no surface to capture why the user wasn't satisfied; the strongest dissatisfaction signal in the data is invisible to the engine.

**F4 — Yield collapse without early stop.** Long runs near-universally end up flagged with low finding yield and thread skew, but only after the budget is spent. The system doesn't model whether the next cycle is worth running.

**F5 — Post-mortem misses obvious failure.** The clearly-wrong topic-drift run mentioned in F1 was marked "pass" by the post-mortem. The current evaluation measures yield, balance, and shape-completeness in shallow ways, but doesn't measure on-topic-ness or alignment with user intent.

**F6 — No mid-run intervention.** Once submitted, a user can cancel but not steer. Early-cycle drift becomes a sunk cost. Inferred parameters can be edited before the run kicks in, but that surface stops being effective within the first minute.

**F7 — Expensive abandoned long runs.** Every long run reaches the 60-thread cap at $0.50–$0.80, and most are abandoned because the result didn't match the requested shape. The compute is spent, the answer is unused.

---

## 1. Plan shape and lifecycle

How the system decides what to investigate, when it commits, and when it re-plans.

| System | Approach |
|---|---|
| EDR (Salesforce) | Master Planning Agent does adaptive LLM-driven decomposition; LangGraph workflow holds state |
| ResearStudio | Hierarchical Planner-Executor writes the plan to a live "plan-as-document" served over a streaming layer |
| WriteHERE | Recursive task graph; three task types (Retrieval, Reasoning, Composition) interleave without a predetermined outline |
| WebWeaver | Outline is the primary data structure; planner edits the outline per evidence batch |
| WebResearcher | Evolving report rewritten each iteration; MDP framing where the report is the working state |
| ReSum | No explicit planner; planning is implicit in the summarization-and-continue cycle |
| Open Deep Search | Two LLM roles: orchestrator (decides next action) and search interpreter |
| Tongyi DeepResearch | Single end-to-end trained model; ReAct mode vs. IterResearch "Heavy" mode (iterative summary) |
| Multimodal DeepResearcher | Four-stage pipeline: research, exemplar textualization, planning, multimodal generation |
| CORAL | Plan is per-task YAML defined up-front; no in-run planning |
| Agentic Reasoning | Mind-map knowledge graph maintained as the long-horizon plan structure |
| Stop-RAG | MDP framing; planning is implicit in a learned value controller |
| BATS | Budget Tracker drives a "dig deeper vs. pivot" decision |
| Current system | Deterministic mapping from question shape × topic cluster → fixed run plan, with role priming |
| Current plan | Adaptive LLM planning — replaces the shape × topic lookup with a planner call that emits a typed `LoopSchedule` artifact; re-planned at milestone checkpoints |

**Two clusters of divergence emerge.** Most comparators use *adaptive LLM planning* — every planning decision is a model call. The current system uses *deterministic table-driven planning* — one classification call up front, then a lookup. Most comparators treat the plan as a *first-class artifact* — readable, sometimes editable. The current system treats the plan as *internal state* — invisible to the user.

**Impact on observed failures.** Deterministic table-driven planning is faster, cheaper, and reproducible: the same query yields the same plan, which matters for diagnosing failures. Its weakness is its dependence on the routing being right — F1 (topic/canon drift) is a direct consequence of a too-narrow topic taxonomy. Adaptive LLM planning sidesteps this by re-deciding from scratch every cycle, but pays for it with cost and irreproducibility, and doesn't directly help with F2 (output-shape) or F5 (post-mortem misses). Plan-as-artifact is the foundation for F5 and F6 — a post-mortem can diff executed cycles against a planned schedule, and a user can edit a visible plan but not an internal struct.

**For the system.** Adopt adaptive LLM planning. The reproducibility benefit of table-driven planning was honestly attractive but isn't worth the F1 cost: the 6-cluster taxonomy is the root of the topic drift, and widening it to 20 clusters or making it free-text doesn't fix the deeper problem (a lookup table can only encode what its author anticipated). Replace `run-plan.ts`'s `(shape × topic) → RunPlan` lookup with a planner LLM call that takes `(prompt, question_shape, output_shape, envelope)` and emits a typed `LoopSchedule`. The planner produces canon, branch decomposition, per-branch budgets, and which perturbation strategies to favor. Same prompt twice may produce different plans — that's the trade. Two properties survive: (1) **engine-layer determinism** — input-hash dedup, dispatch order, and render-from-artifacts stay deterministic, which is what makes crash-resume, forkable runs, and stable replay possible; (2) **typed `question_shape` and `output_shape`** — kept as planner *inputs* and renderer *constraints*, not as lookup keys. URL detection in the prompt feeds the planner as a grounding signal rather than a separate code path. Promote the plan to a first-class persisted artifact (`kind: 'schedule'`) so it's diffable and editable.

---

## 2. Mid-run steerability

Whether and how a user can intervene during a running query.

| System | Approach |
|---|---|
| EDR | Steering integration accepts free-form commands during a run; planner consumes them and rewrites state |
| ResearStudio | Pause / edit plan / edit code / run custom commands / resume. Three modes: AI-led, human-assisted, human-led |
| CORAL | Heartbeat CLI subcommand can inject reflection prompts or trigger skill consolidation mid-run |
| Most others (WriteHERE, WebWeaver, WebResearcher, Open Deep Search, Tongyi, ReSum, Stop-RAG, BATS, Agentic Reasoning, Multimodal DR) | None. Submit and wait for completion or cancel |
| Current system | None. Cancel only |
| Current plan | None planned |

**Three of fifteen comparators have any mid-run intervention surface.** EDR and ResearStudio go furthest; CORAL has a narrow injection path. Most systems run to completion without intervention.

**Impact on observed failures.** This is the single highest-leverage feature against observed failures. F1 (topic drift), F2 (output shape), and F7 (expensive abandoned runs) are all catchable in the first one to three cycles if the user can see the plan and edit it. F6 is the failure itself. The two comparators with full pause/edit/resume both name this explicitly: ResearStudio describes it as the difference between "fire-and-forget" and "controllable." That description matches the observed pain — most long runs in the dataset are abandoned, meaning the user already wanted to intervene but couldn't.

The lesser frequency of mid-run controls in the survey is partly explained by the comparators being academic prototypes optimizing for benchmark scores, where human intervention is methodologically inconvenient. For a tool meant to be used, the absence is harder to defend.

**For the system.** A pause-and-edit primitive at every planning checkpoint, applied to the same artifact the planner produces. The user sees the plan that's about to run, edits it (shape, topic, sources, branching factor, depth, budget), and resumes. Pause should not require a new state machine if the engine is already cooperative-cancellable at cycle boundaries; the artifact-based plan is the resumable handle.

A weaker version (steering by free-form text injected mid-run, as in EDR) is interesting but lower-yield against the observed failures: most of those failures need *structural* edits (different shape, different topic, different source mix), not natural-language nudges.

---

## 3. Branching and sub-task spawning

How a system decides to investigate more than one thread of inquiry.

| System | Approach |
|---|---|
| WriteHERE | Recursive task graph; sub-tasks spawn at any depth via decomposer LLM call |
| EDR | Specialized agents per source type (General, Academic, GitHub, LinkedIn); branching is per-agent assignment |
| WebWeaver | Outline sections as branches; planner-driven, not reactive |
| WebResearcher | Single thread; iteration replaces branching |
| Open Deep Search | Single orchestrator; branching is implicit in tool-use loop |
| Tongyi DeepResearch | Single agent, two modes; no explicit branching |
| ReSum | Single thread with periodic compression |
| CORAL | Multi-agent (configurable agent count); each agent runs its own attempt in a git worktree |
| Stop-RAG | Single thread, learned policy on continue/stop |
| Agentic Reasoning | Three agents (mind-map, search, reasoning) running in coordination, not branching per se |
| Multimodal DR | Pipeline stages, not branches |
| Current system | Reactive branch spawning from findings via perturbation strategies; flat tree, parent-child by single hop; priority-ordered queue with concurrency cap |
| Current plan | Same reactive model, with perturbation promoted from defensive to primary derivation; up-front schedule estimates branching factor |

**The current system is the only one in the survey that spawns branches reactively from findings.** Most comparators spawn proactively from the planner or use a recursive task graph that decomposes top-down. CORAL spawns multiple parallel attempts of the same task, which is a different concept — attempt-level branching, not query-level branching.

**Impact on observed failures.** Reactive branching is a genuine differentiator that the survey neither validates nor contradicts. Against the observed failures, reactive branching contributes to F4 (yield collapse): if early findings are off-topic, the branches spawned from them compound the error. Recursive task-graph approaches (WriteHERE) would handle F2 better for composition-heavy queries (the structure forces an outline), but at the cost of much higher per-query LLM use.

The current branching model isn't the cause of any observed failure on its own, but it amplifies upstream failures. If the canon enumeration is wrong (F1), reactive branches lock in the wrong direction faster than a planner-driven model would.

**For the system.** Keep reactive finding-driven branching as the main mechanism — the survey gives no evidence that it's worse than the alternatives, and it expresses query-shape adaptation well. But make branching budget visible at plan time: how many derivation-spawned branches the schedule will allow given the envelope, the perturbation strategy weights, and the topic. Currently the planner doesn't know about derivation budget at all, which means the up-front plan and the actual run drift independently. A predicted derivation count at plan time lets the planner trade depth-on-fewer against breadth-on-more.

Recursive sub-loops (the WriteHERE pattern) should be available for opt-in by templates that need it (long-form composition), not baked into the engine.

---

## 4. Context and working memory

How accumulated findings, prior reasoning, and intermediate state are fed back into subsequent cycles.

| System | Approach |
|---|---|
| ReSum | Periodic summarization tool invoked between rounds; subsequent reasoning runs against the summary, not raw history |
| WebResearcher | Evolving report rewritten each iteration; the report is the working state |
| Tongyi DeepResearch (IterResearch Heavy mode) | Iterative summarization at each step; test-time scaling via compression |
| Agentic Reasoning | Mind-Map knowledge graph maintained as structured long-horizon memory |
| WebWeaver | Focused workspace per cycle plus the outline; outline carries forward |
| EDR | LangGraph state object; full history retained |
| Open Deep Search | Full history retained in context |
| WriteHERE | In-memory state module; full history |
| CORAL | Files in `.coral/` directory + git history |
| Stop-RAG | Full history; the value controller decides whether more retrieval helps |
| BATS | Budget-aware; doesn't compress |
| Multimodal DR | Pipeline stages pass artifacts forward |
| Current system | Each thread accumulates context up to context window; no engine-level compression |
| Current plan | Milestone artifacts are user-facing summaries; subsequent cycles still see prior artifacts directly |

**A clear architectural split.** Four systems (ReSum, WebResearcher, Tongyi Heavy mode, Agentic Reasoning) make compression a primary operation. The rest carry full state forward. Compression unblocks long envelopes by decoupling cycle count from context window size.

**Impact on observed failures.** None of the observed failures are caused by context window pressure. The bottleneck is yield, not window size. Compression would help if envelopes grew into overnight territory where dozens of cycles accumulate, but no run in the dataset hit that ceiling — they hit cost or shape-mismatch first.

**For the system.** Don't make compression a primary operation. The argument for it is future-tense (longer envelopes than are currently run) and the design cost is modest, but adding a primary operation for an unmotivated need is the kind of thing that compounds into systemic complexity. Re-evaluate when a query pattern emerges that actually pressures the window.

Keep the milestone-summary pattern in the plan; treat it as user-facing artifact only, not as working context. If compression becomes useful later, it slots in as a window strategy that templates can declare without disturbing the rest of the design.

---

## 5. Stopping rule

When the system declares the run done.

| System | Approach |
|---|---|
| Stop-RAG | Iteration framed as finite-horizon MDP; learned value controller decides continue vs. stop per round |
| BATS | Budget Tracker; framework decides dig-deeper vs. pivot based on remaining budget |
| EDR | Adaptive — reflection mechanism stops when gaps close; budget cap as backstop |
| ResearStudio | Modal — human-led mode lets the user stop; AI-led runs to a configured limit |
| WriteHERE | Composition-driven — stops when document is "complete" by writer-LLM judgment |
| WebWeaver | Stops when outline is fully cited |
| WebResearcher | Stops at MDP terminal condition (configured) |
| ReSum | Fixed iteration count or external signal |
| Open Deep Search | Fixed iteration count per role |
| Tongyi DeepResearch | Heavy mode has a fixed cycle budget; ReAct stops when model emits final |
| CORAL | Per-task time/budget caps; grader determines pass/fail |
| Agentic Reasoning | Stops when the mind-map "converges" by LLM judgment |
| Multimodal DR | Pipeline completes when all stages finish |
| Current system | Iteration count, budget, depth — hard-coded caps; stuck-state heuristic via similarity |
| Current plan | Adds shape-driven completion (e.g. "list shape needs ≥10 items") and milestone-driven envelope checks |

**Three patterns.** Hard caps (most comparators, current system). Learned value controller (Stop-RAG). Adaptive heuristic (EDR's reflection, BATS's budget-aware). The current plan adds a shape-completeness clause — a specific form of adaptive stop.

**Impact on observed failures.** F4 (yield collapse without early stop) is the direct target. F7 (expensive abandoned long runs) is related — many of the long runs in the dataset were near-stationary by cycle 30 but ran to cycle 60 because no stopping rule modeled marginal value. A value-based stop would address both, but it's also the highest-risk addition: a bad scorer is worse than no scorer, because it'll stop runs that were about to find the key insight.

Shape-completeness alone (current plan) doesn't help with F4. A run can hit a completeness criterion (10 items found) while still being on the wrong topic (F1) or wrong shape (F2). Shape-completeness should be necessary, not sufficient.

**For the system.** A composite stopping rule with three clauses, any of which can trigger:

- *Envelope exhausted* — the configured cap (time, cost, cycles, sources) is reached.
- *Shape completed* — the requested output shape has the artifacts it needs (list has N items, table has its rows, timeline has its dates).
- *Marginal-value floor* — accumulated cycles aren't producing novelty. This is the riskiest clause and should be conservative: stop only when the last few cycles have produced no new sources, no new findings above a similarity threshold, and the planner's own confidence has plateaued. Errs toward continuing.

The learned value-controller approach (Stop-RAG) is interesting but out of scope: a heuristic version is enough for the observed failures, and the value-controller assumes training data that doesn't exist for this system.

---

## 6. Source and tool specialization

Whether the system uses one general-purpose search path or differentiates by source type.

| System | Approach |
|---|---|
| EDR | Four named search agents (General, Academic, GitHub, LinkedIn), each with its own prompt and provider config |
| Open Deep Search | Default mode (single SERP) vs. Pro mode (deep scrape + rerank); per-role model IDs configurable |
| OpenDeepSearch (the broader project) | Plug-in rerankers (Jina, Infinity), plug-in providers (Serper, SearXNG) |
| CORAL | Plug-in coding agents as runtime (claude_code, codex, cursor, kiro, opencode) |
| Multimodal DR | Charts and visualizations as a distinct output channel |
| Most others (WriteHERE, WebWeaver, WebResearcher, ReSum, Tongyi, Stop-RAG, BATS, Agentic Reasoning, ResearStudio) | Single web search path; no source-type specialization |
| Current system | Single search provider; one model role per session |
| Current plan | Same; source-list ingestion is an open question |

**Source-type specialization is rare but valuable where present.** EDR has the cleanest implementation: each agent is a different prompt + provider. Open Deep Search exposes it as configuration. Most systems don't bother because they're benchmarked on web-search-only tasks.

**Impact on observed failures.** Several observed failures are downstream of treating every query as a generic web search. The Bay Area directory query (688 sources, mostly noise) needed a directory-source-type processor that knows what a directory listing is. The burger query (50 KB of prose, no list) needed a restaurant-source processor. The Awesome-DR query (F1 case) needed a GitHub-aware processor that would have recognized the input as a curated link list rather than expanding into adjacent canon.

Source-type specialization wouldn't fix F1 directly — that's a planning-stage failure — but it would reduce the cost of the failure: even if the wrong canon was enumerated, GitHub-aware processors on the right sources would have caught it faster.

**For the system.** Typed processors per source type — web search, academic, code repository, directory, PDF, structured data. Each has its own prompt, its own provider stack, and its own extraction logic. The planner chooses the processor mix based on shape, topic, and any source-list hints (e.g. URL in the prompt). This is largely additive to the planning model — the plan just gains a processor-mix field — and the per-processor cost is small.

The operational cost is real and ongoing: more provider credentials, more rate limits to track, more failure modes per query. Worth it for the quality lift on directory- and code-shaped queries.

---

## 7. Output format and multimodality

Whether the system can produce charts, tables, structured outputs in addition to prose.

| System | Approach |
|---|---|
| Multimodal DeepResearcher | Formal Description of Visualization (FDV) — charts as structured text generated by the LLM and rendered into the report; 82% win rate over text-only |
| EDR | Dedicated Visualization Agent |
| Most others | Markdown / prose only |
| Current system | Markdown report; output shape field exists in the schema but is unpopulated and unenforced |
| Current plan | Markdown report; renderer hook is generic but no plan element pushes for richer outputs |

**Two comparators have multimodal output as a primary capability.** Both report substantial quality gains over text-only on appropriate query types.

**Impact on observed failures.** F2 (output-shape mismatch) is the most direct target, but the relevant shape mismatches in the dataset are mostly table-and-list, not chart-and-visualization. The HSV/HPV query wanted a specific table; the burger query wanted a numbered list; the Bay Area volunteering query wanted an enumerable directory. None of these need Vega-Lite-grade charting; they need shape enforcement at the renderer.

Chart support is a future-tense win that would matter for quantitative-topic queries (markets, trends, statistics) that the current dataset doesn't contain much of. The riskier issue with cheap LLM-generated charts is that they're often wrong or misleading — a chart with hallucinated data is worse than no chart.

**For the system.** Output-shape enforcement is non-negotiable: the system commits to producing a specific shape (prose, table, list, timeline, mixed) and the renderer gates "done" on that shape being satisfied. The shape is inferred from the question at session creation and exposed to the user before the run starts (with the same inferred-then-editable pattern that's already proven for other inferred fields).

Multimodal output (charts, structured visualizations) is interesting but speculative against the current failure data. It would slot in as additional artifact kinds the renderer can interleave; design the renderer to accept them, but don't build the chart-generation pipeline until a query domain demands it. Verification logic is the gating concern, not rendering.

---

## 8. Persistent state model

How the system stores cycles, artifacts, and history.

| System | Approach |
|---|---|
| EDR | LangGraph state object serialized to a session store; cross-session continuity via session_id |
| CORAL | Filesystem under `.coral/` directory; markdown + YAML + git history per attempt |
| WriteHERE | In-memory state module; serialization optional |
| Most others | Per-process memory; serialization is incidental |
| Current system | Relational database (SQLite) with typed tables for threads, findings, sources, post-mortems |
| Current plan | Consolidated relational schema: loops, cycles, artifacts, cycle ledger, milestones |

**The current system is the only comparator with a real relational query layer.** Every other system stores state as files, in-memory dicts, or framework-specific state objects. The advantage is queryability: "find me every query that mentioned topic X" is trivial; "did this run produce findings similar to a prior run" is trivial. None of the other comparators can answer those without a full scan.

**Impact on observed failures.** F5 (post-mortem misses obvious failures) is the most direct target. A relational store lets the post-mortem cross-reference accumulated history — has this query been re-run? Did prior runs produce different artifacts? — which is exactly what's missing when the system marks a clearly-failed run as "pass." F3 (silent re-submission) is detectable only with cross-session memory; the current schema can detect it, but no current hook acts on it.

The trade-off most comparators take (file-based or state-object storage) trades query power for flexibility. For a tool that benefits from accumulating learning over many runs, the trade goes the other way.

**For the system.** Relational store, with payloads typed as opaque JSON only at the artifact-content level. Templates own artifact payloads; the engine never introspects them. The schema is small and stable (loops, cycles, artifacts, cycle ledger, milestones, plans). The query layer is essential to making cross-session reasoning cheap.

Cross-session continuity (the EDR pattern) should be available but off by default: a query can opt into prior context from related runs, but doesn't by default — most queries are not continuations.

---

## 9. Process and concurrency architecture

How the system runs work and survives crashes.

| System | Approach |
|---|---|
| EDR | Single web service (FastAPI / similar); all runs in one event loop; LangGraph checkpointing for crash recovery |
| ResearStudio | Single web service; pause/resume implemented at the framework level |
| Most Python-based (WriteHERE, WebWeaver, ReSum, etc.) | Single process; usually no crash recovery |
| CORAL | Subprocess per agent; git worktree per agent for isolation |
| Current system | Worker pool with claim tokens, heartbeats, scheduler |
| Current plan | One child process per loop, spawned by the API server; cross-loop scheduling delegated to the OS; cycle ledger for crash recovery |

**Two patterns.** Single event loop (most comparators). Subprocess-per-unit (CORAL, current plan). The first is simpler when crashes are rare; the second buys crash isolation at the cost of process-startup overhead.

**Impact on observed failures.** None of the observed failures are process-architecture issues. F7 (expensive runs) is about per-loop cost, not concurrency. The process model is largely orthogonal to the user-facing quality.

The advantage of subprocess-per-loop is purely operational: a crashing loop doesn't take down the API; restarts are isolated; debugging is easier because each loop has its own process. CORAL takes this further with git worktrees. The disadvantage is process-startup overhead (100–500 ms in typical runtimes) — meaningful only at high concurrent loop counts.

LangGraph adoption (the EDR pattern) was considered and skipped: it would require either porting most of the system to Python or adopting a TypeScript port that doesn't yet exist, and the framework nudges toward graph-as-data, which conflicts with the "templates as code, not as data" principle.

**For the system.** Subprocess-per-loop, with the engine cooperative-cancellable at cycle boundaries (this is the prerequisite for pause/edit/resume in section 2). Crash recovery via cycle ledger: restart picks up at the first un-finalized cycle. No worker pool, no claim tokens, no heartbeats — the process boundary is the isolation boundary.

Under high concurrent monitor load, process startup becomes the bottleneck; benchmark before committing to "respawn on tick" for any periodic re-run pattern. A persistent worker for monitors might be worth it if the count grows.

---

## 10. User configurability surface

What knobs the user can set, and when.

| System | Pre-run knobs | Mid-run controls |
|---|---|---|
| EDR | Query; agent selection probable | Free-form steering commands |
| ResearStudio | Query; mode (AI-led / assisted / human-led) | Pause / edit plan / edit code / run custom commands / resume |
| WriteHERE | Query; writing mode (fiction / technical) | None |
| Open Deep Search | Query; mode (default / pro); per-role model IDs as env vars; search provider; reranker | None |
| CORAL | YAML per task: agent runtime, agent count, agent model, workspace, grader timeout | Heartbeat injection |
| Tongyi DeepResearch | Query; mode (ReAct / Heavy) | None |
| WebWeaver / WebResearcher / ReSum | Query; max iterations; model | None |
| Current system | Query; shape and topic editable post-submit; budget, model, max depth editable post-submit before run; 5 shape-template buttons that pre-fill prompt | None |
| Current plan | Envelope preset (3 choices) + template picker; envelope custom panel reveals time, cost, cycles, source list | None |

**Per-query knobs are universally minimal.** Most comparators have one to three fields. The current system's "engine guesses, user corrects" pattern (inferred shape and topic, with editable fields) is uncommon in the survey — no other system has anything like it. ResearStudio's three-mode toggle is the closest analog. Open Deep Search exposes the most configuration but it's setup-time, not per-query.

The current plan's UX direction would reduce the per-query surface (lose the inferred-then-editable fields, keep only envelope presets). This is at odds with the survey: the inferred-then-editable pattern is one of the current system's actual differentiators.

**Impact on observed failures.** F2 (output shape) is the most direct target — exposing output shape as an inferred-then-editable field would have fixed the HSV/HPV, burger, and volunteering failures. F1 (topic drift) is partly addressable here too — if the topic field is editable and the user sees an unhelpful cluster routing, they can correct it before the run starts.

F6 (no mid-run intervention) is the larger gap, but the configurability surface and the mid-run surface should reuse the same UI: the editors for shape, topic, budget, and so on should be available both pre-run and during pause. That makes pause/edit/resume a natural extension of the entry surface rather than a separate UI to build.

**For the system.** Keep the inferred-then-editable pattern; extend it with output shape as a first-class field. Add envelope presets (quick / deep / custom) for the budget/duration row. Reuse the same field editors for the pause/edit/resume flow. Surface a small "advanced" expander for the perturbation strategy weights and similar internals; users who understand them benefit from access, users who don't get good defaults.

A few internal fields that today are not user-touchable but probably should be: branching factor, derivation strategy weights, source-list overrides. None of these need to be prominent; they should be reachable.

---

## 11. Quality evaluation

How the system decides whether a run succeeded.

| System | Approach |
|---|---|
| CORAL | Git post-commit hook auto-runs grader; leaderboard per attempt; web dashboard |
| EDR | Reflection mechanism detects knowledge gaps; updates research direction mid-run |
| Open Deep Search | Dedicated evaluator model role (`LITELLM_EVAL_MODEL_ID`) |
| RAG-Gym | "Critic axis" — separate scorer over completed artifacts |
| Most others | None at the framework level; quality measured externally on benchmarks |
| Current system | Post-mortem hook runs after each job; iteration-check hook detects stuck states mid-run |
| Current plan | Post-mortems retained for development feedback; reviews surface folded away |

**Two distinct ideas conflated.** *Evaluation as scoring* (CORAL's grader, RAG-Gym's critic) is for benchmark-style quality measurement — was the answer right? *Evaluation as introspection* (EDR's reflection, the current system's post-mortem and iteration check) is for run-internal quality control — should we continue, did this work, what went wrong?

The current system has both forms but the introspection version is the weaker one. Iteration-check looks at yield and stuck-ness via similarity heuristics; post-mortem looks at yield, balance, and shape-completeness shallowly. Neither measures alignment with user intent.

**Impact on observed failures.** F5 is the direct failure of this feature area. The clearly-wrong topic-drift run was marked "pass" because the post-mortem doesn't ask "did this answer the question that was asked?" It asks lower-order questions (did we find findings, was thread time balanced, did the shape get filled). All of those can be "yes" while the answer is wrong.

A useful introspection step is a single LLM call at post-mortem time that re-reads the original prompt and the produced document and answers "did this answer the question asked, in the form requested?" It's one cheap call per run, but it's the missing piece — it's the only thing that would catch F5.

CORAL-style leaderboards don't help here: they're designed for competitive coding tasks where attempts are directly comparable. Research queries aren't comparable that way.

**For the system.** Two-tier evaluation. *Intra-run* checks (yield, balance, novelty) drive the marginal-value clause of the stopping rule (section 5). *Post-run* introspection includes an intent-alignment check via a single dedicated LLM call: re-reads the prompt, reads the document, returns a structured judgment with flags. This is also where F3 (silent re-submission) is detectable — if the same prompt has been re-run within a short window, the intent-check has cross-session signal to consider.

A continuous evaluator agent (Open Deep Search's pattern) was considered: per-cycle critic LLM calls. Skipped — the same signal at post-mortem time is sufficient for the observed failures, and the per-cycle cost is significant.

---

## 12. Question classification (shape, topic, role)

How the system categorizes incoming queries to drive downstream decisions.

| System | Approach |
|---|---|
| None of the comparators | No typed question-shape detection; no topic clustering; no role priming |
| Current system | One LLM call at session creation infers question shape (7 typed shapes), topic cluster (one of 6), and applies role priming based on the topic × shape combination |

**This is unique to the current system.** No comparator in the survey has typed question shapes, topic-based routing, or role priming. The closest analog is EDR's adaptive decomposition, which doesn't produce a typed shape — it just decomposes into sub-questions.

**Impact on observed failures.** F1 (topic / canon drift) is a direct consequence of the topic taxonomy being too narrow. Six fixed clusters route everything outside the operator's known interests to "miscellaneous." The cluster system encodes a prior, and the prior is too tight.

F2 (output shape) and F1 share the question-classification mechanism but exercise it differently: shape detection is mostly working, but output shape (table vs. list vs. prose) is a separate inferred field that exists in the schema and is never populated.

The deterministic routing has a property no comparator achieves: reproducibility. Same query → same plan, every time. That's valuable for diagnostics, debugging, and longitudinal evaluation — but it's not load-bearing for a single-operator tool, and it's bought at the cost of F1.

**For the system.** Keep the typed `question_shape` detection (7 shapes) and role priming — both are genuine differentiators and remain useful as planner inputs and renderer constraints. **Delete the 6-cluster topic taxonomy entirely** — not "widen to 20 clusters" or "make it free-text," but drop it from the schema. The adaptive planner (see §1) replaces the lookup; it doesn't need a cluster label to plan. Detect URL-grounded queries (when the prompt contains a URL, fetch it and supply its contents as canon seed to the planner). Canon enumeration moves inside the planner — for comparison queries on a user-provided source list, the planner sees the list and uses it as canon without inventing adjacent topics.

Add output shape as a populated, inferred, editable field, distinct from question shape. Question shape governs how to investigate; output shape governs what to produce. Both are planner inputs and renderer constraints.

**What's traded.** Plan-layer reproducibility — same query produces a fresh plan each time. **What's kept.** Engine-layer determinism (input-hash dedup, dispatch order, render-from-artifacts), typed shape detection, and role priming. The diagnostic value of "what plan did the engine pick last time" comes back via the schedule-as-artifact persistence: every plan is recorded as an artifact and visible in the loop history, just not byte-identical across re-runs.

---

## 13. Exploration strategy

How a system generates diversity in its sub-queries to avoid premature convergence.

| System | Approach |
|---|---|
| None of the comparators | No comparable inference-time strategy menu. Some training papers (skipped) explore similar ideas as RL objectives |
| Current system | 21 perturbation strategies in 5 categories, with cooldown, depth-scaling, forced-diversity threshold, and phase-aware weighting (breadth-early, depth-late) |
| Current plan | Promotes perturbation from defensive state machine to primary derivation mechanism |

**Also unique.** The survey turned up nothing comparable as an inference-time mechanism. Perturbation-style ideas exist in the training literature but as objectives, not as runtime strategy menus.

**Impact on observed failures.** F4 (yield collapse) is the most direct concern. The current data shows yield collapse near-universally on long runs, which suggests the perturbation strategies aren't generating enough novelty late in runs — possibly because the strategy weights underweight novelty-seeking in late phase, possibly because the forced-diversity threshold doesn't fire often enough. The plan's promotion of perturbation to primary derivation may help, but the strategy weights themselves should be reviewed against late-run yield data.

The phase-aware weighting (breadth-early, depth-late) is the right shape but assumes the early phase succeeded in finding the right breadth. When canon enumeration is wrong (F1), breadth-early phase consolidates into the wrong direction faster, and depth-late phase compounds it. The fix is upstream (sections 1, 12), but the perturbation system could carry a fallback: if late-phase yield collapses, trigger a high-novelty perturbation burst rather than continuing depth-phase strategies.

**For the system.** Keep the strategy menu and the phase-aware weighting. Add a yield-collapse fallback: when intra-run yield drops below a threshold over the last N cycles, force a perturbation burst with high-novelty strategies regardless of phase. This is the perturbation system reacting to its own ineffectiveness, which is meta-stable in a way the current implementation isn't.

The strategy weights should be auditable: the operator should be able to see, for a given run, which strategies fired how many times, and which produced findings vs. which were dead ends. This feeds back into tuning.

---

## What this leaves us with

A research system characterized by:

- *Deterministic question classification* with typed question shapes, a richer topic taxonomy, role priming, and explicit detection of URL-grounded queries. Reproducible same-query-same-plan behavior. Output shape is a first-class inferred-then-editable field, distinct from question shape.

- *Plan as first-class artifact*, persisted, diffable, editable. Generated from the inputs and re-generable on edit. Replaces internal-struct planning.

- *Pause-and-edit primitive* at every cycle boundary, reusing the entry surface's field editors. Cooperative cancellation at cycle boundaries is the engine-side prerequisite.

- *Reactive finding-driven branching* with planner-visible derivation budgeting, and a yield-collapse fallback in the perturbation system.

- *Composite stopping rule*: envelope exhausted, or shape completed, or marginal-value floor breached. The marginal-value clause is conservative — stop only when last-N cycles produce no new sources, no new findings, and no planner-confidence movement.

- *Typed processors per source type* (web, academic, code repository, directory, PDF, structured). Planner picks the mix. Single web search remains the default for queries that don't trip a specialization.

- *Output-shape enforcement at the renderer*. Final-render gate rejects "done" if the shape isn't satisfied. Multimodal output is reserved for templates that need it.

- *Relational state model* with opaque artifact payloads. Cross-session continuity is opt-in, off by default.

- *Subprocess-per-loop process model*, cycle-ledger crash recovery, no worker pool. OS schedules.

- *Inferred-then-editable configurability surface* extended with output shape and envelope presets. Same field editors used pre-run and during pause.

- *Two-tier evaluation*: intra-run checks drive the stopping rule's marginal-value clause; post-run introspection includes a single intent-alignment LLM call that reads prompt + document and judges alignment. F3 (silent re-submission) detection lives here.

- *Perturbation strategy menu* with phase-aware weighting, depth-scaling, forced diversity, and a yield-collapse fallback that overrides phase weighting when novelty stalls.

Features explicitly *not* included: periodic context compression as a primary operation, recursive task-graph scheduling at the engine level, multimodal chart generation, continuous evaluator agent, LangGraph adoption, full MCP tool ecosystem, learned value controller for stopping, leaderboard / eval-on-commit infrastructure. Each was evaluated and skipped for the reasons in its section.

---

## Methodology

**Source set.** The non-training shortlist from a current survey of deep-research papers, plus the inference-mode sections of papers whose primary contribution was training. 31 training-only papers were excluded — they ship trained models rather than inference-time architectures, and nothing in them is implementable without a training pipeline. A handful contributed conceptual ideas that were folded into the relevant feature area (SmartSearch's per-query scoring into the stopping rule; HiPRAG's over-search / under-search framing into the marginal-value clause; RAG-Gym's critic axis routed to the evaluation tier rather than the loop engine). Benchmark papers were treated as evaluation surface, not architecture.

**Failure data.** ~5 weeks of queries from the current system, 35 runs total, cost range $0.02 to $0.78. Heavily operator-self-use; some queries are meta-research about the tool itself (the Awesome-DR case being a notable example). The failure distribution may not generalize to a broader user base; treat the data as directional rather than statistical. Re-baseline when the dataset grows.

**Confidence.**
- High on: comparator architectures whose source repositories were readable (EDR, WriteHERE, Open Deep Search, CORAL); the current system; the current plan.
- Medium on: ReSum, WebWeaver, WebResearcher (paper abstracts plus a shared parent-project README without per-project detail).
- Lower on: ResearStudio, Agentic Reasoning, Stop-RAG (repository READMEs unavailable or were usage guides only; working from paper abstracts). The pause/edit/resume conclusion holds independent of the ResearStudio-specific detail because EDR's steering integration corroborates the same pattern.
