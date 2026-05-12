# Research engine — build plan

Companion to:
- `research-system-design.md` — comparator survey + observed-data analysis
- `research-system-principles.md` — operating constraints (single-operator scale, AI-maintainable, mockable LLM, typed failure modes, forkable runs, etc.)

This doc selects what ships in v1 (MVP) and roadmaps v2–v4. v1 is the hard cutover; v2 and v3 are additive.

---

## Principles

Inherits from `research-system-principles.md` (single-operator scale, AI-maintainable, typed contracts, mockable LLM, typed failure-mode identifiers, perturbation as primary, forkable runs, event-triggered background work). Build-plan-specific principles:

1. **Engine-deterministic, planner-adaptive.** Engine plumbing (input-hash dedup, priority dispatch order, cycle ledger, render from a fixed artifact set) stays deterministic — that's what enables crash-resume, forkable runs, and stable replay of state. Planning (canon, decomposition, budget allocation, strategy selection) is fully adaptive — each query gets a fresh LLM-planned `LoopSchedule`. Same prompt twice may produce different plans; same artifact set always produces the same render.
2. **Ship the abstraction with two templates at once.** Research alone produces a research-shaped engine. Monitor is small but forces the boundary to be honest.
3. **Fold in the empirical fixes** from the design doc's observed-data appendix. The Awesome-Deep-Research drift, the HSV/HPV table-not-produced, the Smashed-Burgers list-in-prose, the universal `low_finding_yield` flag — these are catchable in v1 with small additions to the spec baseline.
4. **Preserve what works today.** The `InferredPanel` "engine infers, user corrects" pattern. The 21-strategy perturbation menu. The typed `question_shape` detection. These are differentiators — the rewrite is the dispatcher, not the brain.
5. **One hard cutover, no coexistence.** Phases 1–6 land additively, Phase 7 deletes the old engine in one pass.
6. **Defer ambition.** Every comparator-derived feature whose empirical pain isn't visible in the dev DB waits for v2 or later.

---

## Feature inventory

### v1 (MVP) — IN

**Engine primitives (from refocus doc):**

- Loop primitive with four-hook template interface (`processor`, `derivation`, `renderer`, `stop_rule`)
- Cycle ledger with input-hash dedup for crash resume
- Envelope: `{ time?, cost?, cycles?, sources? }` — multiple stack, stops at first consumed
- Milestones at 25 / 50 / 75 % envelope consumption. Each emits a `kind: 'milestone'` artifact — a **user-facing** narrative summary (prose + citations + "what's confirmed / what's open / what's next") visible on the loop-detail page; the user can promote a milestone to the final artifact if the answer is already there. This is *not* the next-cycle's working context (that's the `digest` companion, v3.2).
- Child-process per loop, supervised by API server
- Schema cutover: `loops`, `cycles`, `artifacts`, `cycle_ledger`, `milestones`
- Within-loop priority float preserved (`ORDER BY priority DESC, created_at ASC`)
- `mapWithConcurrency`-based fanout inside a loop

**Templates (both ship together):**

- **Research template** — wraps today's `executeSearches`, `extractor.ts`, citation logic, perturbation strategies (promoted from defensive to primary `derivation` hook). Renderer = markdown report with sections, citations, references appendix, gaps section.
- **Monitor template** — wait-cycles and run-cycles per the refocus doc §Monitors extension. Renderer = weekly digest by default.

**Empirically-grounded additions (from Appendix A):**

