# Research Refocus — Comparative Architecture Doc

**Baseline:** the refocus plan in `docs/plans/research-engine-refocus.md` plus the current code under `src/research/src/`. **Comparators:** the non-training papers from `Awesome-Deep-Research` (the 15-paper shortlist), grounded against each project's README where available and the paper otherwise. Where a project's README didn't load (ResearStudio, Agentic-Reasoning) I worked from the paper abstract and have flagged the lower confidence.

Throughout: **U** = usefulness (low/med/high), **C** = cost estimate (LOC + abstraction tax + ongoing maintenance).

---

## 1. Features

### 1A. Net-new features that exist in external projects but not in Construct (current or refocus plan)

#### 1A.1 Mid-run human steering ("plan-as-document")

| Project | Mechanism (from code/README) |
|---|---|
| **EDR** (Salesforce) | `steering_integration.py` + `simple_steering.py`. Real-time steering commands processed by a LangGraph workflow. React frontend accepts commands while a run is live; the planner consumes them and rewrites subsequent state. |
| **ResearStudio** | Hierarchical Planner-Executor writes every step to a live "plan-as-document" served over a fast streaming layer. User pauses, edits plan/code, runs custom commands, resumes. Three modes: AI-led, human-assisted, human-led. *(Detail from paper abstract — repo README 404'd.)* |
| **CORAL** | Manager watches new attempts; `heartbeat` CLI subcommand "view/modify heartbeat actions" can inject reflection prompts or trigger skill consolidation mid-run. |

**Construct now:** zero mid-run intervention. A research query runs autonomously to completion; the only user-facing levers are session config at submit time (model, budget, max depth) and "cancel."

**Refocus plan:** adds **pre-flight clarification** with a 60 s timeout, but explicitly nothing for mid-run. The "Reviews tab → debug tab" move further reduces mid-run visibility.

**Recommendation:** add `plan-as-document` as a first-class artifact. The plan already commits the `LoopSchedule` at start and re-evaluates at milestone checkpoints — make those checkpoints **editable**: pause → user diff against the schedule artifact → resume with the edited version.

- **U: high.** It's the single most consistent theme across the surviving papers. ResearStudio's claim that it's the difference between "fire-and-forget" and "controllable" is consistent with what Construct users would want for overnight or heavy-modality envelopes where wasted hours are expensive.
- **C: medium.** ~400–600 LOC. New artifact kind (`schedule`), a "pause/resume" state on the loop row, an API endpoint to post a schedule edit, plus UI surface. The hard part isn't the code — it's the **state machine** (running → paused → user editing → running), and the **engine boundary**: the template's processor needs to be cooperative-cancellable, which is a small but real constraint on every future template.

#### 1A.2 Periodic context compression as a primary operation

| Project | Mechanism |
|---|---|
| **ReSum** | Plug-and-play summarization tool invoked periodically; condenses interaction history into a compact summary. Subsequent reasoning runs against the summary, not raw history. |
| **WebResearcher** | "Evolving reports + focused workspaces" — at each iteration the report is rewritten, and the focused workspace is what the next cycle reads. The report *is* the working state. |
| **Tongyi DeepResearch** | `IterResearch 'Heavy' mode` is exactly this pattern — test-time scaling via iterative summarization. ReAct mode for comparison. |
| **Agentic Reasoning** | Mind-Map agent maintains a structured knowledge graph as long-horizon memory (not just a text summary). |

**Construct now:** no compression. Each thread carries its own context (recent findings, prior queries) but there's no engine-level operation that says "fold the current state down to a digest." Long sessions accumulate context inside the model's window until you hit limits.

**Refocus plan:** milestones at 25/50/75% are *summary artifacts*, but the plan treats them as user-facing checkpoints, not as **working context** for the next cycle. The implicit assumption is that subsequent cycles still see prior artifacts directly.

**Recommendation:** explicitly couple milestones to context. After each milestone, the working context fed into the next cycle is `digest + recent_cycles` (last N), not `all_artifacts`. This is what makes overnight + heavy-modality envelopes scale.

- **U: high.** Without compression, the envelope ceiling for any single loop is the model's context window divided by per-cycle context growth. With compression, it's effectively unbounded.
- **C: low–medium.** ~150–250 LOC. A `compressDigest(artifacts) → digest_artifact` function in the engine, plus a "window strategy" the template declares (`{full | digest | digest_plus_recent_N}`). The cost is **one new artifact kind** (`digest`, which the plan already has) and one engine-level operation between cycles. Cheap structurally; the quality of the summarizer is the real lever.

#### 1A.3 Value-based / adaptive stop rule

| Project | Mechanism |
|---|---|
| **Stop-RAG** | Iteration as a finite-horizon MDP; a value-based controller decides "continue" vs "stop" per round. Trained with Q(λ) on complete trajectories; learns when more retrieval will help vs. distract. *(Detail from paper — repo README didn't expose architecture.)* |
| **BATS** (paper #7) | Budget Tracker plugin + BATS framework decides "dig deeper" vs "pivot" based on remaining budget. |

**Construct now:** stop is hard-coded: `max_iterations`, `budget_total_usd`, or per-thread `max_depth`. There's `iteration-check.ts` (275 LOC) that uses similarity-based heuristics to detect "stuck" states, but it doesn't model "is the next cycle worth running."

**Refocus plan:** `stop_rule: schedule_complete OR envelope_consumed OR shape_completeness_satisfied`. The third clause is shape-specific (e.g. "list found at least 10 items") but doesn't estimate marginal value.

**Recommendation:** add a fourth clause: a cheap scorer over accumulated artifacts that estimates "will the next cycle change the answer." Doesn't need to be learned — a heuristic that combines (last-N findings similarity to existing artifacts, last-N citation novelty, last-N planner confidence) is enough. When it stalls, stop early and write the artifact.

- **U: medium–high.** The asymmetric cost story matters: false negatives (stop too early) are recoverable (user re-runs); false positives (run past usefulness) waste real money on overnight runs. A heuristic stop is most valuable for cost-bounded and time-bounded envelopes.
- **C: low.** ~100–200 LOC. Reuses `similarity.ts` (already 163 LOC). One new template hook is not needed — it fits inside `stop_rule`. The honest risk: a bad scorer is *worse* than no scorer because it'll stop runs that were about to find the key insight. Worth A/B-ing before defaulting on.

#### 1A.4 Charts / multimodal output from the renderer

| Project | Mechanism |
|---|---|
| **Multimodal DeepResearcher** | "Formal Description of Visualization" (FDV) — charts as structured text, generated by the LLM and rendered into the report. 4-stage pipeline: research → exemplar textualization → planning → multimodal generation. 82% win rate over text-only. |
| **EDR** | Dedicated Visualization Agent. |

**Construct now:** report is markdown. No charts.

**Refocus plan:** report is markdown. The renderer hook is generic enough to support charts but no plan element pushes for it.

**Recommendation:** add `chart` as an artifact kind, with payload being an FDV-like structured spec (Vega-Lite or similar). The renderer can interleave them. Existing UI primitives (`ChartContainer`) already in Construct mean the rendering side is mostly free.

- **U: medium.** Whether you need it depends on the loop's domain. For research queries about quantitative topics (markets, trends), it's a step-change in report quality. For narrative or qualitative topics, it's noise.
- **C: low–medium.** ~200–400 LOC. New artifact payload schema, an extraction prompt in the research template, a renderer that maps FDV → Vega-Lite. The risk: cheap LLM-generated charts are often wrong/misleading. Needs verification logic — citation-equivalent for chart data. That's the real cost, not the rendering.

#### 1A.5 Recursive task decomposition (writing-style planning)

| Project | Mechanism |
|---|---|
| **WriteHERE** | `recursive/graph.py` task graph + `recursive/engine.py` planning engine. Three task types (Retrieval, Reasoning, Composition) interleaved without a predetermined outline. Each task may decompose into sub-tasks; depth is dynamic. |
| **WebWeaver** | Planner iteratively interleaves evidence acquisition with outline optimization. Outline is the data structure, not a side-effect. |

**Construct now:** flat planning — `run-plan.ts` produces a `RunPlan = { model_fast, budget_total_usd, max_thread_depth, role_label }` keyed by `(shape, topic)`. Threads have parent-child via `parent_thread_id`, but the engine doesn't *recursively plan* — branches are spawned reactively by perturbation rules.

**Refocus plan:** the `LoopSchedule` is created up-front at 10–15% envelope spend, then re-planned at milestones. Branching factor is a number, not a tree.

**Recommendation:** middle ground — keep the up-front schedule but allow the **template's derivation hook** to spawn sub-loops, bounded by the parent's remaining envelope. WriteHERE's recursive shape becomes optional, opt-in per template, rather than the default.

- **U: medium.** WriteHERE shows it matters most for *composition* tasks (long-form writing). Research arguably benefits less — most research is "broad sweep then deepen on hits," which the existing perturbation + thread model already approximates without true recursion.
- **C: medium–high.** ~500–800 LOC. A recursive scheduler is meaningfully more complex than a flat one: depth budgeting, sub-envelope inheritance, what happens when a sub-loop crashes, how the cycle ledger composes across levels. The plan's "in-process fanout via `mapWithConcurrency`" gets recursive, which is implementable but more bug-prone than the current flat semaphore. **Don't bake this in for the cutover.** Add it later if/when a "long-form writing" template is built.

#### 1A.6 Specialized search agents per source type

| Project | Mechanism |
|---|---|
| **EDR** | 4 named agents: General, Academic, GitHub, LinkedIn — each with its own prompt + provider config. |
| **Open Deep Search** | Default mode (SERP, low latency) vs Pro mode (deep scrape + rerank). Configurable LiteLLM IDs per role: `LITELLM_SEARCH_MODEL_ID`, `LITELLM_ORCHESTRATOR_MODEL_ID`, `LITELLM_EVAL_MODEL_ID`. |
| **OpenDeepSearch** | Plug-in rerankers (Jina, Infinity), plug-in providers (Serper, SearXNG). Modular tool ecosystem. |

**Construct now:** single search provider (Jina via `providers/websearch.ts`). One model role per session. No source-type specialization.

**Refocus plan:** still single-provider. Source-list ingestion is listed as an open question.

**Recommendation:** introduce **typed processors** within the research template — `web_search`, `academic`, `github`, `pdf`, etc. — each with its own provider stack and prompt. The planner chooses the mix based on shape/topic. Falls out cleanly: the existing `(shape, topic) → RunPlan` lookup can extend to include `processor_mix`.

- **U: medium–high.** Domain queries benefit enormously from source-aware search (an academic shape with arxiv > generic web search). For Construct's actual usage patterns this is highly query-dependent.
- **C: medium.** ~400–700 LOC across templates and providers. Each typed processor is ~50–150 LOC plus a provider integration. The abstraction cost is small (each is still a function under the research template's `processor` hook), but the **operational cost** of credentials and rate limits across multiple providers is real and ongoing.

#### 1A.7 Eval-on-commit / continuous evaluator

| Project | Mechanism |
|---|---|
| **CORAL** | Git post-commit hook auto-runs the grader. Leaderboard maintained per attempt. Web dashboard surfaces it. |
| **EDR** | Reflection mechanism detects knowledge gaps and updates research direction. |

**Construct now:** post-mortems run per-job and produce notes; iteration-checks detect stuck states. No leaderboard, no auto-eval comparing attempts.

**Refocus plan:** post-mortems "kept for now as development feedback." Reviews tab folded away. No mention of a continuous evaluator.

**Recommendation:** keep post-mortems exactly as the plan does. **Don't** copy CORAL's leaderboard — CORAL is doing competitive coding-task evolution where attempts are directly comparable. Research queries aren't comparable that way. The intersection is narrow.

- **U: low for research, high for the eval-harness skill.** Construct's eval-harness skill is where CORAL's pattern actually applies — comparing skill/agent reliability over time.
- **C: out of scope for the refocus.** Eval lives in `eval-harness`, not the loop engine.

---

### 1B. Features in both Construct and external projects, but with distinct differences

#### 1B.1 Planning / scheduling

| | Construct (refocus) | External projects |
|---|---|---|
| **Up-front plan** | `LoopSchedule` at 10–15% envelope; branching factor, cycles/branch, derivation rules, milestone checkpoints | EDR: Master Planning Agent (adaptive decomposition); WriteHERE: recursive task graph; WebWeaver: outline-as-data-structure; ResearStudio: hierarchical plan-as-document |
| **Re-planning trigger** | Milestone checkpoints (fixed: 25/50/75%) | WebWeaver: continuous outline edits per evidence batch; EDR: gap-detection triggered; CORAL: heartbeat intervention |
| **Plan format** | Internal struct, not surfaced as artifact | EDR/ResearStudio/WriteHERE: plan is an artifact, often editable |

**Difference that matters:** Construct's plan is **internal state**; the external projects treat the plan as **a first-class artifact** that's edited (by the LLM, the user, or both).

**Recommendation:** promote `LoopSchedule` to a first-class artifact (`kind: 'schedule'`). This is one schema change with two payoffs: (1) plan re-revisions become diffable, (2) the user can edit it (per 1A.1). Falls out of work you'd do anyway.

- **U: high.** Cheap unification of two features (steerability + plan visibility).
- **C: very low.** ~50 LOC marginal — the engine already produces this struct; making it persist as an artifact is one INSERT.

#### 1B.2 Branching / fanout

| | Construct | Most external projects |
|---|---|---|
| **Branching unit** | `research_threads` row with `parent_thread_id`, `priority` float, `depth`, `max_depth` | WriteHERE: task graph nodes; EDR: agent assignments; WebWeaver: outline sections |
| **Concurrency control** | `mapWithConcurrency` helper, per-session semaphore | Most: sequential within an agent + multi-agent in parallel |
| **Priority** | float (0..1), `ORDER BY priority DESC, created_at ASC` | Most: implicit (by spawn order) |
| **Spawning trigger** | Perturbation strategy + finding-driven (`spawned_from_finding_id`) | Mostly planner-driven, not finding-driven |

**Difference that matters:** Construct's threads are **spawned reactively** from findings via perturbation. Most external projects spawn **proactively** from the planner. Construct's model is more dynamic but harder to budget against. The refocus plan moves perturbation from "defensive rate-limited reactive" to "primary derivation," which makes the gap larger, not smaller.

**Recommendation:** keep the reactive spawning model — it's a genuine Construct differentiator that the survey doesn't have. But surface the **prediction**: at plan time, estimate how many derivation-spawned branches the schedule will allow. The planner currently doesn't know about derivation budget at all.

- **U: medium.** Lets the planner make tradeoffs (deeper-on-fewer vs broader-on-more) based on expected derivation rate.
- **C: low.** ~100 LOC in the planner. Most of the inputs already exist in `perturbation.ts` (strategy weights, cooldown, depth-scaling).

#### 1B.3 Memory / persistence

| | Construct | External projects |
|---|---|---|
| **Storage** | SQLite (`@construct/data`) with structured tables: `research_threads`, `research_findings`, `research_sources`, etc. | CORAL: `.coral/` directory with markdown+YAML; EDR: LangGraph state object + session store; WriteHERE: `memory.py` module |
| **Cross-session** | None — each `session_id` is isolated | CORAL: shared across attempts; EDR: session_store |
| **Format** | Typed rows | Mostly file-based or JSON state |

**Difference that matters:** Construct is the **only** comparator with a real relational data model. CORAL stores everything as files in a git worktree. EDR uses a LangGraph state struct serialized to a session store. The "find me all queries mentioning Topeka" query is trivial in Construct, expensive or impossible in the others.

**Refocus plan:** consolidates into `loops`, `cycles`, `artifacts`, `cycle_ledger`, `milestones`. Strictly **better** than today's schema (which has too many tables) and still better than any comparator.

- **U: high (as-is).** No change needed.
- **C: zero (already in plan).** This is a place where Construct should not chase the external designs.

#### 1B.4 Tooling / provider abstraction

| | Construct | External projects |
|---|---|---|
| **Provider abstraction** | `providers/router.ts` (64 LOC) + `providers/openrouter.ts` (196 LOC). Single web search (`providers/websearch.ts`, Jina) | Open Deep Search: LiteLLM (15+ providers), pluggable rerankers (Jina/Infinity), pluggable search backends (Serper/SearXNG) |
| **Tool registry** | None — searches called directly from engine | EDR: MCP ecosystem (NL2SQL, file analysis, enterprise workflows); CORAL: plug-in coding agents (`claude_code`, `codex`, `cursor`, `kiro`, `opencode`) |

**Difference that matters:** Construct hardcodes Jina + Anthropic; the comparators almost universally use a tool/provider registry. The refocus plan keeps OpenRouter (provider abstraction stays unchanged) but doesn't introduce a tool registry.

**Recommendation:** **don't** introduce a full MCP layer for the cutover — it's a real complexity tax and Construct doesn't need it yet. But **do** make the search-provider call go through a registry shape, so source-type specialization (1A.6) can be added later without a refactor.

- **U: medium.** The benefits are mostly future-tense.
- **C: low if narrow.** ~150 LOC to make `websearch.ts` a registry. High if you go for full MCP. Stay narrow.

---

### 1C. Features in Construct that are absent (or rare) in the external projects

These are Construct's genuine differentiators. Worth defending in the refocus.

| Feature | Implementation in Construct | Found in comparators? |
|---|---|---|
| **`detectQuestionShape`** (7 shapes: survey, timeline, list, dynamics, comparison, lookup, audit) | `engine.ts` one-shot LLM call at session creation | **No.** Closest analog is EDR's adaptive decomposition, but it doesn't produce a typed shape. |
| **`pickAgentRole`** (role priming per topic+shape) | `engine.ts:92–130`, deterministic `(topic × shape) → role_label` lookup in `run-plan.ts` | **No.** Most projects use one general system prompt. |
| **Topic clusters** (AI/LLM, Music history, Databases, etc.) | `run-plan.ts` constant; deterministic routing | **No.** None of the comparators classify queries by topic. |
| **21 perturbation strategies organized in 5 categories** | `perturbation.ts`. Cooldown, depth-scaling, forced-diversity threshold, phase awareness (breadth-early, depth-late) | **Partial.** ZeroSearch, perturbation-style ideas exist in training literature, but as objectives, not as inference-time strategy menus. |
| **Phase-aware breadth-then-depth strategy weighting** | `perturbation.ts:14–22` — `EARLY_STRATEGIES` vs `LATE_STRATEGIES` | **No.** This is a genuine Construct insight not in the surveyed papers. |
| **Forced-diversity threshold** | If last-N findings same domain → force perturbation | **No.** |
| **Multi-modal envelope** (time + cost + cycles + sources, multiple stacked) | Refocus plan §Envelope | BATS does cost + tokens only; nobody surveyed does sources-as-envelope. |
| **Question-shape-driven `stop_rule`** ("list shape: at least 10 items found") | Refocus plan §Research extension stop_rule | **No.** Comparators stop on iteration count, budget, or learned policy. |
| **Strongly-typed schema in TypeScript** | `types.ts` 640 LOC of discriminated unions | All comparators are Python; types are dict-shaped at best. |

**Recommendation:** every one of these is worth keeping. The refocus plan correctly preserves all of them (with perturbation moving from defensive state machine to primary derivation, and shape-completeness becoming a `stop_rule` clause).

The one bit of advice: **document them as the differentiators**. The plan currently treats them as "what survives unchanged" — they're more than that, they're the reason the engine is worth building rather than adopting one of these projects wholesale.

- **U: high (defensive).** These are the moat.
- **C: zero.** Already paid for.

---

## 2. Agent / AI / LLM usage

### 2A. Where the external projects use LLMs

| Project | LLM call sites |
|---|---|
| **EDR** | (1) Master Planning Agent — query decomposition. (2) Each of 4 specialized search agents — one LLM call per search invocation. (3) Visualization Agent — generates charts. (4) Reflection mechanism — gap detection. (5) Optional steering — interprets human commands. LangGraph orchestrates; the LLM is invoked at every named node. |
| **ResearStudio** | Planner (writes plan), Executor (runs steps), Reflection. ~3 LLM call types in the hierarchical loop. |
| **WriteHERE** | Three task types, each LLM-driven: Retrieval (query formulation), Reasoning (analysis), Composition (writing). Plus a recursive decomposer that decides which to spawn. |
| **WebWeaver** | Two agents: planner (outline + evidence loop) and writer (section-by-section composition with citation lookup). Planner re-runs every cycle; writer once per section. |
| **WebResearcher** | One agent that rewrites its evolving report each iteration. MDP framing. |
| **Open Deep Search** | Two roles: orchestrator (decides what to do) + search-result interpreter. Configurable via `LITELLM_ORCHESTRATOR_MODEL_ID` and `LITELLM_SEARCH_MODEL_ID`. |
| **CORAL** | LLM is the agent itself (claude_code/codex/cursor as runtime). The framework is infrastructure — no LLM calls in the framework code, just subprocess spawn. |
| **Agentic Reasoning** | Mind-Map agent (knowledge graph maintenance) + Web-Search agent + main reasoning LLM. Three call sites. |
| **Tongyi DeepResearch** | Single end-to-end trained model, two inference modes (ReAct, IterResearch Heavy). Effectively all reasoning is one model. |

**Pattern across projects:** **multi-call, multi-role** — 3 to 5 named LLM call sites per cycle is typical. Each role has its own prompt, often its own model.

### 2B. Where Construct's LLM usage differs

| LLM call site in Construct | Frequency | Implementation |
|---|---|---|
| `pickAgentRole` | Once per session | `engine.ts:92` |
| `detectQuestionShape` | Once per session | `engine.ts:147` |
| `enumerateCanon` | Once per session if shape needs it | engine.ts |
| Search (per thread) | Once per iteration per thread | `executeSearches` |
| Finding extraction | Once per search | `extractor.ts` (91 LOC) |
| Perturbation strategy framing | Once per perturbation | `perturbation.ts:generatePerturbationPrompt` |
| Follow-up generation | Conditional, per finding | engine.ts |
| Gap-fill cycle | Conditional, at session level | engine.ts |
| Post-mortem | Once per job | `hooks/post-mortem.ts` (232 LOC) |
| Iteration check | Per iteration | `hooks/iteration-check.ts` (275 LOC) |
| Lead review | Currently per job (going away) | — |
| Citation generation | Per finding | engine.ts |
| Final report synthesis | Once at completion | engine.ts |

**Construct's LLM call density is comparable to the comparators**, but:

1. **Lookups dominate, agents don't.** The shape/topic/role decisions happen via **deterministic table lookups** (`run-plan.ts`) after a single classification call. Most comparators re-call an LLM at every planning step. Construct's design is significantly cheaper per loop, and the table-driven approach has the unstated benefit of **reproducibility** — same shape × topic → same plan.

2. **One model per session.** Construct uses one `model_fast` (per `RunPlan`); comparators routinely use different models per role (planner = strong, search-extractor = cheap, writer = strong). The refocus plan keeps single-model.

3. **Perturbation framing is unique.** Constructing the next sub-query under a specific strategy ("contrarian", "scale_shift") is a Construct-specific LLM use that doesn't appear in the comparators.

4. **No "evaluator agent" pattern.** Several comparators use a separate eval LLM (e.g. Open Deep Search's `LITELLM_EVAL_MODEL_ID`, RAG-Gym's critic axis). Construct's post-mortem hook is close but runs after the job, not as a continuous critic.

**Recommendation:**

- **Keep the lookup-driven planning.** It's faster, cheaper, and reproducible. The comparators' adaptive-LLM-planning is mostly compensating for not having shape/topic priors.
- **Add per-role model selection.** Today: one model per session. Better: planner = strong, search-extractor = cheap, synthesizer = strong. ODS's `LITELLM_*_MODEL_ID` pattern is the right shape. ~50 LOC of config.
- **Don't add a continuous evaluator agent.** Post-mortems serve the same purpose and don't multiply the per-cycle LLM cost.

- **U: medium (per-role models).**
- **C: low.** ~50–100 LOC of config plumbing. Net cost savings on every loop run (cheap model on extraction).

---

## 3. Engine architecture

### 3A. Architectures that differ from Construct's

#### 3A.1 Concurrency model — child-process-per-loop vs. event-loop

| | Construct (refocus) | Comparators |
|---|---|---|
| Process model | One OS child process per loop (API server spawns) | EDR/WriteHERE/ResearStudio: single web service (Flask/FastAPI), all loops in one event loop. Mostly Python. CORAL: subprocess per agent + git worktree per agent. |
| Crash recovery | Cycle ledger, restart at next un-digested cycle | LangGraph state checkpointing (EDR) — finer-grained but ties you to LangGraph. |
| Cross-loop scheduling | "OS schedules them" — no coordinator | EDR/others: single asyncio loop arbitrates. |

**Honest read:** Construct's child-process-per-loop is **more conservative** than what most comparators ship. The benefit is true crash isolation: a crashing loop doesn't take down the API. The cost is process-startup overhead (typically 100–500 ms in Node/Bun) per loop and harder cross-loop coordination (which the plan accepts: "If two loops are active, the OS schedules them").

CORAL is the closest analog — it spawns subprocess per *agent* and uses git worktrees for isolation. Same philosophy.

**Recommendation:** keep the child-process model. The plan's logic ("no shared job queue, no claim tokens, no heartbeats") is correct: it's a real simplification over today's worker pool. Just be aware that under heavy concurrent monitor load, you'll be starting/stopping a lot of processes — the "re-spawn on tick" choice in `§Monitors extension` should be benchmarked before committing.

- **U: high (vs. today's worker pool).**
- **C: medium engineering effort.** ~250 LOC for process supervisor, but it deletes ~970 LOC across `worker.ts`, `jobs.ts`, `scheduler.ts`. Net negative.

#### 3A.2 State model — relational vs. document/file/state-object

| | Construct | Comparators |
|---|---|---|
| Schema | SQLite tables: `loops`, `cycles`, `artifacts`, `cycle_ledger`, `milestones` (refocus) | EDR: LangGraph state object serialized JSON. CORAL: `.coral/` directory of markdown/YAML/skill dirs. WriteHERE: `memory.py` in-memory. |
| Crash recovery | Cycle ledger lookup | LangGraph: checkpoint restore. CORAL: git history. Others: usually none. |
| Query | SQL | File scan or in-memory dict |

**Difference:** Construct is the only one with a **first-class query layer**. The comparators trade query power for flexibility (LangGraph can store anything in its state object) or for simplicity (CORAL just uses files).

**Recommendation:** stay relational. The refocus plan's table consolidation is the right move. **One concrete refinement:** the `artifacts` table's `payload JSON` field is the right shape (templates own the payload) — make sure the engine doesn't introspect payloads anywhere. If it does, that's an abstraction leak.

- **U: high.**
- **C: paid already.**

#### 3A.3 Workflow framework — bespoke vs. LangGraph

| | Construct | EDR |
|---|---|---|
| Workflow framework | Bespoke (TypeScript), state lives in tables | LangGraph (Python), state lives in LangGraph state object |

**Difference:** EDR builds on LangGraph for state management and agent orchestration. LangGraph gives you: (a) typed state transitions, (b) checkpointing, (c) human-in-the-loop interrupt support out of the box. Construct's refocus plan re-implements (a) via the cycle ledger and (b) via the same. (c) is the gap.

**Should Construct adopt LangGraph or equivalent?** No.

- LangGraph is Python; Construct is TypeScript by repo convention.
- It would replace the most strategic part of the engine (the loop primitive) with a framework dependency.
- The refocus plan is explicit: "Templates ship as code, not as data." LangGraph nudges you toward graph-as-data, which is incompatible with that philosophy.

**Recommendation:** look at LangGraph's state-checkpointing API as **inspiration** for how the cycle ledger should expose state to the user (snapshot retrieval, branch-from-snapshot). Then build it bespoke. The TypeScript ecosystem doesn't have a strong LangGraph equivalent worth adopting.

- **U: very low (as adoption); medium (as inspiration).**
- **C: high (if adopted).** Would require rewriting most of the plan in Python or building a TypeScript port. Not worth it.

#### 3A.4 Recursive vs. flat scheduling

| | Construct | WriteHERE |
|---|---|---|
| Scheduling shape | Flat tree of branches under one loop (parent_thread_id, max_depth=5 default) | Truly recursive: each task may decompose into more tasks of any of 3 types |
| Depth bound | Per-thread `max_depth`, enforced by config | Dynamic, bounded by global cost |

Discussed above (1A.5). Construct's flat tree is **simpler to reason about and bound**, at the cost of expressing certain templates (long-form writing) less naturally.

**Recommendation:** don't make the engine recursive. Allow templates to *opt into* sub-loops via the existing child-process spawn mechanism. A code-writing template's processor that spawns a sub-loop for "run tests in isolation" is fine; the engine treats sub-loops as ordinary loops with a `parent_loop_id` reference.

- **U: low (most templates won't need it).**
- **C: ~50 LOC for `parent_loop_id` + recursive cost budgeting. Cheap.**

#### 3A.5 Tool registry — implicit vs. explicit

Already covered in 1B.4. The recommendation is: narrow tool registry around web search (so source-type specialization can grow), don't adopt MCP for the cutover.

---

### 3B. Cost/benefit summary

Putting the additions in order, ranked by ratio of recommendation strength to cost:

| # | Addition | U | C (LOC) | Verdict |
|---|---|---|---|---|
| 1 | Context compression at milestones (1A.2) | high | 150–250 | **Before cutover.** Unblocks long envelopes. |
| 2 | `LoopSchedule` as a first-class artifact + mid-run edit (1A.1 + 1B.1) | high | 400–600 | **Before cutover.** Closes the steerability gap; cheap to unify. |
| 3 | Per-role model selection (2B) | medium | 50–100 | **Before cutover.** Cheap, save money on every loop. |
| 4 | Adaptive stop-rule clause (1A.3) | medium-high | 100–200 | **After cutover.** Needs A/B against fixed envelope first. |
| 5 | Source-type specialized processors (1A.6) | medium-high | 400–700 | **After cutover.** Add when a query domain demands it. |
| 6 | Charts in renderer (1A.4) | medium | 200–400 | **After cutover.** Tied to demand. |
| 7 | Recursive sub-loops via `parent_loop_id` (3A.4) | low | ~50 | **After cutover, opportunistic.** Don't build until a template needs it. |
| 8 | Continuous evaluator agent | low | n/a | **Skip.** Post-mortems already cover this. |
| 9 | LangGraph adoption | very low | very high | **Skip.** |
| 10 | MCP tool ecosystem | low (now) | high | **Skip for now.** Revisit if Construct grows toward enterprise integrations. |

**Total recommended additions before cutover (#1–3):** ~600–950 LOC over the refocus plan's baseline. The baseline net was already +200 to +900 LOC over today's code. These three additions push the total to roughly **+800 to +1850 LOC over today** — call it **+10–18%** on the 10.5K-LOC base. Still small relative to what the refactor deletes.

**What the survey did *not* surface that's worth flagging:** there's no architectural pattern in the surveyed work that suggests Construct's `(question_shape × topic) → run_plan` is wrong, that the perturbation strategy menu is wrong, or that the relational schema is wrong. Those three are the engine's biggest bets and the survey is silent on them. That's reassuring — it means they're outside the consensus, not contradicted by it.

---

## What was skipped and why

**Source:** the *Latest Research Papers* section of [`DavidZWZ/Awesome-Deep-Research`](https://github.com/DavidZWZ/Awesome-Deep-Research) (50 papers as of 2026-05-11), plus the `Benchmarks and Applications` section.

### Filter 1: training-heavy papers

Papers whose primary contribution is a **trained model** rather than an inference-time architecture were excluded. Rationale: Construct does not train models — it uses provider LLMs (Anthropic, OpenRouter). A paper that ships SOTA results because of a new RL objective, a new data-synthesis pipeline, or a new training algorithm has nothing implementable to offer Construct beyond the conceptual idea (which, if portable, was kept).

Concretely skipped:

| # | Paper | What it ships | Why skipped |
|---|---|---|---|
| 2 | Dr. Zero | Data-free self-evolution + HRPO training | Trained model is the artifact. Self-curriculum idea noted in cross-cutting themes but not implementable without training. |
| 4 | SmartSearch | Process-reward training + curriculum | Idea (per-query scoring) folded into the adaptive stop-rule (1A.3); training pipeline skipped. |
| 5 | O-Researcher | Multi-agent data synthesis + SFT + RL | Trained model is the artifact. |
| 9 | M-GRPO | Hierarchical RL for multi-agent systems | Distributed training scheme; no inference-time takeaway. |
| 10 | Tongyi DeepResearch | 30.5B MoE + automated data pipeline | Trained model is the artifact. The IterResearch Heavy *inference mode* was kept as evidence for periodic compression (1A.2). |
| 11 | WebSeer | RL with self-reflection | Trained 14B model is the artifact. |
| 14 | Towards Agentic Self-Learning | Self-learning in search environment | Training methodology. |
| 15 | GOAT | Goal-oriented tool-use training | Training framework for fine-tuning open-source agents. |
| 17 | HiPRAG | Hierarchical process rewards (RL) | Process-reward idea folded into adaptive stop-rule discussion; training skipped. |
| 18 | A2SEARCH | Ambiguity-aware QA with RL | Training methodology; pre-flight clarification in the refocus plan already covers the inference-time analog. |
| 19 | ReSeek | Self-correcting framework with instructive rewards | Training methodology. |
| 20 | Process-Supervised Multimodal Tool-Use | RL for multimodal agents | Training methodology. |
| 24 | WebSailor-V2 | Synthetic data + DUPO RL | Training pipeline. |
| 25 | WebExplorer | Data generation + SFT + RL | Trained 8B model is the artifact. |
| 26 | Atom-Searcher | Atomic thought reward | Training methodology. |
| 27 | MMSearch-R1 | Multimodal search incentivization | Training methodology. |
| 31 | MaskSearch | Pre-training framework | Pre-training methodology. |
| 32 | SimpleDeepSearcher | Reasoning-trajectory synthesis | Training data pipeline. |
| 33 | WebAgent-R1 | Multi-turn RL for web agents | Training methodology. |
| 34 | R1-Searcher++ | RL-driven dynamic knowledge acquisition | Training methodology. |
| 35 | Process vs Outcome Reward | RL ablation study | Training-design choice paper. |
| 36 | s3 | Efficient RL search-agent training | Training methodology. |
| 38 | Knowledge-R1 | Internal-external knowledge synergy via RL | Training methodology. |
| 39 | ZeroSearch | LLM search capability without searching (training) | Training methodology. |
| 40 | WebThinker | Reasoning models with deep-research capability | Training methodology. |
| 41 | Pangu Ultra | Dense LLM on Ascend NPUs | Model-training paper; unrelated. |
| 43 | DeepResearcher | Scaling deep research via RL | Training methodology. |
| 44 | ReSearch | Reasoning with search via RL | Training methodology. |
| 45 | Search-R1 | Training LLMs to use search engines | Training methodology. |
| 47 | R1-Searcher | RL search-capability incentivization | Training methodology. |
| 50 | Search-o1 | Search-enhanced reasoning models | Training methodology; the *Reason-in-Documents* sub-module idea (refine retrieved docs before injection) was noted but isn't structurally distinct from Construct's extraction step. |

**Total skipped from this filter:** 31 papers.

### Filter 2: training-adjacent but partial credit

A handful of papers were training papers in form but exposed an inference-time idea worth keeping. The training methodology was discarded; the idea was folded into the analysis:

| # | Paper | Kept from it |
|---|---|---|
| 4 | SmartSearch | The per-query scoring concept → adaptive stop-rule (1A.3). |
| 17 | HiPRAG | The over-search/under-search failure-mode framing → per-cycle redundancy detection. |
| 30 | RAG-Gym | The "critic axis" concept (a scorer over completed artifacts) → routed to Construct's eval-harness skill, not the loop engine. |
| 50 | Search-o1 | Reason-in-Documents module → no direct adoption since Construct's `extractor.ts` already plays this role. |

### Filter 3: benchmarks section

The `Benchmarks and Applications` section (Humanity's Last Exam, BrowseComp, BrowseComp-ZH, DeepResearch Bench, MedBrowseComp, Mind2Web 2) was treated as **eval surface**, not architecture. Recommendation lives under §3B (kept brief because eval is owned by the `eval-harness` skill, not the loop engine).

### Where details were thinner than I'd like

Three sources returned 404 or insufficient content; recommendations there rest more on paper abstracts than on code:

- **ResearStudio repo** (404'd). The pause/edit/resume pattern recommendation (1A.1) was reinforced by EDR's `steering_integration.py`, which I did read, so the conclusion stands even with thinner detail on this specific repo.
- **Agentic-Reasoning repo** (404'd). The Mind-Map agent recommendation is from the abstract only. If pursued, read the paper before implementing.
- **Stop-RAG repo** had a usage guide, not architecture detail. The value-controller mechanism recommendation (1A.3) is from the abstract — the *idea* is clear but the *exact controller form* needs the paper before coding.
- **Alibaba-NLP/DeepResearch repo** primarily documents Tongyi DeepResearch; WebWeaver / WebResearcher / WebSailor-V2 / ReSum are listed but architectural details are not exposed in that README. Recommendations for those papers rest on the arxiv abstracts.

## Confidence notes

- **High confidence:** Construct's current code (read directly), the refocus plan (read directly), EDR / WriteHERE / Open Deep Search / CORAL architectures (READMEs fetched).
- **Medium confidence:** ReSum, WebWeaver, WebResearcher (paper abstracts + the Alibaba shared README which didn't expose individual project details).
- **Lower confidence:** ResearStudio and Agentic-Reasoning (repo READMEs 404'd; working from the papers' abstracts). The pause/edit/resume pattern is well-described in the ResearStudio abstract and aligns with EDR's steering — the recommendation stands even with partial detail.
- **Stop-RAG**: the architectural claim (MDP + value controller) is from the abstract; their README is a usage guide. The *idea* is clear; the *exact controller form* would need a paper read before implementing.

---

## Appendix A — Grounded in observed dev data (2026-05-11)

The recommendations in §1–§3 were derived from the comparison of the refocus plan against the comparator architectures. This appendix is a reality check against the actual last ~5 weeks of research queries on the dev server (35 queries in `~/.construct/construct-dev.db`). The aim: do the recommended features match the observed user pain, or do they diverge?

### Failure modes observed in the dataset

| Failure mode | Where it shows up | Evidence |
|---|---|---|
| **Topic-cluster + canon enumeration drift** | `wide-maple-ivy-9c6e` (this very task) | Prompt: "compare open-source deep research projects on this GitHub list." `enumerateCanon` spawned 9 `canon_slot` threads on AlphaFold, BERT, GPT-3, TensorFlow, PyTorch, DALL-E, Keras, Adam optimizer, OpenAI, CLIP — the **deep-learning canon**, not the **agentic deep-research canon**. The auto-generated 70 KB document drifted into PyTorch Adam-optimizer tutorials in the references. The post-mortem said `verdict: pass, flags: []`. The system did not notice it had answered the wrong question. |
| **Output-shape ignored** | `vivid-cove-pine-c74a` (HSV/HPV) | User asked for a TABLE with specific columns per variant per gender. Got a 54 KB article with HPV-vs-HSV tables but **not** the per-variant per-gender table. Post-mortem: `verdict: pass`. The `output_shape` field on the query record was `null` — never populated. |
| **Geographic / list intent buried in prose** | `sharp-brook-apex-2a1c` (smashed burgers) | User asked for definition + history + best Bay Area places. Got 50 KB of prose with **zero numbered list items**; history dominated; the Bay Area portion was a few inline mentions. |
| **Same prompt re-submitted 2–3×** | CRDT×3, EDM×2, HSV/HPV×2, Eminem×2, resume-gap×2, photosynthesis×2 | 6 of 35 queries (~30%) are silent re-runs by the user. Strongest user-dissatisfaction signal in the dataset. |
| **Universal `low_finding_yield + thread_skew` flag** | 7 of 8 queries inspected | Post-mortems flag this pair near-universally. Content field of the post-mortem is **empty**, so the user has no narrative explanation. |
| **Drift not caught by post-mortem** | `wide-maple-ivy-9c6e` | Post-mortem said `pass` despite obvious topic drift. The system already detects yield/balance but does not detect on-topic-ness. |

### Cost / yield observed

| Query | Cost | Findings | Threads | $/finding |
|---|---|---|---|---|
| `vivid-cove-pine-c74a` HSV/HPV | $0.35 | 44 | 60 | $0.008 |
| `sharp-brook-apex-2a1c` smashed burgers | $0.78 | 65 | 60 | $0.012 |
| `risen-rift-bay` Berkeley volunteering | $0.46 | 64 | 60 | $0.007 |
| `cedar-rapid-rush-3717` EDM 1990s (good run) | $0.65 | 62 | 60 | $0.011 |
| `wild-rock-falls-3f21` CRDT (run 1) | — | 7 | 7 | — |
| `calm-cedar-apex-61ef` CRDT (run 2) | $0.024 | 4 | 4 | $0.006 |
| `dawn-crown-wake-09db` CRDT (run 3) | $0.044 | 5 | 6 | $0.009 |

Every long run hits the 60-thread cap, costing ~$0.50–$0.80. Most are paused/abandoned — the user got a 50–70 KB report that didn't match the requested shape and gave up.

### Recommendations re-ranked by observed pain

Two items in the original §3B comparison did **not** show up as observed pain (context compression, charts); two **new** items emerged that weren't in the comparison doc.

| Rank | Feature | LOC | Observed pain | In original §3B? |
|---|---|---|---|---|
| 1 | **Mid-run steerability + plan-as-artifact** (§1A.1 + §1B.1) | 400–600 | **Universal.** Every observed failure was catchable at cycle 1–3 if the user could see the plan and edit it. | Yes |
| 2 | **Output-shape enforcement** (new) | 100–150 | HSV/HPV table, burger list, volunteering list. `output_shape` field already exists, never populated. | **No — emerged from data** |
| 3 | **Topic-cluster + canon enumeration overhaul** (new) | 200–300 | Awesome-Deep-Research case alone makes this the biggest single quality lever. `enumerateCanon` produced 9 wrong threads at depth 1 before any reactive perturbation. | **No — emerged from data** |
| 4 | Source-type specialized processors (§1A.6) | 400–700 | Volunteering (688 sources, no directory-source-type processor), burgers (no restaurant-directory processor), Awesome-DR (no GitHub-aware processor). | Yes |
| 5 | Adaptive stop-rule (§1A.3) | 100–200 | CRDT re-runs, universal `low_finding_yield`. | Yes |
| 6 | Per-role model selection (§2B) | 50–100 | Cost win; no observed quality lift in this dataset. | Yes |
| ↓ | Context compression (§1A.2) | 150–250 | **No observed need.** No run hit a context wall; yield was the bottleneck. Stays a future-tense win for envelopes that don't exist yet. | Yes |
| ↓ | Charts in renderer (§1A.4) | 200–400 | **No observed need.** | Yes |

### The two emergent items, expanded

**Output-shape enforcement.** The `output_shape` field on the query record (visible in the API output) is unused. The `question_shape.lenses` field has completeness criteria but the engine doesn't make them binding on `stop_rule`. A small fix:

1. Populate `output_shape` at session create alongside `question_shape`.
2. Final-render gate: does the rendered document contain the table/list/timeline requested? If not, run targeted derivation cycles before declaring done.
3. `stop_rule` rejects "done" if the renderer can't satisfy the shape.

This is the smallest plan refinement with the biggest empirical yield — would have fixed three of the failures I observed.

**Topic-cluster + canon enumeration overhaul.** The 6 fixed clusters in `run-plan.ts` (`AI / LLM tooling`, `Music history`, `Databases`, `Audio & DSP`, `Personal infra`, `Misc`) are too narrow. CRDT got bucketed as "Databases" (it's distributed systems / collab editing); EDM, volunteering, burgers, Eminem all fell to `Misc`; Awesome-Deep-Research got `AI/LLM tooling` and pulled deep-learning canon.

Three concrete changes:

1. **Make `enumerateCanon` shape-conditional.** Don't enumerate canon for queries with `comparison` shape on a user-provided source list — the list **is** the canon.
2. **Detect URL-grounded queries.** If the prompt contains a URL, fetch it and use its contents as the seed source set. The Awesome-Deep-Research case had a literal URL in the prompt.
3. **Widen or replace the topic-cluster taxonomy.** Either grow to 20+ clusters or let the LLM produce a free-text cluster label. The current 6 clusters overfit to the operator's known interests and route everything else to `Misc`.

The Awesome-Deep-Research case lost roughly $0.30 of $0.50 to `canon_slot` threads before reactive perturbation got a turn. That's the single largest visible-in-data quality lever.

### Verdict on the survey-derived priorities

- **Survey #1 (steerability)** is confirmed #1 by the data.
- **Survey #2 (context compression)** drops below the fold — no observed need.
- **Survey #3 (adaptive stop)** stays mid-pack, useful but not most pressing.
- **Two data-derived items** (output-shape enforcement + canon overhaul) outrank survey items 2 and 3.

Net: the survey told us *what's missing relative to other systems*; the dev data tells us *what's broken relative to the user's actual queries*. Both lists agree at the top but diverge below it.

---

## Appendix B — Configurability comparison: knobs the user can set per query

This appendix answers a separate question: what can a user actually configure when starting a new query in Construct vs. in each comparator project? Configurability is a quiet design lever — too many knobs and the user is overwhelmed and most defaults rot, too few and the engine can't be steered when it goes wrong.

### Construct (current UI)

**At submit (compose box):**

| Knob | Surface | Notes |
|---|---|---|
| Prompt | Textarea | Primary input. |
| Shape template buttons | 5 buttons (`timeline`, `comparison`, `survey`, `dynamics`, `audit`) | Each prepends a phrase to the prompt — they don't set any config field directly. |

**Post-submit, before/while running** (`InferredPanel` → inline editors):

| Knob | Editor | Source |
|---|---|---|
| Question shape | Toggle subset of 7 shapes (survey, timeline, list, dynamics, comparison, lookup, audit) | `ShapeEditorInline` |
| Per-shape lens criterion | Free-text per selected shape | `LensesEditorInline` |
| Topic cluster | Pick one of 6 (AI/LLM tooling, Music history, Databases, Audio & DSP, Personal infra, Misc) | `TopicEditorInline` |
| Run plan: model | Free-text model ID | `RunPlanEditorInline` |
| Run plan: budget (USD) | Number | `RunPlanEditorInline` |
| Run plan: max depth | Integer | `RunPlanEditorInline` |

**Internal-only `SessionConfig` fields not exposed to the user (~30 knobs):**

`budget_daily_usd`, `budget_total_usd` (envelope total), `budget_alert_threshold`, `max_total_threads`, `p_serendipity`, `max_perturbation_probability`, `novelty_threshold`, `dedup_similarity_threshold`, `diminishing_returns_threshold`, `diminishing_returns_window`, `min_delay_between_steps_ms`, `max_steps_per_hour`, `max_concurrent_threads`, `topic_coherence.{seed,hop}_similarity_min`, `perturbation_coherence_floor`, `model` (vs `model_fast`), `providers.{primary,openrouter_models}`, `schedule.{mode,active_windows,timezone,max_session_duration_minutes}`, `on_duration_expiry`, `role_priming_enabled`, `role_label`, `role_prompt`, `perturbation.{depth_scaling,chain_length,strategy_cooldown,forced_diversity_threshold,strategy_weights}`, `follow_up.{min_count,max_count,max_retries,similarity_threshold}`, `burst_iterations`, `min_searches_per_thread`, `fetch_source_text`, `gap_analysis.{enabled,max_gap_searches,mode,every_n_findings}`, `llm_max_output_tokens`, `snippet_synthesis_chars`, `snippet_display_chars`.

**Effective design:** 1 primary input (prompt) + 5 prompt templates + 6 post-submit-editable inferred fields. ~30 internal knobs hidden behind defaults.

### Construct refocus plan

The refocus plan's "entry surface" §UX section describes a simpler shape: **template picker + seed input + envelope (3 presets per template: 30 min / overnight / custom)**. Custom reveals: time, cost cap, cycle count, optional source-list attach. Model / branching / depth are "template-internal and not surfaced in the primary entry."

This is a **regression** in user-exposed configurability vs. today's `InferredPanel` (which exposes model, budget, depth, shape, topic, lens criteria as inferred-then-editable). The plan's UX section doesn't acknowledge the existing `InferredPanel` pattern.

**Recommendation for the plan:** the existing inferred-then-editable pattern is well-designed and worth keeping. The refocus's "envelope presets" should sit alongside it, not replace it. Specifically:

- Envelope presets (new): replace today's `schedule.mode = 'default'|'scheduled'|'priority'`
- Inferred panel (keep): shape, topic, model, budget, depth — same fields, same edit-after-submit UX
- Add (per Appendix A §2): **output_shape** as an inferred-then-editable field (table, list, prose, mixed)

### Comparators

| Project | Per-query knobs (set by user) | Setup-time knobs (set once) | During-run controls |
|---|---|---|---|
| **EDR** (Salesforce) | Query input. Probably agent selection. | LLM provider config, MCP tool credentials. | **Steering commands** (free-form text injected mid-run via `steering_integration.py`). |
| **ResearStudio** | Query input. **Mode**: AI-led / human-assisted / human-led. | LLM provider config. | **Pause, edit plan-as-document, run custom commands, resume.** The most flexible during-run surface in the survey. |
| **WriteHERE** | Query + writing mode (fiction vs. technical report). | Flask backend config. | None documented. |
| **Open Deep Search** | Query + `mode: default | pro`. | Per-role env vars: `LITELLM_MODEL_ID`, `LITELLM_SEARCH_MODEL_ID`, `LITELLM_ORCHESTRATOR_MODEL_ID`, `LITELLM_EVAL_MODEL_ID`. Search provider (`Serper` or `SearXNG`). Reranker (`Jina` or `Infinity`). | None — runs to completion. |
| **CORAL** | YAML config per *task* (not per-query): task description, grader timeout, agent runtime (`claude_code | codex | cursor | kiro | opencode`), agent count, agent model, workspace path. | Same — YAML is the only surface. | `heartbeat` CLI subcommand to inject reflection prompts or trigger skill consolidation. |
| **Tongyi DeepResearch** | Query + mode (`ReAct` or `IterResearch Heavy`). | Single trained model — no choice. | None. |
| **WebWeaver / WebResearcher / ReSum** | Query + max iterations + model. | Model, search provider keys. | None. |

**Patterns:**

- **Per-query knobs are universally minimal** — most projects have 1–3 fields (query + optional mode). Construct's 1-textbox-plus-5-inferred-and-editable is on the rich end but not absurd.
- **Setup-time knobs are more variable.** Open Deep Search and CORAL expose them via env vars / YAML; Construct hides them in defaults; EDR/WriteHERE expose almost nothing.
- **During-run controls are absent in 5 of 7 comparators.** Only EDR and ResearStudio (and CORAL via `heartbeat`) let the user intervene mid-run. **Construct has none today.**
- **Mode as a primary knob** is widespread: ResearStudio (AI-led / assisted / human-led), Open Deep Search (default / pro), WriteHERE (fiction / technical), Tongyi (ReAct / Heavy). Construct has `schedule.mode` internally (`default | scheduled | priority`) but the refocus plan deletes it and replaces with envelope presets, which is the same idea by another name.

### Where Construct's configurability is uniquely strong

1. **Inferred-then-editable pattern.** Most comparators are "user sets it once at submit, that's it." Construct does "engine guesses, user corrects." That's a better default for users who don't know what shape they want.
2. **Per-shape lens criterion as free text.** None of the comparators have anything like this. It's the only place where a user can express a per-shape acceptance criterion in plain English.
3. **Question-shape detection backed by a typed enum (7 shapes).** No comparator has typed shapes — they all let the LLM decide on its own.

### Where Construct's configurability is weak

1. **No mid-run controls of any kind.** Once submitted, the only lever is "cancel." The `InferredPanel` edits stop being effective after the early phase. This is the single biggest gap vs. EDR / ResearStudio / CORAL.
2. **`output_shape` field exists but isn't user-editable or even auto-populated** (Appendix A §2). The user can edit `question_shape` (how to investigate) but not `output_shape` (what to produce). HSV/HPV failed because of this.
3. **6-cluster topic taxonomy** is too narrow but exposed to the user as a fixed dropdown. The user can pick one of 6, can't add their own. Appendix A §3.
4. **Run plan budget UX is "free-form USD"** — better than nothing, but no preset shape (30 min / overnight / cost cap). The refocus plan's envelope presets are an improvement here.
5. **Strategy weights and perturbation config** are internal-only. For a user who understands the engine, this is the most impactful knob set they can't touch. Worth surfacing under a "Debug" expander, not as a default knob.

### Recommendations for the refocus plan's UX section

1. **Keep the `InferredPanel` pattern** — don't regress to "envelope presets only."
2. **Add `output_shape` to the inferred-then-editable set.** Smallest change with the biggest yield (per Appendix A).
3. **Adopt envelope presets** for the budget/duration row of the existing panel. Don't replace the panel.
4. **Add a "pause and edit" control during execution** that uses the same `InferredPanel` editors. This is the steerability win, leveraging UI you already have.
5. **Surface a mode toggle** on the entry box: `quick (30 min) | deep (overnight) | custom`. Mirrors the universal "mode" knob across comparators and is the simplest possible UX for envelope selection.
6. **Widen topic clusters** or replace with free-text + autocomplete (Appendix A §3).

### Comparative summary

| Dimension | Construct (current) | Construct (refocus as written) | Best comparator |
|---|---|---|---|
| Per-query primary input | 1 textarea | 1 textarea | 1 textarea (all) |
| Pre-submit knobs | 5 template buttons (prompt prefixes) | Envelope preset (3 choices) + template picker | Open Deep Search: mode + 5 env vars |
| Post-submit pre-run knobs | 6 inferred-then-editable fields | (Plan doesn't specify — likely none) | None — Construct is uniquely strong here |
| During-run controls | None | None | ResearStudio: pause/edit/resume; EDR: steering commands |
| Total user-touchable surface | ~12 knobs | ~5 knobs (regression) | Wide range, 2–10 |
| Surface complexity vs. usefulness | Good (inference hides defaults) | Slightly worse (loses inferred panel) | ResearStudio (3 modes + pause-edit-resume) is the most expressive without overwhelming |

The cleanest refocus-plan adjustment is **"keep the InferredPanel, add envelope presets, add output_shape, add a pause control."** That's strictly additive over today's UI and lands the highest-impact recommendations from both Appendix A and §1A of the main doc.
