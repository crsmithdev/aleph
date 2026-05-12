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
- **Schedule as the universal loop configuration**, a first-class artifact (`kind: 'schedule'`) that is **the complete editable surface** for every per-loop setting. No separate advanced/expert UI — every knob is a field on the schedule, every change is a schedule edit. The schedule artifact's payload covers the structural plan AND the run-level config:
    ```ts
    type SchedulePayload = {
      // structural plan
      canon: Array<{ id, query, rationale?, locked? }>;
      branches: Array<{
        id, seed_canon_id?, query,
        expected_depth, expected_cycles, budget_usd, priority,
        perturbation_weights, locked?,
      }>;
      milestone_plan: Array<{ at_envelope_pct, expected_state, replan_policy }>;
      // promoted from SessionConfig / mode preset
      envelope: { time?, cost?, cycles?, sources? };
      models: { planner, extractor, synthesizer };
      perturbation_config: {
        p_serendipity, max_p, depth_scaling,
        chain_length, strategy_cooldown, forced_diversity_threshold,
        default_leap_size: 'small' | 'medium' | 'large',
        // v2 gates — heuristic by default, LLM opt-in
        plausibility_gate: { enabled, mode: 'heuristic' | 'llm', threshold },
        utility_gate: { enabled, mode: 'heuristic' | 'llm', check_after_cycles, kill_action: 'stop_branch' | 'drop_branch' },
        yield_collapse_rescue: { enabled, threshold, lookback_cycles, burst_size },
      };
      flags: { fake_llm?, cached_planner?, watcher_mode?, /* etc. */ };
      // provenance
      predecessor_id?;                // links to prior schedule on re-plan
      created_with_mode?: string;      // metadata only — "default", "deep", "roam", …
      directives_consumed?;
      rationale: string;
    };
    ```
- **Schedule view** on the loop-detail page renders this artifact and is the **only** editor for it. Does triple duty: pre-run editing (in Custom mode, or after pausing a not-yet-started loop), mid-run editing (when paused), and historical viewing + fork-from-cycle (on completed runs). Same component, three states.
- **Locked-field mechanic.** Every schedule field has an implicit `locked` flag set when a non-planner author edits it. Milestone re-planner respects locks — it won't overwrite user-edited fields. Schedule view shows lock state visually.
- **Mode preset = named starting template.** Picking a mode at submit time selects which template constructs the initial schedule. After that, modes have no runtime presence — the schedule is what runs, and the mode label survives only as `created_with_mode` metadata. The v1 mode set:
    - **Quick** — small envelope, cheap models throughout, perturbation suppressed. "5-minute answer."
    - **Default** — balanced envelope and models. Perturbation tuned for many small leaps + sensible tangents: `p_serendipity ≈ 0.35`, cooldowns relaxed, forced-diversity threshold lowered, strategy weights biased toward small-magnitude leaps (analogical, scale_shift, context_swap). The default for most queries.
    - **Deep** — large envelope, premium models, Default's perturbation profile. Super-high effort.
    - **Roam** — Default envelope + heavy perturbation (`p_serendipity ≈ 0.45`, near-zero cooldown, weights biased toward medium- and large-magnitude leaps: perspective-shifts, network-walking, second-order). Chaotic + savant; high signal aim.
    - **Bonkers** — fully unhinged perturbation (`p_serendipity ≥ 0.6`, no cooldown, max weight on large-magnitude leaps; LLM temperature nudged up at framing). Entertainment-grade variance.
    - **Dev** — tiny envelope, fake/recorded LLM, for CI and UI testing.
    - **Eval** — Default-ish envelope, cached planner output (replays first-recorded planner response for reproducibility), intent-alignment introspection on. Runs against the v1 acceptance corpus.
    - **Custom** — opens the Schedule view immediately on a Default-template draft; user edits whatever they want before hitting Start. No separate UI; it's just "edit the schedule before running."
- **Modes always visible.** No developer-mode toggle gating Dev / Eval. The full row is in the compose box for everyone.
- **Per-role model selection.** `model_planner` / `model_extractor` / `model_synth` config fields. Default: strong on planning + synthesis, cheap on extraction.