- **Output-shape enforcement.** `output_shape` field populated at session create (one LLM call). Renderer gates the run on shape satisfaction. `stop_rule` becomes `schedule_complete OR envelope_consumed OR shape_satisfied`.
- **Adaptive planner.** Replaces today's `(question_shape × topic_cluster) → RunPlan` lookup in `run-plan.ts` with an LLM call that takes `(prompt, question_shape, output_shape, envelope)` and produces a typed `LoopSchedule` artifact. The 6-cluster topic taxonomy and the `SHAPE_DEFAULTS` budget table are deleted entirely. The planner produces seed canon, branch decomposition, per-branch budgets, and which perturbation strategies to favor. URL detection in the prompt feeds the planner (it grounds canon on URL contents) rather than running as a switch around a fixed lookup. The typed `question_shape` enum is retained as a planner *input* and renderer *constraint*, not as a lookup key.
- **Plan as a first-class artifact, visible and explorable in the UI** (`kind: 'schedule'`). Diffable. Re-plans at milestones produce new schedule artifacts with `predecessor_id`. Rendered on the loop-detail page as a tree/list: canon items, branches (with their queries, expected depth/cycles/budget, perturbation weights), and the milestone plan. Read-only while running; the same inline-editor pattern already in `InferredPanel` makes each field editable when paused (the editing UX itself ships in v2). Schedule payload shape: `{ canon[], branches[], milestone_plan[], predecessor_id?, directives_consumed?, rationale }`.
- **Per-role model selection.** `model_planner` / `model_extractor` / `model_synth` config fields. Default: strong on planning + synthesis, cheap on extraction.

