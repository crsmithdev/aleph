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

**For the system.** Adopt adaptive LLM planning. The reproducibility benefit of table-driven planning was honestly attractive but isn't worth the F1 cost: the 6-cluster taxonomy is the root of the topic drift, and widening it to 20 clusters or making it free-text doesn't fix the deeper problem (a lookup table can only encode what its author anticipated). Replace `run-plan.ts`'s `(shape × topic) → RunPlan` lookup with a planner LLM call that takes `(prompt, question_shape, output_shape, envelope, mode_preset, role)` and emits a typed `LoopSchedule`. The planner produces canon, branch decomposition, per-branch budgets, perturbation weights, and the milestone plan. Same prompt twice may produce different plans — that's the trade. Two properties survive: (1) **engine-layer determinism** — input-hash dedup, dispatch order, and render-from-artifacts stay deterministic, which is what makes crash-resume, forkable runs, and stable replay possible; (2) **typed `question_shape` and `output_shape`** — kept as planner *inputs* and renderer *constraints*, not as lookup keys. URL detection in the prompt feeds the planner as a grounding signal rather than a separate code path.

**Schedule as the universal loop configuration.** Promote the plan to a first-class persisted artifact (`kind: 'schedule'`) — and grow its payload to cover every per-loop setting, not just the structural plan. Canon, branches, milestones, **plus envelope, models, perturbation config, run flags, and mode metadata** all live on the schedule. The Schedule view in the UI is the universal editor for this artifact (pre-run via Custom mode; mid-run via pause; historical via fork-from-cycle). No separate "advanced" panel exists. **Modes** are named starting templates: picking Quick / Default / Deep / Roam / Bonkers / Dev / Eval / Custom selects which template constructs the initial schedule; after construction the mode label is just metadata, and the schedule is what runs. Locked-field mechanic: every field gets an implicit `locked` flag when a non-planner author edits it, so milestone re-plans respect user edits.

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
| Current plan | **Strong steerability — full ResearStudio-equivalent.** v1 makes the plan visible and explorable in the UI (read-only Schedule view). v2 adds pause/edit/resume *and* a free-form directive channel for nudging the planner without pausing. Three modes the user can move between: AI-led (default), AI-led with nudges (directives queue, planner adapts at re-plan), human-led (pause + edit schedule directly + resume). |

**Three of fifteen comparators have any mid-run intervention surface.** EDR and ResearStudio go furthest; CORAL has a narrow injection path. Most systems run to completion without intervention.

**Impact on observed failures.** This is the single highest-leverage feature against observed failures. F1 (topic drift), F2 (output shape), and F7 (expensive abandoned runs) are all catchable in the first one to three cycles if the user can see the plan and edit it. F6 is the failure itself. The two comparators with full pause/edit/resume both name this explicitly: ResearStudio describes it as the difference between "fire-and-forget" and "controllable." That description matches the observed pain — most long runs in the dataset are abandoned, meaning the user already wanted to intervene but couldn't.

The lesser frequency of mid-run controls in the survey is partly explained by the comparators being academic prototypes optimizing for benchmark scores, where human intervention is methodologically inconvenient. For a tool meant to be used, the absence is harder to defend.

**For the system.** Treat the schedule as a *living artifact* with multiple edit sources. Every author of change — planner, user, AI watcher, self-healing remediation, fork-from-history — produces edits on the same artifact, through the same Schedule view, recorded in the same audit trail. All edits are **checks** (§11) — `(state, trigger) → action[]` with `action: { schedule_edit }` — so the system stays symmetric: a user directive is just a check authored by the user; a watcher's proposed edit is a check authored by an LLM observing the event stream; a self-healing remediation is a check whose condition pattern-matches on a typed failure flag.

The structural-vs-natural-language distinction lives at the *action* level, not the API level. Structural edits surface as `action: schedule_edit` (patch the schedule directly). Natural-language nudges surface as `action: directive` (free-form text the planner reads on its next re-plan). Both flow through `POST /loops/:id/checks`. The Schedule view shows which checks consumed which inputs, so the user sees what their nudge or edit changed.