**UX (from the design doc's configurability section):**

- **Compose box: prompt textarea + mode-button row.** The mode row contains the 8 modes above (Quick / Default / Deep / Roam / Bonkers / Dev / Eval / Custom). Default is selected when nothing else is, but the mode can also be **inferred from the prompt** at session-create time (cheap LLM call; user can override).
- **`InferredPanel` preserved**, with editors for `question_shape`, `output_shape` (new in v1), and `role` (new in v1 — `pickAgentRole` already runs, just expose its output for editing). The InferredPanel covers the *query classification* fields; the **Schedule view covers everything else**, including model / budget / perturbation / canon / branches / milestones.
- **Sidebar IA:** `Research`, `Monitors`, `Telemetry`. `WorkersPage` removed. Reviews tab folded into the report + a Debug tab.

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

**Phase 5 — Schedule as the universal loop config + Schedule view editor.**
`LoopSchedule` persists as `kind: 'schedule'` with the full payload (canon, branches, milestone plan, **plus envelope, models, perturbation_config, flags, mode metadata**). Re-plans at milestones produce chained schedule artifacts via `predecessor_id`. The Schedule view on the loop-detail page is the **only** editor for this artifact — does triple duty: pre-run editing (Custom mode opens here; other modes can also pause-before-start to edit), mid-run editing (when paused, v2), and historical viewing + fork-from-cycle (completed runs). Locked-field mechanic: every field has an implicit `locked` flag set when a non-planner author edits it; the milestone re-planner respects locks. `SessionConfig`'s scattered per-loop fields collapse into the schedule payload.
*Deliverable:* the user can see and (in Custom or paused state) edit every per-loop knob in one place. No advanced/expert panel anywhere in the system. Cost-per-run drops because the extractor runs on a cheap model.

**Phase 6 — UI rewrite.**
Compose box: prompt textarea + 8-button mode row (Quick / Default / Deep / Roam / Bonkers / Dev / Eval / Custom). `InferredPanel` preserved with editors for question_shape, output_shape, role. Schedule view from Phase 5 wired up as the universal editor. **Activity tab as a first-class live view** — real-time stream of cycles, events, decisions, intermediate outputs, and errors; co-equal with the Schedule and Artifact views, not relegated to a debug surface. Drop `WorkersPage` and the Reviews tab. Sidebar IA: Research / Monitors / Telemetry.
*Deliverable:* the loop-detail page shows three co-equal surfaces during a live run — **Activity** (live event stream), **Schedule** (current plan artifact, editable when paused or in Custom mode), **Artifact** (the report-in-progress). Mode buttons always visible. No advanced/expert panel anywhere.

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

## v2 — Stabilize and steer (organized around the Check primitive)

Immediately after v1 cutover. v2 unifies what was previously a handful of separate features (pause/edit, directives, adaptive stop, redundancy detection, self-healing, forks, watcher) under a single **Check** abstraction. A check is `(state, trigger) → action[]` — that one shape subsumes "AI watching and proposing edits," "user typing a directive," "heuristic noticing a stop condition," and "post-run introspection deciding what flagged" all in the same vocabulary.

```ts
type Check = {
  trigger: 'cycle_boundary' | 'event' | 'milestone' | 'on_finish' | 'on_user_action';
  scope:   'cycle' | 'branch' | 'loop' | 'run';
  author:  'heuristic' | 'llm' | 'user';
  condition: (state) => boolean;
  action: (state) => Action[];
};

type Action =
  | { kind: 'schedule_edit', patch }                  // amend the schedule artifact
  | { kind: 'directive', text, scope }                // nudge for next replan
  | { kind: 'stop', reason }                           // trigger stop_rule
  | { kind: 'perturbation_trigger', strategy }         // force a specific perturbation
  | { kind: 'flag', failure_mode: TypedFailureMode }   // emit telemetry
  | { kind: 'noop' };
```

Every author of change goes through this. Schedule edits and directives are actions, not separate APIs. The check log is the audit trail; the Schedule view's "edits applied" trail shows provenance per change.

### v2-A. Check framework (the primitive)

- The `Check` and `Action` types; check registry; event-stream subscription so any check can react to logged events.
- One API surface: `POST /loops/:id/checks` (for user-authored checks: pause-edits, directives, fork requests). Built-in checks register themselves via code.
- Schedule view shows "edits applied" trail keyed by check-author and action kind.
- Cooperative cancellation at cycle boundaries — the prerequisite for any check that wants to apply `schedule_edit` or `stop` mid-run.

### v2-B. Built-in checks (ship with the framework)

| Check | Trigger | Author | Typical action | Replaces what was previously called |
|---|---|---|---|---|
| **Marginal-value stop** | milestone | heuristic | `{ stop }` when last-N cycles show no new sources / no novel findings / no planner-confidence movement | v2.2 adaptive stop-rule |
| **Redundancy detector** | cycle_boundary | heuristic or cheap LLM | `{ perturbation_trigger }` or `{ schedule_edit: pivot_branch }` when a cycle's output is highly similar to prior cycles | v2.3 per-cycle redundancy |
| **Post-mortem with narrative** | on_finish | LLM | `{ flag }` with `failure_mode` + a human-readable narrative on the artifact, e.g. "47 of 60 threads explored cooking technique; only 13 on Bay Area restaurants" | v2.4 post-mortem narrative |
| **Intent-alignment** | on_finish | LLM | `{ flag: topic_drift / shape_mismatch }` when the produced document doesn't answer the original prompt in the requested form | new (was implicit in self-healing) |
| **Self-healing remediations** | event (on typed failure flag) | heuristic | `{ schedule_edit }` for known failure modes (`topic_drift` → re-plan canon; `shape_mismatch` → force renderer gate) | v2.6 self-healing layer |
| **Continuous watcher** | event (any of interest) | LLM (suggest-only by default) | `{ directive }` (suggest-only) or `{ schedule_edit }` (autonomous, opt-in per loop) | v2.8 watcher |
| **Plausibility gate** | pre-perturbation | heuristic (LLM opt-in) | `{ noop }` (allow firing) or `{ schedule_edit: skip_perturbation }` when proposed leap fails plausibility threshold | new — wraps perturbation system |
| **Utility gate** | cycle_boundary on perturbed branch | heuristic (LLM opt-in) | `{ noop }` (continue) or `{ schedule_edit: stop_branch }` when branch yields no novel findings in last N cycles | new — wraps perturbation system |
| **Yield-collapse rescue** | event (on `yield_collapse` flag) | heuristic | `{ perturbation_trigger }` — force high-novelty burst regardless of phase weighting | v2.6 (moved out of self-healing's `yield_collapse → escalate stop`; rescue tries first, marginal-value stop is the later backstop) |

Default behavior: built-in checks are on by default. Each can be disabled per-loop via the schedule's `flags` field. **All gates default to heuristic mode**; LLM judgment is an opt-in flag — in `perturbation_config` for the perturbation gates, in `flags` for the rest. The continuous watcher defaults to **suggest-only** — emits proposed edits as low-priority directives; user confirms or ignores. Autonomous mode is an opt-in toggle (likely on by default for Deep + Overnight runs since the user isn't watching).

### v2-C. User-authored checks (the universal intervention path)

The user produces checks too. Three ways:

| User action | Stored as | Effect |
|---|---|---|
| **Pause + edit schedule** | A user-authored check, trigger = `on_user_action`, action = `{ schedule_edit }` with the user's patch | The loop pauses, the patch is applied, the loop resumes from the edited schedule |
| **Send directive** ("focus on Bay Area places") | A user-authored check, trigger = `on_user_action`, action = `{ directive, scope: next_replan | permanent }` | The planner sees unconsumed directives on its next re-plan and incorporates them. Doesn't require pause. |
| **Fork from cycle N** | A user-authored check on a *completed* run, action = `{ schedule_edit }` plus loop-spawn with `parent_loop_id` and prior cycles as seed context | Produces a new loop branching from any historical cycle |

All three flow through the same API (`POST /loops/:id/checks`) and the same audit trail. The "directive channel" isn't a special concept — it's a check whose author is the user.

*Three intervention postures the user can move between:* AI-led (no checks posted), AI-led with nudges (occasional directive checks), human-led (pause + schedule_edit checks). The system stays autonomous by default; controls are always present in the UI without forcing a mode choice up front.

### v2.5 — Planner prompt tuning (separate from checks)

- v1's adaptive planner is fully LLM-driven. v2 evaluates planner outputs across the historical query corpus and tunes the prompt + few-shot examples for systematic failures.
- Adds a small set of "canonical good plans" drawn from the historical query corpus as in-prompt examples — closing the loop on what the deleted lookup table used to encode.
- *Empirical case:* the long tail of historically-bucketed `Misc` queries — verify the adaptive planner handles them at least as well as the old lookup. Standalone from the check framework; pure planner-quality work.

### v2 acceptance criteria

- A user can pause a 20-minute run, edit the schedule (via the Schedule view's editor — same UI as Custom mode's pre-run editor), and resume — without losing any completed cycles. The edit is recorded as a user-authored check with action `{ schedule_edit }`.
- A user can send a free-form directive ("focus on Bay Area places, less history") to a running loop. The next re-plan incorporates it; the Schedule view's edit-trail shows which directives the planner consumed.
- A user can fork any completed run from cycle N — same `POST /loops/:id/checks` API, action produces a new loop with `parent_loop_id`.
- The marginal-value-stop check's A/B on the historical corpus shows ≥ 80% agreement with "shape satisfied" outcomes and saves cost on ≥ 30% of runs (target — adjust after measurement).
- Every paused/failed run has a human-readable narrative on its post-mortem flag explaining what triggered.
- The intent-alignment check fires `topic_drift` on the Awesome-Deep-Research-style historical case (would have caught it).
- The continuous watcher emits at least one useful suggestion on a representative re-run of a historical multi-stage query (qualitative — verifies the watcher is wired up and reading the event stream).

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

**v1 ships:** loop engine + 4-hook template interface · research template · monitor template · cycle ledger · envelope · milestones · child-process per loop · output-shape enforcement · adaptive planner (replaces shape × topic lookup; URL-grounded; emits typed `LoopSchedule`) · **schedule as the universal loop config** (every per-loop knob is a field on the schedule artifact) · **Schedule view = universal editor** (pre-run / mid-run / historical) · **8-mode set** (Quick / Default / Deep / Roam / Bonkers / Dev / Eval / Custom; all visible, no dev gating) · **live Activity view as a first-class surface** · locked-field mechanic on schedule edits · per-role model selection · `InferredPanel` (shape, output_shape, role) · mockable LLM boundary · typed failure-mode identifiers · cost-as-observable · event-triggered background work · two real-LLM e2e tests.

**v1 does NOT ship:** mid-run *editing* of the Schedule view (read-only while running; editing only in Custom mode pre-run or paused state — pause itself is v2) · the **Check framework** and all checks built on it (marginal-value stop, redundancy detector, continuous watcher, self-healing remediations, intent-alignment, narrative post-mortems, user-authored checks for pause/directive/fork — all v2) · source-type specialized processors · engine-side context compression (digest artifact) · charts in renderer · heavy-modality cycles · pre-flight clarification flow · recursive sub-loops · new templates (code/writing/image) · cross-run features (related-runs panel, concept/source indexes, knowledge graph view — all v5).

### Roadmap

| Version | Theme | Headline features | Depends on |
|---|---|---|---|
| **v1 (MVP)** | Cutover with empirical fixes | Loop engine, research + monitor templates, output-shape enforcement, **adaptive planner**, **schedule as universal loop config** with Schedule view as universal editor, **8-mode set** (incl. Custom), live Activity view, per-role models. `InferredPanel` preserved + extended. Mockable LLM, typed failure modes, real-LLM CI. | — |
| **v2** | Stabilize and steer (Check framework) | **Check primitive** unifying schedule edits, directives, stops, perturbation triggers, flags. Built-in checks (marginal-value stop, redundancy detector, intent-alignment, narrative post-mortems, self-healing, continuous watcher — suggest-only by default). User-authored checks (pause-edit, directive, fork-from-cycle) through one API. Planner prompt tuning. | v1 schedule-as-config + typed failure modes + event log |
| **v3** | Extend | Source-type processors, context compression at milestones, charts in renderer, heavy-modality cycles, cross-template evaluator. | v2 stability |
| **v4** | New templates | Code-dev, long-form writing, image-iteration. Recursive sub-loops if needed. | v3 surface extensions |
| **v5** | Cross-run knowledge layer | Related-runs panel, cross-run concept and source indexes, knowledge graph view. Deferred to the end — per-run engine must be solid first. | per-run features stable across v1–v3 |

v1 is the cutover. v2 finishes what v1 lays down. v3 grows the surface. v4 proves the abstraction across genuinely different work shapes. v5 lifts the system from per-run to cross-run, once per-run is solid enough to be worth connecting.