**UX (from the design doc's configurability section):**

- **Keep the `InferredPanel`.** Carry it across the rewrite. Existing editors (shape, topic, run-plan) preserved.
- **Add `output_shape` editor** to the InferredPanel as a fourth inferred-then-editable field.
- **Envelope presets** as the entry surface (30 min / overnight / custom), sitting *alongside* the InferredPanel, not replacing it.
- **Sidebar IA:** `Research`, `Monitors`, `Telemetry`. `WorkersPage` removed. Reviews tab folded into the report + a `Debug` tab.

**Foundational infrastructure (from `research-system-principles.md`):**

- **Live inspectability as a first-class UI surface.** The Activity-equivalent view — real-time stream of cycles, events, decisions, intermediate outputs, errors — is co-equal with the artifact view on the loop-detail page. Not relegated to a debug tab. This preserves the current system's Activity-tab pattern and is the rendered form of the event log.
- **Mockable LLM boundary.** All real model calls go through one provider abstraction; a fake/recorded LLM drives tests and UI verification. Makes "verify through the UI" cheap in CI.
- **Single event log with typed failure-mode identifiers.** Every discrete step (events, decisions, evaluations, intermediate outputs, errors) writes to one log. Failure modes get stable typed IDs: `topic_drift`, `shape_mismatch`, `yield_collapse`, `thread_skew`, etc. The self-healing layer (v2) pattern-matches on these; the UI filters on them; the Activity view renders them.
- **Cost as a first-class observable.** Per-run, per-cycle, per-feature cost visible in the UI and in the event log without per-feature dashboard work.
- **Event-triggered background work.** Monitors, cleanups, and periodic tasks fire on logged triggers, not opaque crons.
- **Typed contracts end-to-end.** Frontend and backend share types. Artifact payloads, schema, API are all typed (extends today's `types.ts` discipline to the new tables).
- **Two real-LLM e2e tests in CI.** One with the cheapest models that produce usable output (smoke), one with optimal selections (quality).

### v1 — OUT (explicit deferral list)

Each item below could plausibly be in v1 — they're called out so the boundary is honest.

| Deferred | Why not in v1 | When |
|---|---|---|
| Mid-run pause / edit / resume control | v1 builds the schedule artifact (the foundation); v2 wires the control. Keeps v1 focused on cutover not UX expansion. | v2 |
| Adaptive value-based stop-rule | Needs A/B against fixed envelope. A bad scorer is worse than no scorer. | v2 |
| Per-cycle redundancy detector (HiPRAG-style) | Same — needs to be measured before defaulting on. | v2 |
| Post-mortem narrative content | Today flags are empty-content; filling them is a small UX win but unrelated to the engine cutover. | v2 |
| Source-type specialized processors (academic, GitHub, directory, restaurant) | Wants the research template stable before adding processor diversity. | v3 |
| Engine-side context compression at milestones (ReSum-style `digest`; distinct from v1's user-facing `milestone` artifacts) | No observed need yet in the dev DB — runs hit yield walls and shape mismatches before context-window walls. Belongs with heavy-modality / overnight envelopes. | v3 |
| Charts in renderer (FDV-style) | No observed need. Renderer hook supports it later. | v3 |
| Heavy-modality cycles (books, PDFs, images) | Was step 5 of the refocus build order. Decouple from v1. | v3 |
| Pre-flight clarification flow | The InferredPanel already does most of what this is for. Promote only if needed. | maybe v2, maybe never |
| Recursive sub-loops via `parent_loop_id` | Opt-in per template. Add when a template demands it. | v4 |
| Code-dev / image-iteration / long-form writing templates | After the engine is proven stable on research + monitor. | v4 |
| Related-runs panel, cross-run concept/source indexes, knowledge graph view | Cross-run features intentionally deferred to the end — per-run engine must be solid first. | v5 |
| LangGraph / MCP adoption | Skip entirely. Bespoke is right for Construct. | never |

---

## v1 build order

Eight phases. Phases 1–6 additive (old engine still runs). Phase 7 single-pass deletion. Phase 8 marks v1 complete.

**Phase 1 — Schema + engine skeleton.**
DDL for `loops`, `cycles`, `artifacts`, `cycle_ledger`, `milestones`. Engine core: envelope ticking, cycle dispatch, ledger reads, milestone hook, child-process spawn from API. No templates yet.
*Deliverable:* a "noop template" runs a fake loop end-to-end. Cycle ledger survives a kill.

**Phase 2 — Research template + monitor template, together.**
Research processor / derivation / renderer / stop_rule wraps today's logic. Monitor template (small — wait-cycles, run-cycles, diff-renderer) ships in parallel to keep the engine boundary honest.
*Deliverable:* both templates run end-to-end against the new engine, in parallel with the old engine.

**Phase 3 — Output-shape enforcement.**
Detect `output_shape` at session create. Renderer-as-gate: if shape unsatisfied, request more derivation before declaring done. `stop_rule` rejects "done" without shape.
*Deliverable:* HSV/HPV-style queries produce the requested table. Berkeley-volunteering-style queries produce a list.

**Phase 4 — Adaptive planner.**
Delete `run-plan.ts`'s `(shape × topic) → RunPlan` lookup, the 6-cluster `TOPIC_CLUSTERS` constant, and the `SHAPE_DEFAULTS` budget table. Add a planner LLM call that emits a typed `LoopSchedule`: `{ canon[], branches[], per_branch_budget, perturbation_weights, milestone_plan }`. Inputs: the prompt, detected `question_shape`, detected `output_shape`, and the envelope. URL detection in the prompt feeds the planner as a grounding signal (contents fetched, supplied as canon seed) rather than as a separate code path.
*Deliverable:* Awesome-Deep-Research-style queries don't pull AlphaFold/Adam optimizer — the planner sees the GitHub URL and grounds canon on the listed projects.

**Phase 5 — Plan as artifact + UI exploration + per-role model selection.**
`LoopSchedule` persists as `kind: 'schedule'` (initial + each milestone re-plan, chained by `predecessor_id`). New "Schedule" view on the loop-detail page renders the current schedule as a tree: canon → branches → per-branch budget + perturbation weights, plus the milestone plan. Read-only in v1 (editing comes with v2's pause/resume). `SessionConfig` gains `model_planner` / `model_extractor` / `model_synth` fields.
*Deliverable:* the user can see what the planner decided for a running or completed loop and diff against prior plans. Cheap model runs extraction; cost-per-run drops.

**Phase 6 — UI rewrite.**
Keep `InferredPanel`. Add envelope presets. Add `output_shape` editor. Add the explorable Schedule view (Phase 5 deliverable). **Keep the Activity tab as a first-class live view** — real-time stream of cycles, events, decisions, intermediate outputs, and errors. Per `research-system-principles.md`, live inspectability is essential and not relegated to a debug surface. Drop `WorkersPage` and the Reviews tab. Sidebar IA: Research / Monitors / Telemetry.
*Deliverable:* the entry experience is the existing InferredPanel + envelope presets. The loop-detail page shows three co-equal surfaces during a live run — Activity (live event stream), Schedule (current plan artifact), and Artifact (the report-in-progress). No regression on the existing Activity-tab pattern.

**Phase 7 — Cutover.**
Delete in one pass: `research_jobs`, `worker.ts`, `services/jobs.ts`, `scheduler.ts`, `research_perturbation_state` table, `research_monitor_*` tables, `WorkersPage`, `ResearchReviewsView`. Drop `schedule.mode = 'default'|'scheduled'|'priority'`.
*Deliverable:* single PR, single migration script. Old engine code gone.

**Phase 8 — v1 complete.**
Acceptance checks (below) pass. v2 work can begin.

### v1 acceptance criteria

- Awesome-Deep-Research-style prompt produces a doc grounded on URL contents, not on deep-learning canon.
- HSV/HPV-style prompt produces an actual table with the requested columns.
- Smashed-Burgers-style prompt produces history AND the requested list (because `output_shape` enforces "list ≥ 5 places").
- Today's user re-runs disappear from the dataset: the system either produces the right thing or pauses with a clear shape-unsatisfied signal the user can edit.
- Cost per run trends downward (extractor on cheap model).
- Monitor template works against the same engine — proves the abstraction is honest.
- **Live Activity view streams events, cycle starts/ends, planner decisions, perturbation firings, extraction outcomes, and errors in real time during a running loop — no refresh required, no dev tools needed.** Parity with today's Activity tab is the floor, not the ceiling.
- `bun test.ts` + `bun run build` + `bun run ui:smoke` all green.

---

## v2 — Stabilize and steer

Immediately after v1 cutover. Theme: turn v1's foundations into the steerable, self-aware engine the survey pointed toward. Each item depends on something v1 lays down.

**v2.1 — Strong mid-run steerability: pause, edit, nudge, resume.**
v1's schedule-as-artifact + Schedule view + InferredPanel editors do most of the work. v2 turns pause into an authoring mode and adds a free-form directive channel.

*Pause / edit / resume:*
- `paused` state on the loop row (cooperative cancellation point in the processor — checks between cycles)
- API: `POST /loops/:id/pause`, `POST /loops/:id/resume`, `PATCH /loops/:id/schedule`
- UI: "Pause" button in the live surface; while paused, the Schedule view becomes editable (every canon item, branch, budget, perturbation weight); "Resume" re-spawns with the edited schedule

*Directive channel (the "nudge" capability):*
- New artifact kind `directive` with payload `{ text, scope: 'next_replan' | 'permanent', author, consumed_by_schedule_id? }`
- API: `POST /loops/:id/directives` (works whether running or paused)
- UI: "Send directive" text box on the live surface — free-form input like "focus on the Bay Area portion" or "skip the history, dig into the places themselves"
- The planner sees recent unconsumed directives on its next re-plan and incorporates them; `permanent` directives stick around for subsequent re-plans, `next_replan` directives burn on use
- Directives appear in the schedule view's "directives consumed" trail so the user can see which nudges the planner took on

*Three modes the user can move between:*
- AI-led: no intervention, default
- AI-led with nudges: drop directives, planner adapts on next re-plan
- Human-led: pause, edit schedule directly, resume

*Empirical case:* the universal observed failure mode (Appendix A). Highest single-feature ROI. Closes the "fire-and-forget" gap that ResearStudio's paper identifies as the single biggest difference between controllable and uncontrollable deep-research systems.

**v2.2 — Adaptive value-based stop-rule.**
- Cheap heuristic over accumulated artifacts: `(last-N findings similarity, last-N citation novelty, last-N planner confidence)`
- Wired into `stop_rule` as a fourth clause: `... OR value_stalled`
- Default OFF, A/B against fixed envelope on the existing query corpus, default ON when it wins
- *Empirical case:* CRDT re-runs (Appendix A) — most ran into yield walls before the envelope was full.

**v2.3 — Per-cycle redundancy detector** (HiPRAG-style).
- Per-cycle classifier: was this cycle redundant with prior cycles? Was a needed cycle skipped?
- Output fed back into the derivation hook (`should we run another cycle on this branch or pivot?`) and exposed in telemetry
- Refines the existing perturbation strategy selector with a quality signal

**v2.4 — Post-mortem narrative content.**
- Fill the empty `content` field on the post-mortem row with an actual LLM-generated narrative explaining each flag
- Surface in the InferredPanel after a run paused/failed: "the engine flagged thread_skew because 47 of 60 threads explored cooking technique vs. only 13 on Bay Area restaurants — want to rebalance?"
- *Empirical case:* the universal `low_finding_yield + thread_skew` flag pattern (Appendix A). The flags exist; the user can't see why.

**v2.5 — Planner prompt tuning.**
- v1's adaptive planner is fully LLM-driven. v2 evaluates planner outputs across the historical query corpus and tunes the prompt + few-shot examples for systematic failures
- Adds a small set of "canonical good plans" for representative shape × topic combinations as in-prompt examples (closing the loop on what the deleted lookup table used to encode)
- *Empirical case:* the long tail of historically-bucketed `Misc` queries — verify the adaptive planner handles them at least as well as the old lookup

**v2.6 — Self-healing layer** (from principles doc).
- The system evaluates its own outputs against the design goals declared for each run (shape, coverage, intent alignment) and flags when they aren't met — using the typed failure-mode IDs from v1
- Auto-remediation for a small set of failure modes: `topic_drift` → re-plan canon; `shape_mismatch` → force renderer gate; `yield_collapse` → trigger adaptive stop
- *Empirical case:* the universal `low_finding_yield + thread_skew` pattern (Appendix A) — the system already detects, doesn't act

**v2.7 — Forkable runs** (from principles doc).
- Any completed or paused run can be branched from any cycle: "what if the plan had been different here"
- Cheap because v1 made the schedule a first-class artifact and the cycle ledger keys by input hash
- UI: a "fork from cycle N" action on the loop-detail page; produces a new loop with `parent_loop_id` and the prior cycles as seed context
- *Empirical case:* today's silent re-runs (Appendix A) — the user is doing this manually by re-submitting the same prompt

### v2 acceptance criteria

- A user can pause a 20-minute run, edit the schedule (e.g., add a sub-question or kill a wandering thread), and resume — without losing any completed cycles.
- A user can send a free-form directive ("focus on Bay Area places, less history") to a running loop and observe the next re-plan incorporate it. The schedule view shows which directives the planner consumed.
- A user can fork any completed run from cycle N, producing a new loop with the schedule editable from that point.
- The adaptive stop-rule's A/B on the historical corpus shows ≥ 80% agreement with "shape satisfied" outcomes and saves cost on ≥ 30% of runs (target — adjust after measurement).
- Every paused/failed run has a human-readable narrative explaining what flagged.
- The system auto-flags `topic_drift` on the Awesome-Deep-Research-style historical case (would have caught it).

---

## v3 — Extend the engine

After v2 stabilizes. Theme: grow the surface so heavier, more varied research workloads work as well as today's quick queries do.

**v3.1 — Source-type specialized processors.**
- Typed processors under the research template: `web_search` (today's default), `academic` (arXiv, Semantic Scholar), `github` (repo + README aware), `directory` (Idealist / VolunteerMatch / Yelp shape), `pdf` (heavy-modality)
- Planner chooses the mix based on `(shape × topic × prompt_signals)`. Extended `RunPlan` includes `processor_mix`.
- *Empirical case:* Berkeley Volunteering (688 sources, no directory processor), Smashed Burgers (no restaurant-directory processor), Awesome-DR (no GitHub-aware processor).

**v3.2 — Engine-side context compression at milestones.**
This is the **engine-facing companion** to v1's user-facing `milestone` artifacts. The two are co-produced at each 25/50/75 % checkpoint but serve different consumers.

- New artifact kind: `digest` — compact structured state (open questions, confirmed findings, gaps, recent decisions) consumed by the **next cycle's LLM prompt**. Distinct from `milestone`, which is the user-facing narrative summary.
- After each checkpoint, the working context fed into the next cycle is `digest + recent_cycles`, not `all_artifacts`. The user-facing milestone artifact is unchanged by this — only the next cycle's prompt input changes.
- Per-template "window strategy" declaration: `{ full | digest | digest_plus_recent_N }`.
- Production: a single milestone LLM call emits both shapes (or one to make the narrative, a cheap second extraction pass to derive the digest) — co-produced, not double-paid.
- Unblocks: overnight envelopes (12+ hours), heavy-modality runs (books/PDFs/images), monitor inner-loops with long histories. None of which v1 needs to support.

**v3.3 — Charts in the renderer.**
- New artifact kind: `chart` with FDV-style structured payload.
- Research template's extractor optionally produces chart specs when data is numeric.
- Renderer interleaves text + charts. Existing `ChartContainer` UI primitive renders Vega-Lite.
- Includes verification: chart data must cite findings; renderer rejects unsourced charts.

**v3.4 — Heavy-modality cycles** (books, PDFs, long-form video).
- Source-list-bounded envelope already supports it; this phase wires the cycle shapes (chapter, transcript, image) and the per-source cycle ledger granularity.
- Defers cycle-ledger sub-keying decision (refocus doc open question) — settle it here.

**v3.5 — Cross-template evaluator** (formalized post-mortem).
- The `eval-harness` skill grows a "score this loop against its `output_shape`" capability.
- Runs against the historical query corpus to produce a quality leaderboard per release.
- Borrowed concept from RAG-Gym's critic axis (Appendix A — kept the idea, deferred adoption to here).

### v3 acceptance criteria

- A heavy-modality envelope (e.g., "summarize these 10 PDFs into a comparison table") runs to completion on the same engine.
- An overnight envelope works without context-window failure.
- The eval-harness produces a comparable quality score per release; regressions block deploys.

---

## v4 — New templates (the long horizon)

Speculative beyond v3 but worth noting because the abstraction was built for it.

- **Code-dev template.** Cycle = agent makes a change, tests run, diff is the artifact. Derivation = next agent prompt from test results.
- **Long-form writing template** (WriteHERE-style). Recursive task decomposition; retrieval / reasoning / composition interleaved.
- **Image-iteration template.** Cycle = model generates an image, critique runs. Derivation = next prompt from prior image + critique.
- **Recursive sub-loops via `parent_loop_id`.** Add when a template demands it (none of the above strictly require it).

Each new template is roughly 200–500 LOC under the four-hook contract. No engine changes expected.

---

## v5 — Cross-run knowledge layer (deferred to the end)

Cross-run features intentionally land after every per-run feature is solid. The per-run engine has to be trustworthy before relationships *between* runs are useful — surfacing "related runs" on top of a flaky engine surfaces flaky relatedness. Three layered features, smallest first.

**v5.1 — Related-runs panel on the loop-detail page.**
- At session create, run the existing concept extraction (already in `services/concepts.ts`), compute Jaccard overlap against the concept sets of the N most recent prior queries, surface the top 3–5 most-related as links on the loop-detail page.
- Cheap (~150 LOC) because it reuses extraction that already runs per-finding. Just needs a cross-session join and a small UI panel.
- Does *not* auto-merge prior context into the new run; it's purely a navigational link.

**v5.2 — Cross-run concept and source indexes.**
- New tables (or materialized views) keyed by `concept` → `[query_ids]` and `source_url` → `[query_ids]`. Updated on session completion.
- Powers richer relatedness — "queries that share this exact source," "queries about this concept" — without indexing the underlying findings text.
- Enables the v5.3 graph view; on its own, also useful for backend telemetry and post-hoc analytics.

**v5.3 — Knowledge graph view.**
- New top-level sidebar entry alongside Research / Monitors / Telemetry.
- Visual graph: query nodes + concept nodes + source nodes, edges = "shares concept" / "cites source" / "directly references."
- Explorable, filterable. The graph data is the v5.2 indexes rendered.
- Implementation note: this is a UI-heavy feature. The data layer (v5.2) is the load-bearing part; the visualization is interchangeable.

**Cross-session continuity remains opt-in.** The v5 features surface related prior runs to the user as navigation; they do not auto-merge prior context into the new run's prompt. Carrying prior context into a new run is a separate opt-in (still deferred — no plan element pushes for it).

### v5 acceptance criteria

- From any loop-detail page, the user sees up to 5 related prior queries based on shared concepts.
- A concept page (or filter) shows every query that mentioned that concept; a source page shows every query that cited that URL.
- The knowledge graph view loads in under 2 s for the user's full query history (target — adjust after measurement).
- v5 features add zero cost to the per-run pipeline (cross-run indexing runs at session completion, not during the loop).

---

## Risk register

The three things to watch across v1.

1. **`output_shape` detection accuracy.**
   - *Risk:* the LLM misdetects "table" when the user wanted prose. Renderer forces a table for everyone.
   - *Mitigation:* keep it editable in the InferredPanel; default to `prose` unless the prompt explicitly says "table" / "list of N" / "timeline".

2. **Adaptive planner regresses query types the lookup table got right by accident.**
   - *Risk:* lookup / audit queries today happen to land on reasonable defaults because their topics fit the existing 6-cluster taxonomy. An adaptive planner with a weak prompt could regress these.
   - *Mitigation:* before deleting the lookup table, run the adaptive planner on the historical query corpus and compare schedule outputs to the lookup-derived plans on the queries the lookup got right. Block the cutover if the planner regresses on > 10% of them. Encode the lookup's good defaults as few-shot examples in the planner prompt rather than as a code path.
   - *Loss accepted:* planner output is no longer byte-deterministic. Same prompt twice may produce different plans. The user explicitly accepted this tradeoff. Reproducibility at the engine layer (input-hash dedup, dispatch order, render-from-artifacts) is preserved.

3. **Schema cutover blast radius.**
   - *Risk:* the single Phase-7 migration touches 4+ tables. If something goes wrong, the entire research surface is down.
   - *Mitigation:* migration script runs against a copy of the dev DB first; diff outputs of 5 representative historical queries between old and new engine before production cutover; keep the old tables as `_legacy_*` for one release in case rollback is needed.

---

## Out of scope across all versions

Worth restating since the comparison doc surveyed them and decided no:

- **LangGraph or any Python-based workflow framework.** Construct is TypeScript; the engine is small enough that adopting a framework loses more than it gains.
- **MCP tool ecosystem.** Construct doesn't need it. Revisit if Construct grows toward enterprise / multi-tool integrations.
- **Cross-loop scheduler / job queue / worker pool.** The whole point of the rewrite is to delete this layer.
- **Training a custom model.** Construct uses provider LLMs and is not a model-training project.

---

## Summary

### Feature inventory at a glance

**v1 ships:** loop engine + 4-hook template interface · research template · monitor template · cycle ledger · envelope · milestones · child-process per loop · output-shape enforcement · adaptive planner (replaces shape × topic lookup; URL-grounded; emits typed `LoopSchedule`) · **plan-as-artifact rendered as an explorable Schedule view in the UI** · **live Activity view as a first-class surface (real-time event/cycle/decision stream)** · per-role model selection · InferredPanel (preserved + `output_shape` editor added) · envelope presets · mockable LLM boundary · typed failure-mode identifiers · cost-as-observable · event-triggered background work · two real-LLM e2e tests.

**v1 does NOT ship:** Schedule view *editing* (read-only in v1; editing comes in v2) · pause/resume control · directive (nudge) channel · adaptive stop · per-cycle redundancy detector · narrative post-mortem content · self-healing remediation · forkable runs · source-type specialized processors · context compression · charts in renderer · heavy-modality cycles · pre-flight clarification flow · recursive sub-loops · new templates (code/writing/image) · cross-run features (related-runs panel, concept/source indexes, knowledge graph view — all v5).

### Roadmap

| Version | Theme | Headline features | Depends on |
|---|---|---|---|
| **v1 (MVP)** | Cutover with empirical fixes | Loop engine, research + monitor templates, output-shape enforcement, **adaptive planner** (replaces shape × topic lookup), plan-as-artifact, per-role model selection. Keep `InferredPanel`. Mockable LLM, typed failure modes, real-LLM CI. | — |
| **v2** | Stabilize and steer | **Strong mid-run steerability** (pause + edit + free-form directive channel), adaptive stop, redundancy detector, narrative post-mortems, planner prompt tuning, self-healing layer, forkable runs. | v1 plan-as-artifact + Schedule view + typed failure modes |
| **v3** | Extend | Source-type processors, context compression at milestones, charts in renderer, heavy-modality cycles, cross-template evaluator. | v2 stability |
| **v4** | New templates | Code-dev, long-form writing, image-iteration. Recursive sub-loops if needed. | v3 surface extensions |
| **v5** | Cross-run knowledge layer | Related-runs panel, cross-run concept and source indexes, knowledge graph view. Deferred to the end — per-run engine must be solid first. | per-run features stable across v1–v3 |

v1 is the cutover. v2 finishes what v1 lays down. v3 grows the surface. v4 proves the abstraction across genuinely different work shapes. v5 lifts the system from per-run to cross-run, once per-run is solid enough to be worth connecting.