**Three intervention postures the user can move between** — without a mode picker forcing the choice up front:
- AI-led: no user-authored checks posted; the engine runs autonomously.
- AI-led with nudges: occasional `directive` checks; planner adapts on next re-plan.
- Human-led: `schedule_edit` checks via pause + edit in the Schedule view; user drives, AI executes.

The system is autonomous by default; controls are always present in the UI; the user grabs the wheel when they want to.

**Render the plan in the UI from v1.** The plan being visible is a precondition for it being editable. v1 ships the Schedule view in read-only-during-execution mode + editable in Custom mode (pre-run) and on completed runs (for inspection / fork). v2 turns on the same editor when paused, and lights up user-authored checks. Even without mid-run controls in v1, transparency on what the adaptive planner decided is valuable in its own right.

---

## 3. Branching and sub-task spawning

How a system decides to investigate more than one thread of inquiry.

| System | Approach |
|---|---|
| WriteHERE | Recursive task graph; decomposer LLM call spawns sub-tasks adaptively based on prior task outputs |
| EDR | Specialized agents per source type (General, Academic, GitHub, LinkedIn); reflection mechanism detects knowledge gaps and routes follow-up to the relevant agent |
| WebWeaver | Outline sections as branches; planner edits the outline per evidence batch (findings-reactive at outline granularity) |
| WebResearcher | Single thread; MDP framing — each iteration decides next direction based on prior state including findings |
| Open Deep Search | Single orchestrator running ReAct loop; next tool/query chosen per cycle based on prior results |
| Tongyi DeepResearch (IterResearch Heavy) | Iterative — each iteration's plan reacts to prior summary |
| ReSum | Single thread; subsequent reasoning runs against the periodic summary of prior cycles |
| CORAL | Multi-agent parallel attempts; within an attempt, the coding agent's own loop adapts |
| Stop-RAG | Single thread; value-function reads accumulated retrievals to decide continue/stop |
| Agentic Reasoning | Mind-map agent updates a knowledge graph from findings; search agent reads the graph to pick next search |
| BATS | "Dig vs pivot" decision per cycle, based on budget + signal from prior cycles |
| Multimodal DR | Fixed four-stage pipeline — *not* findings-reactive within a stage |
| Current system | Two adaptation layers: (a) milestone re-plans by the planner LLM reading accumulated findings, (b) rule-based perturbation menu firing between cycles — 21 typed strategies in 5 categories, with phase-aware weighting, cooldowns, forced-diversity thresholds, probabilistic firing, and typed `spawned_from_finding_id` linkage |
| Current plan | Same two-layer model. Perturbation promoted from defensive rate-limited to primary derivation; planner adaptive (per v1) |

**Almost all comparators adapt direction based on findings.** The earlier framing of "the current system is the only one that spawns reactively from findings" was wrong. The distinction is *mechanism*, not whether-it-adapts.

**Most comparators use LLM-driven adaptation:** the model reads prior state (findings, accumulated context, summaries) and decides what's next. This is unstructured — the model can produce any next action. The granularity varies: per-cycle (ReAct family — Open Deep Search, Stop-RAG, BATS, Agentic Reasoning, WebResearcher), per evidence batch (WebWeaver), per recursive decomposition (WriteHERE), or per stage (Multimodal DR is *not* findings-reactive within a stage).

**The current system has two adaptation layers:**
1. **LLM-driven re-plans at milestones** (per the v1 adaptive planner) — same pattern as the comparators, occurring every 25 % of envelope. Handles "the answer needs a different shape."
2. **Rule-based perturbation between cycles** — typed strategy menu (analogical, contrarian, scale_shift, citation_chain, etc.) with structured firing rules. Handles "inject diversity here" / "shift to a different scale" without paying an LLM-decision cost per firing. The LLM is involved only in *framing* the resulting query under the chosen strategy, not in *deciding* to fire.

The perturbation layer is the genuine differentiator. No comparator has an inference-time strategy menu. The closest analogs (ZeroSearch, HiPRAG, Atom-Searcher) are *training-time* objectives — they teach a model to do similar things implicitly. Construct does it explicitly at inference, with the structure visible and tunable.

**Why both layers are complementary.** A pure LLM-driven approach (most comparators) pays a model call per decision and can converge on similar follow-ups across cycles — there's no built-in pressure toward strategy diversity. A pure rule-based approach (no LLM re-plan) can't respond to high-level signals like "this whole branch isn't yielding." Construct having both means cheap diversity injection at cycle granularity plus expensive shape correction at milestone granularity, with each layer doing what it's best at.

**Impact on observed failures.** The two-layer model doesn't directly cause any of the observed failures. Where it interacts with them:
- F1 (topic drift) is upstream of branching — bad canon means perturbation-spawned branches compound the error. Addressed by the adaptive planner (§1).
- F4 (yield collapse) is the reactive-branching downside: if early findings are off-topic, perturbation amplifies. Adaptive milestone re-plans pull the loop back; planner-level depth-vs-breadth decisions become visible (see below).

**For the system.** Keep both layers. They address different signals at different costs. Two concrete refinements:

1. **Make derivation budget visible at plan time.** Currently the planner doesn't know how many perturbation-spawned branches the run will permit given the envelope, strategy weights, and cooldown rules. A predicted derivation count at plan time lets the planner trade depth-on-fewer against breadth-on-more. With the adaptive planner now LLM-driven (v1), this is just an extra input to the planner prompt.

2. **Recursive sub-loops** (the WriteHERE pattern) should be available for opt-in by templates that need it (long-form composition, code-dev with test sub-runs), not baked into the engine. Most templates won't need it.

---

## 4. Context and working memory

How accumulated findings, prior reasoning, and intermediate state are fed back into subsequent cycles.

**Scope note.** "Compression" in this section refers specifically to **engine-side state handling** — what the next cycle's LLM prompt sees when prior cycles have accumulated. It is *distinct from* user-facing milestone summaries (narrative checkpoints the user reads on the loop-detail page). Milestones and engine-side digests can be co-produced at the same checkpoint moments, but they have different audiences (user vs. next cycle's model), different formats (narrative + citations vs. compact structured state), and different lifecycles (milestones persist as deliverables; digests are working state for the planner and processor). The two should be separate artifact kinds.

| System | Approach |
|---|---|
| ReSum | Periodic summarization tool invoked between rounds; subsequent reasoning runs against the summary, not raw history |
| WebResearcher | Evolving report rewritten each iteration; the report is the working state |
| Tongyi DeepResearch (IterResearch Heavy mode) | Iterative summarization at each step; test-time scaling via compression |
| Agentic Reasoning | Mind-Map knowledge graph maintained as structured long-horizon memory |
| WebWeaver | Outline plus an external memory bank of evidence; the writer retrieves only the needed evidence per section via citations rather than carrying full history forward |
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

Keep the milestone-summary pattern in the plan as a v1 deliverable — but explicitly as a **user-facing artifact** (`kind: 'milestone'`), not as the next cycle's working context. The next cycle in v1 still sees prior artifacts directly. When engine-side compression becomes useful later (heavy-modality, overnight envelopes), it slots in as a separate `kind: 'digest'` artifact co-produced at the same checkpoints — same trigger, different consumer, different format. Templates declare a window strategy (`full | digest | digest_plus_recent_N`) to opt into engine-side compression without disturbing the user-facing milestone flow.

---

## 5. Stopping rule

When the system declares the run done.

| System | Approach |
|---|---|
| Stop-RAG | Iteration framed as finite-horizon MDP; learned value controller decides continue vs. stop per round (confirmed in abstract) |
| BATS | Budget Tracker plug-in; framework decides "dig deeper" vs. "pivot" based on remaining budget (confirmed in abstract) |
| EDR | Reflection mechanism detects knowledge gaps and updates research direction (confirmed); whether the run *stops* on gap closure vs. only re-routes is not documented in the README — budget cap is the documented backstop |
| ResearStudio | Three-mode operation (AI-led / human-assisted / human-led); human-led runs are user-terminated (confirmed in abstract); AI-led termination criterion not documented |
| WriteHERE | Long-form composition framework; stop criterion not documented in README — plausibly composition-complete by writer judgment |
| WebWeaver | Stop criterion not documented in abstract; plausibly when the planner's outline is fully populated from the memory bank |
| WebResearcher | MDP framing implies a terminal condition; specifics not documented |
| ReSum | Stop criterion not documented; the summarization paradigm itself doesn't specify one |
| Open Deep Search | ReAct-style termination: model decides when to emit a final answer; iteration caps configurable |
| Tongyi DeepResearch | ReAct mode terminates on the model's final answer; Heavy mode is described as "test-time scaling" without an explicit stop rule in the README |
| CORAL | Per-task time / budget caps in YAML config; grader determines pass/fail (confirmed in README) |
| Agentic Reasoning | Stop criterion not documented in abstract |
| Multimodal DR | Fixed four-stage pipeline; "stop" is just pipeline completion |
| Current system | Iteration count, budget, depth — hard-coded caps; stuck-state heuristic via similarity |
| Current plan | Adds shape-driven completion (e.g. "list shape needs ≥10 items") and milestone-driven envelope checks |

**Three documented patterns.** Hard caps (most comparators, current system — confirmed for CORAL via YAML, plus envelope/iteration caps in most others). Learned value controller (Stop-RAG — confirmed). Adaptive heuristics: BATS's budget-aware dig-vs-pivot is confirmed; EDR's reflection mechanism updates direction but isn't documented to also stop the run. Several other comparators' stopping criteria aren't explicitly documented in their READMEs or abstracts — table entries above flag that. The current plan adds a shape-completeness clause — a specific form of adaptive stop.

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

**The current system is the only comparator with a real relational store.** Every other system stores state as files, in-memory dicts, or framework-specific state objects. The value of the relational store, however, is *not* ad-hoc text-searchability of accumulated runs ("find every query that mentioned X" is not a needed operation). The value is **structural linkability**: relations between queries, concepts (already extracted per-run via `services/concepts.ts`), and sources are explicit foreign keys, not full-text matches. That makes a cross-run knowledge layer — surfacing related prior runs to the user, exploring connections through shared concepts — cheap to build on top.

**Impact on observed failures.** F3 (silent re-submission) is detectable through the relational layer: a small concept-overlap query at session create can surface "we have 3 prior runs with overlapping concepts" before the user re-submits the same thing for the third time. F5 (post-mortem misses) benefits more weakly — the introspection LLM call described in §11 doesn't need cross-session SQL to work; it just needs the run's own artifacts and a re-read of the prompt.

The trade-off most comparators take (file-based or state-object storage) trades structural linkability for setup simplicity. For a tool that accumulates many runs over time, the trade goes the other way.

**For the system.** Relational store, with payloads typed as opaque JSON only at the artifact-content level. Templates own artifact payloads; the engine never introspects them. The schema is small and stable (loops, cycles, artifacts, cycle ledger, milestones, plans). The store's value is structural — concept and source rows link across queries through foreign keys — not text-queryability of content. **No full-text index over findings is required.**

**Cross-run knowledge layer is deferred to the end of the roadmap.** Three layered features, smallest first: (1) a "related runs" panel on the loop-detail page based on concept overlap, (2) cross-run concept and source indexes, (3) a knowledge graph view as a top-level surface. All three reuse the existing per-run concept extraction; the per-run engine just needs to be trustworthy first. See `research-engine-build-plan.md` §v5.

**Cross-session continuity remains opt-in and distinct.** The cross-run layer surfaces related prior runs *as navigation* (clickable links, graph nodes). It does **not** auto-merge prior context into the new run's prompt. Carrying prior context into a new run's working memory is a separate opt-in that no plan element currently pushes for — most queries are not continuations.

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
| Current plan | **8-mode set** (Quick / Default / Deep / Roam / Bonkers / Dev / Eval / Custom — all visible). Mode is a named starting template. `InferredPanel` exposes question_shape, output_shape, mode, role, free-text topic. **Schedule view is the universal editor** for every per-loop knob (envelope, models, perturbation, canon, branches, milestones, flags) — no separate advanced panel | Pause / edit schedule / send directive / fork from cycle — all in v2 as user-authored checks through one API |

**Per-query knobs are universally minimal across the survey.** Most comparators expose one to three fields. "Mode" in the survey papers means very different things on different axes: compute pipeline (Tongyi ReAct vs. Heavy), search depth (ODS default vs. pro), output template (WriteHERE fiction vs. technical), intervention level (ResearStudio AI-led vs. human-led), or envelope (Construct's earlier presets). The current plan's mode is on a different axis again: **mode = named starting template for the schedule artifact**, with no runtime presence after construction.

**For the system.** Radical simplification by collapsing two surfaces into one. The Schedule view that already renders the plan during a run becomes the **universal editor** for every per-loop knob, with three roles: pre-run editing (in Custom mode, or after pausing a not-yet-started loop), mid-run editing (when paused, v2), and historical viewing + fork-from-cycle (completed runs). The schedule artifact's payload grows to contain everything that's currently scattered across `SessionConfig`: envelope, models, perturbation config, run flags, plus the structural plan (canon, branches, milestones). No separate "advanced" panel exists or is needed; advanced controls are just the deeper fields of the same view.

Mode presets are demoted to **named starting templates** — Quick / Default / Deep / Roam / Bonkers / Dev / Eval / Custom. Each constructs an initial schedule with a coherent bundle of envelope + models + perturbation profile + flags. After construction the mode label is metadata (`created_with_mode` on the schedule artifact); the actual behavior is whatever the schedule currently says. The `InferredPanel` keeps the inferred-then-editable pattern for the *query classification* fields (`question_shape`, `output_shape`, `mode`, `role`, free-text `topic`) — those describe the query, not the loop.

Mid-run intervention reuses the same Schedule view editor (when paused) plus a free-form directive channel that doesn't require pause. Both flow through the unified Check primitive described in §11, not as separate APIs.

**Locked-field mechanic.** Every schedule field has an implicit `locked` flag set when a non-planner author edits it. Milestone re-plans respect locks — the planner won't overwrite user-edited fields. The Schedule view shows lock state visually.

**Impact on observed failures.** F2 (output shape) is addressed by exposing `output_shape` as an inferred-then-editable field in the InferredPanel. F1 (topic drift) is addressed by removing the lookup-based topic taxonomy entirely (per §1's adaptive planner) and by making the Schedule view editable so users can correct canon at any time. F6 (no mid-run intervention) collapses into "the user posts a check" — every intervention is the same shape.

---

## 11. Checks (unified evaluation, intervention, and steering)

How the system decides whether something should change — at any granularity, from any author.

| System | Approach |
|---|---|
| CORAL | Git post-commit hook auto-runs grader; leaderboard per attempt; web dashboard |
| EDR | Reflection mechanism detects knowledge gaps; updates research direction mid-run |
| Open Deep Search | Dedicated evaluator model role (`LITELLM_EVAL_MODEL_ID`) |
| RAG-Gym | "Critic axis" — separate scorer over completed artifacts |
| Most others | None at the framework level; quality measured externally on benchmarks |
| Current system | Post-mortem hook runs after each job; iteration-check hook detects stuck states mid-run |
| Current plan | **Unified Check primitive.** A check is `(state, trigger) → action[]`. The same shape subsumes intra-run heuristics, post-run introspection, mid-run user nudges, the watcher agent, and self-healing remediations |

### The Check primitive

```ts
type Check = {
  trigger: 'cycle_boundary' | 'event' | 'milestone' | 'on_finish' | 'on_user_action';
  scope:   'cycle' | 'branch' | 'loop' | 'run';
  author:  'heuristic' | 'llm' | 'user';
  condition: (state) => boolean;
  action: (state) => Action[];
};

type Action =
  | { kind: 'schedule_edit', patch }
  | { kind: 'directive', text, scope }
  | { kind: 'stop', reason }
  | { kind: 'perturbation_trigger', strategy }
  | { kind: 'flag', failure_mode: TypedFailureMode }
  | { kind: 'noop' };
```

Every place where the system decides "something needs to change" is a check. Adaptive stop, redundancy detection, intent-alignment, self-healing remediation, the continuous watcher, the user's pause-and-edit, the user's directive, the user's fork-from-cycle — all express the same way. One audit trail (the event log); one API for user-authored checks (`POST /loops/:id/checks`); one provenance surface (the Schedule view's "edits applied" trail keyed by check-author).

**Conceptual unification:** a user directive is just *a check authored by the user* — same vocabulary as a watcher's suggestion (a check authored by the LLM watching the event stream). The directive channel isn't a special API; it's a check with `author: 'user'` and `action: { directive }`.

### Built-in checks (ship in v2)

| Built-in check | Trigger | Author | Typical action |
|---|---|---|---|
| Marginal-value stop | milestone | heuristic | `{ stop }` when last-N cycles produce no new sources / no novel findings / no planner-confidence movement |
| Redundancy detector | cycle_boundary | heuristic or cheap LLM | `{ perturbation_trigger }` or `{ schedule_edit }` when a cycle's output is highly similar to prior cycles |
| Post-mortem with narrative | on_finish | LLM | `{ flag, failure_mode }` plus a human-readable narrative explaining what triggered |
| Intent-alignment | on_finish | LLM | `{ flag: topic_drift / shape_mismatch }` when the produced document doesn't answer the original prompt in the requested form |
| Self-healing remediations | event (on typed failure flag) | heuristic | `{ schedule_edit }` for known failure modes — `topic_drift` → re-plan canon; `shape_mismatch` → force renderer gate; `yield_collapse` → escalate stop |
| Continuous watcher | event (any of interest) | LLM (suggest-only by default) | `{ directive }` suggestions; or `{ schedule_edit }` in autonomous mode (opt-in) |

### User-authored checks (the universal intervention path)

| User action | Stored as | Effect |
|---|---|---|
| Pause + edit schedule | Check with `action: schedule_edit`, `author: user` | Loop pauses, patch applied, loop resumes from edited schedule |
| Send directive | Check with `action: directive`, `author: user` | Planner reads on next re-plan; doesn't require pause |
| Fork from cycle N | Check on completed run, action produces a new loop with `parent_loop_id` | Branches a new loop from any historical cycle |

### Impact on observed failures

F5 (post-mortem misses obvious failures) is the direct target of the intent-alignment check — re-reads prompt and produced document, returns a structured judgment with typed flags. F3 (silent re-submission) is detectable here too with cross-session signal once v5 indexes are available.

F6 (no mid-run intervention) collapses into "the user can post a check at any time." Every intervention — structural edit, free-form nudge, fork — is the same operation, recorded the same way.

The previous two-tier framing ("intra-run checks vs. post-run introspection") was a useful first cut but disappears once the Check primitive is named — both tiers are checks with different triggers. A continuous evaluator agent (Open Deep Search's pattern) was considered for per-cycle critic LLM calls; that's just a `cycle_boundary` check with `author: 'llm'`, and the cost-benefit suggests reserving LLM-authored checks for milestones and on-finish rather than every cycle.

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

- *Engine-deterministic, planner-adaptive.* Engine plumbing (input-hash dedup, cycle priority dispatch, cycle ledger, render from a fixed artifact set) is deterministic — that's the layer that makes crash-resume, forkable runs, and stable replay possible. Planning is adaptive — each query's `LoopSchedule` is an LLM call rather than a table lookup. Same prompt twice may produce different plans; same artifact set always produces the same render.

- *Typed question classification* — 7 question shapes and a separate inferred output shape, both as planner *inputs* and renderer *constraints*, not as lookup keys. Role priming preserved. URL-grounded queries detected and supplied to the planner as canon seed. The 6-cluster topic taxonomy is deleted entirely.

- *Plan as first-class artifact*, persisted as `kind: 'schedule'`, diffable across re-plans, **rendered as an explorable Schedule view in the UI from v1** (read-only initially; editable when paused). Each re-plan produces a new artifact linked to its predecessor.

- *Strong mid-run steerability* (v2). Two intervention paths: structural (pause + edit the schedule artifact + resume) and natural-language (free-form `directive` artifacts the planner reads on its next re-plan, no pause required). Three modes: AI-led, AI-led with nudges, human-led.

- *Two-layer findings-reactive branching.* Milestone re-plans by the planner LLM (course correction at envelope-percent checkpoints) plus a rule-based perturbation menu firing between cycles (21 strategies with phase-aware weighting, cooldowns, forced-diversity thresholds, probabilistic firing). The planner is also given derivation-budget visibility so it can trade depth-on-fewer against breadth-on-more.

- *Composite stopping rule*: envelope exhausted, or shape completed, or marginal-value floor breached. The marginal-value clause is conservative — stop only when last-N cycles produce no new sources, no new findings, and no planner-confidence movement.

- *Typed processors per source type* (web, academic, code repository, directory, PDF, structured). Planner picks the mix. Single web search remains the default for queries that don't trip a specialization. v3.

- *Output-shape enforcement at the renderer*. Final-render gate rejects "done" if the shape isn't satisfied. Multimodal output is reserved for templates that need it.

- *Relational state model* with opaque artifact payloads. Value is *structural linkability* (concept and source foreign keys across queries), not text-search queryability — no full-text index required. A cross-run knowledge layer (related-runs panel, concept/source indexes, knowledge graph view) is deferred to the end of the roadmap (v5). Cross-session *context-carrying* into a new run is a separate opt-in, off by default.

- *Subprocess-per-loop process model*, cycle-ledger crash recovery, no worker pool. OS schedules.

- *Inferred-then-editable configurability surface* extended with output shape and envelope presets. Same field editors used pre-run and during pause.

- *Two-tier evaluation*: intra-run checks drive the stopping rule's marginal-value clause; post-run introspection includes a single intent-alignment LLM call that reads prompt + document and judges alignment. F3 (silent re-submission) detection lives here.

- *Perturbation strategy menu* with phase-aware weighting, depth-scaling, forced diversity, and a yield-collapse fallback that overrides phase weighting when novelty stalls. Visible to the planner as a constraint to allocate against; visible to the user as a tunable surface.

Features explicitly *not* included: periodic context compression as a primary operation, recursive task-graph scheduling at the engine level, multimodal chart generation, continuous evaluator agent, LangGraph adoption, full MCP tool ecosystem, learned value controller for stopping, leaderboard / eval-on-commit infrastructure. Each was evaluated and skipped for the reasons in its section.

---

## Methodology

**Source set.** The non-training shortlist from a current survey of deep-research papers, plus the inference-mode sections of papers whose primary contribution was training. 31 training-only papers were excluded — they ship trained models rather than inference-time architectures, and nothing in them is implementable without a training pipeline. A handful contributed conceptual ideas that were folded into the relevant feature area (SmartSearch's per-query scoring into the stopping rule; HiPRAG's over-search / under-search framing into the marginal-value clause; RAG-Gym's critic axis routed to the evaluation tier rather than the loop engine). Benchmark papers were treated as evaluation surface, not architecture.

**Failure data.** ~5 weeks of queries from the current system, 35 runs total, cost range $0.02 to $0.78. Heavily operator-self-use; some queries are meta-research about the tool itself (the Awesome-DR case being a notable example). The failure distribution may not generalize to a broader user base; treat the data as directional rather than statistical. Re-baseline when the dataset grows.

**Confidence.**
- High on: comparator architectures whose source repositories were readable (EDR, WriteHERE, Open Deep Search, CORAL); the current system; the current plan.
- Medium on: ReSum, WebWeaver, WebResearcher (paper abstracts plus a shared parent-project README without per-project detail).
- Lower on: ResearStudio, Agentic Reasoning, Stop-RAG (repository READMEs unavailable or were usage guides only; working from paper abstracts). The pause/edit/resume conclusion holds independent of the ResearStudio-specific detail because EDR's steering integration corroborates the same pattern.
