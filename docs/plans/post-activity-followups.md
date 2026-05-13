# Post Activity-Rebuild Follow-ups

Living doc for the work that remains after `feat/activity-tab-rebuild` landed on `main` (commits `ee64f8c` → `04925b5`, 2026-05-12).

The Activity tab is mockup-parity — KPI strip, Cycle Lifecycle, Post-Mortem, Iteration Checks, Source Extraction, Branch State, Decisions, and the filterable Event Log all render against real loop data. Cost flows correctly into `envelope_consumed.cost_usd`. The remaining work is broken into five threads below.

Track status here as items land. Each item lists the trigger files / mockups / acceptance gate so a fresh context can pick up without rediscovering the surface.

---

## 1. Document / Plan / Config tabs — mockup parity

**Status:** ✅ done — landed on main 2026-05-12 (commits `2096383` + `dbf861f`).

### What shipped
- **Document tab** — two-column layout with sticky References rail; meta strip with polished/raw pill, model, source count, regenerate button; numbered citations with per-source extraction-status pills.
- **Plan tab** — summary cell strip (output_shape, branches, budget, milestones); branch cards with effective budget + override dot + "ran" pill; canon / branches / sources wrapped in shared Panel.
- **Config tab** — Loop / Schedule / Envelope / Models panels using shared CfgRow; **Models** is new — surfaces `iteration_check_model` and `post_mortem_model` from `research_defaults` via `/api/research/defaults`.

### Verification
196/0 `bun test.ts`, 134/0 loop suite, UI build clean, 17/0 `e2e/activity-panels.test.ts` (no regression), 30/0 new `e2e/tab-parity.test.ts` gate.

### Carveouts (deliberately deferred)
- **Config models are global, not per-loop snapshot.** Engine reads them at startup from `research_defaults`; not echoed into the loop row. Phase 5's `SchedulePayload` collapse will fix this — at which point Config should read from the artifact.
- **TOC column** on Document tab not added — polish prompt doesn't emit stable `<h2>` structure.
- **Tree view of branches** on Plan tab not added — loops engine plans flat `branches[]`; Phase 5 `predecessor_id` would make a tree view meaningful.

The Activity tab was the only one that got a mockup-driven rebuild this cycle. The other three live in `src/ui/web/src/pages/research/ResearchLoopDetail.tsx` (`DocumentTab`, `PlanTab`, `ConfigTab`) and were ported from the v0 page structurally — they have not been audited against `docs/mockups/research/query-detail.html` (or whichever mockup is canonical for the tab in question).

**Touch files**

- `src/ui/web/src/pages/research/ResearchLoopDetail.tsx` — DocumentTab (line ~272), PlanTab (line ~754), ConfigTab (line ~864)
- `docs/mockups/research/query-detail.html` — primary mockup for the per-loop detail page

**Acceptance**

- Each tab renders the same surface as the mockup, with the loops-engine fields filled in (e.g. ConfigTab should show `iteration_check_model` / `post_mortem_model` from `research_defaults` now that those exist).
- `bun run --cwd src/ui build` clean.
- A `src/ui/e2e/tab-parity.test.ts` Playwright gate that boots the API + fake LLM, loads a finished loop, and asserts each tab's anchor testids render.

---

## 2. Legacy concession sweep (80+ items)

**Status:** ✅ done — landed on main 2026-05-12 (commits `1b05891` → `883a83b`, six in sequence).

### What shipped
- **Deletes**: `src/research/src/perturbation.ts` (-267), `src/research/src/similarity.ts` (-163), `src/research/src/providers/router.ts` (-64), `src/ui/web/src/api/monitor-hooks.ts` (-106).
- **Type purge**: `src/research/src/types.ts` 650 → 178 lines (-473) — removed `ResearchQuery`, `ResearchThread`, `ResearchFinding`, `Concept`, `Source`, `ResearchStep`, `Monitor*`, `JobStatus`, `PerturbationStrategy`, and dead `SessionConfig` subfields; `defaults.ts` merge fan-out shrunk to match.
- **Event-type purge**: dropped the v0 union (`thread/job/step/finding/source/concept/concept_link/query`) from `services/events.ts`.
- **Comment rewords**: 7 files updated to describe the v1 path rather than the v0 path.
- **Net**: 16 files, +180 / -1170 lines.

### Verification
196/0 `bun test.ts`, 134/0 loop suite, UI build clean, 17/0 `e2e/activity-panels.test.ts`, 30/0 `e2e/tab-parity.test.ts`.

### KEEP rationale (not deleted)
`SessionConfig` + most of its subfields (live in `defaults.ts` + `/api/research/defaults` + `config-schema.tsx`); `topic_coherence`, `follow_up`, `gap_analysis`, `role_priming_*`, `iteration_check_model`, `post_mortem_model`, `model_fast` (live in UI schema or loop templates); `MODEL_PRICING` (cost telemetry); UI mirror types in `research-hooks.ts` and the History/Landing pages (kept as graceful-degradation shim — folding those pages onto a native loops shape is a separate UX migration); `ddl.ts:dropLegacyTables()` (idempotent dev safety net); `ResearchWorkersPage.tsx` + `planner.ts` comments that describe architectural shifts.

The prior session's Explore subagent cataloged 80+ legacy v0 concepts surviving in v1 code. They're grouped by category but the SARIF/JSON findings were not persisted, so the sweep re-discovered them first, then deleted each unused trace per CLAUDE.md commandment 7 ("when removing something, remove it completely").

**Categories (from the original audit)**

| Tag | Theme | Where |
|---|---|---|
| T1–T9 | Type carry-overs from v0 | `src/research/src/types.ts` (~250 lines to delete) |
| A1–A3 | Adapter shims | various |
| F1–F4 | Field-level zeroes | various |
| D1–D4 | Dead config fields | `SessionConfig` |
| U1–U10 | UI rendering of v0 concepts | `src/ui/web/src/api/research-hooks.ts` (~240 lines), `HistoryFilterRail`, `ResearchHistoryPage`, `HistorySummaryStrip`, `ResearchLandingPage` |
| C1–C5 | Dead comments | various |
| P1–P2 | Provider-config dead fields | `src/research/src/providers/router.ts` (likely fully dead) |
| L1 | DDL cleanup | `src/research/src/ddl.ts` |

**Acceptance**

- Re-audit lands as a new finding list in this doc (one sub-section per category, with file:line cites).
- Each finding either deleted with a one-line justification, or marked "keep — used by X" with the consumer named.
- `bun test.ts` + `bun test src/research/src/loop/` + `bun run --cwd src/ui build` + `src/ui/e2e/activity-panels.test.ts` all green after.

### Findings (audit re-run, 2026-05-12)

Audit done by walking every suspect file the prior session flagged and grepping each
type / field / hook / route for live consumers. Only the loop engine + the
schema + the two surviving routes (`/research/config`, `/research/defaults`)
have real callers; everything else is orphan from the Phase 7 cutover.

#### T — Backend type carry-overs (`src/research/src/types.ts`)

Live consumers of `SessionConfig` and `DEFAULT_SESSION_CONFIG` are:
`src/research/src/services/defaults.ts` (read/write `research_defaults`),
`src/ui/api/src/routes/research.ts` (the `PUT /defaults` handler),
`src/ui/web/src/pages/research/config-schema.tsx` (the editable form), and the
`ResearchDefaults` shape mirrored in `src/ui/web/src/api/research-hooks.ts`.
Everything below is loaded by nothing.

- `types.ts:1-28` `ResearchQuery` — **DELETE** — no caller; loop engine has its own `Loop` type. UI mirror lives in `research-hooks.ts`.
- `types.ts:30-31` `ResearchSession` `@deprecated` alias — **DELETE**.
- `types.ts:33-43` `PromptShape | PromptDepth | PromptAudience | PromptUrgency | PromptHints` — **DELETE** — only embedded in `ResearchQuery` (also being deleted). UI mirror keeps its own copies.
- `types.ts:50-94` `QuestionShape | ShapeLens | ShapeAnalysis | TopicCluster | TopicClusterAnalysis` — **DELETE** — only embedded in `ResearchQuery`. UI mirrors its own.
- `types.ts:298-300` `ThreadOrigin | ThreadStatus` — **DELETE** — only used by `ResearchThread`.
- `types.ts:302-328` `PerturbationStrategy` enum — **DELETE** — only consumed by `perturbation.ts` (also dead) and `ResearchThread`.
- `types.ts:330-350` `ResearchThread` — **DELETE** — no caller; loops use `Cycle`.
- `types.ts:352-360` `FindingKind` — **DELETE** — only embedded in `ResearchFinding`.
- `types.ts:362-382` `ResearchFinding` — **DELETE** — no caller.
- `types.ts:384-408` `Concept | ConceptLink | ConceptWithStats` — **DELETE** — concept tables dropped Phase 7.
- `types.ts:410-426` `SourceExtractionStatus | Source` — **DELETE** — sources table dropped Phase 7; the activity-tab "Source Extraction" panel reads loop artifacts, not this shape.
- `types.ts:428-446` `ResearchStep | ToolCallRecord | JinaFetchRecord` — **DELETE** — research_steps table dropped Phase 7; loop telemetry is in `cycle_ledger`.
- `types.ts:455-461` `ToolCallRecord | JinaFetchRecord` (already in 428-446 bundle).
- `types.ts:463-481` `FollowUpCandidate | FollowUpAnalysis` — **DELETE** — only embedded in `ResearchFinding`; loop follow-ups are inline in `decisions.ts` decision payloads.
- `types.ts:483-502` `StepMetadata | PerturbationTrigger` — **DELETE** — no caller.
- `types.ts:504-534` `ResearchPlan | ResearchPlanItem | PlanModification` — **DELETE** — research_plans table dropped Phase 7; loops have `LoopSchedule` in `loop/types.ts`.
- `types.ts:536-602` `Monitor | MatchCriteria | MonitorSnapshot | MonitorAlert | ProposedMonitor` — **DELETE** — every monitor table dropped Phase 7; `loop/templates/monitor.ts` is a loop template that doesn't use these shapes.
- `types.ts:604-625` `JobStatus | JobMode | ResearchJob` — **DELETE** — research_jobs table dropped Phase 7.
- `types.ts:96-296` `SessionConfig` + `DEFAULT_SESSION_CONFIG` — **KEEP** — used by `defaults.ts`, the `/defaults` route, and the UI config form. Subfields to scrub:
  - `topic_coherence` (lines 111-114, 250-253) — **KEEP** — wired in `config-schema.tsx:61-62` (advanced fields).
  - `perturbation_coherence_floor` (line 122, 254) — **DELETE** — no schema entry, no loop consumer.
  - `perturbation: PerturbationConfig` (line 159, 267-295) — **DELETE** — no schema entry, no loop consumer, `perturbation.ts` is dead.
  - `follow_up` (line 160-165, 244-249) — **KEEP** — wired in `config-schema.tsx:41-43`.
  - `gap_analysis` (line 169-178, 258-263) — **KEEP** — wired in `config-schema.tsx:52-53`.
  - `role_priming_enabled | role_label | role_prompt` (lines 153-158, 241-243) — **KEEP** — loop's research template reads these (planner role priming).
  - `iteration_check_model | post_mortem_model | model_fast` (lines 124-135, 221-223) — **KEEP** — loop template hooks consume them.
- `types.ts:184-190` `PerturbationConfig` — **DELETE** with the rest of the perturbation tree.
- `types.ts:631-650` `MODEL_PRICING` — **KEEP if a consumer exists; check during deletion** — providers/openrouter has its own pricing call (`getOpenRouterPricing`); this static table may be dead too.

#### A — Adapter shims (`src/ui/web/src/api/research-hooks.ts`)

- `research-hooks.ts:88-105` `ResearchQuery` UI mirror — **KEEP** — consumed by `ResearchLandingPage`, `ResearchHistoryPage`. (See U.)
- `research-hooks.ts:274-292` `loopAsQuery` adapter — **KEEP** — the History/Landing pages still drive off this. Folding the pages onto a loops-shape is a bigger UX migration — out of scope here.
- `research-hooks.ts:26-35` `QueryStats` — **KEEP** but **REWORD comment** — every field of QueryStats is null in `loopAsQuery`; the type is only retained so `ResearchQuery.stats` typechecks. Worth documenting that no loop ever populates it.

#### F — Field-level zeroes (loop adapter)

- `research-hooks.ts:281` `prompt_hints: {} as PromptHints` — **DELETE** the cast comment / leave the empty object literal as-is for type compatibility. Track as part of the `PromptHints` rewording rather than a separate item.
- `research-hooks.ts:282-283` `question_shape: null, topic_cluster: null` — **KEEP** — explicit nulls so the UI columns render dashes. Fine.

#### D — Dead config fields

Covered under T (the `SessionConfig` subfield audit above):
- `perturbation_coherence_floor` — **DELETE**
- `perturbation: PerturbationConfig` — **DELETE**
- The matching field-shape mirror in `research-hooks.ts:201-207` (`ResearchDefaults.perturbation: { ... }`) — **DELETE**.
- The matching field-shape mirror in `research-hooks.ts:188` (`max_perturbation_probability`) — **DELETE** if no schema entry. Schema has it at advanced (line 60). **KEEP** for now — it could still drive perturbation rate-limit telemetry in v1.1.

#### U — UI rendering of v0 concepts

- `research-hooks.ts` 1-30 — comment header references "PromptHints, ShapeAnalysis, QueryStats" — **REWORD** to drop the implication these are still computed.
- `research-hooks.ts:37-86` `PromptShape | PromptDepth | PromptAudience | PromptUrgency | PromptHints | QuestionShape | ShapeLens | ShapeAnalysis | TopicClusterAnalysis | TopicCluster | TOPIC_CLUSTERS` — **KEEP** — consumed by `HistoryFilterRail` and the `ResearchHistoryPage` / `ResearchLandingPage` rendering. They render dashes for all of these, which is the only honest thing they can do until the pages are folded onto loops-shape.
- `ResearchHistoryPage.tsx:259-345` Shape / Verdict / Findings / Cost / Duration / Activity columns — **KEEP** — they all render em-dashes against loops data (intentional graceful degradation). Re-evaluating these is a separate UX migration.
- `ResearchHistoryPage.tsx:359-402` `GroupedTable` (group-by-shape) — **KEEP** — same.
- `ResearchHistoryPage.tsx:520-540` `deriveVerdict` / `computeDurationMs` / `costBandFor` — **KEEP** — same.
- `ResearchLandingPage.tsx:309-365` `JobRow` — **KEEP** — renders shape/topic/findings/cost as null-safe.
- `HistoryFilterRail.tsx` — **KEEP** — shape/topic/verdict facets all show "0" against loops data, which is consistent with the page's current state.
- `HistorySummaryStrip.tsx` — **KEEP** — pass/flag/halt always zero; findings always zero. Same as above.

#### Monitor hooks orphan

- `src/ui/web/src/api/monitor-hooks.ts` (entire file, 109 lines, hits `/research/monitors`) — **DELETE** — no UI page imports it; the `/research/monitors` route was deleted in Phase 7. Pure orphan.

#### C — Dead comments

- `defaults.ts:11` `perturbation: { ...DEFAULT_SESSION_CONFIG.perturbation, ... }` — **DELETE** with the `perturbation` field.
- `defaults.ts:13` `topic_coherence: { ... }` — **KEEP** (live config) — already documented.
- `index.ts:5-12` docstring — **REWORD** — drop the "v0 engine is gone" framing once router.ts is deleted; tighten to describe the surface.
- `types.ts:8-14` JSDoc for `question_shape` — **DELETE** with the field.
- `types.ts:16-19` JSDoc for `topic_cluster` — **DELETE** with the field.
- `loop/types.ts:152-163` references to `(question_shape × topic_cluster) → RunPlan` — **REWORD** — describe what the planner replaced, not what it used to be.
- `loop/types.ts:170-175` `"USD envelope stays on SessionConfig until Phase 5 ..."` — **KEEP** — accurate description of the Phase 5 plan.
- `loop/types.ts:178-180` "Phase 4 emits this; engine consumes at Phase 5" w/ `perturbation_weights` — **KEEP** — accurate; `loop/types.ts` is on the keep list.
- `loop/planner.ts:5` `"... (question_shape × topic_cluster) → RunPlan lookup with an LLM call ..."` — **KEEP** — describes the rewrite (correct, useful context).
- `routes/research.ts:14-16` "queries / threads / findings / jobs / concepts / sources / workers / monitors / metrics / hooks / agent endpoints" — **KEEP** — accurate dead-pointer list; useful for whoever next reads the route file.

#### P — Provider router

- `src/research/src/providers/router.ts` (entire file, 64 lines, imports from non-existent `../engine.js`) — **DELETE** — no caller; `loop/run.ts` uses `OpenRouterProvider` directly. The file literally won't compile if you typecheck strictly since `engine.js` was deleted Phase 7.
- `index.ts:22-23` `export { ModelRouter } from './providers/router.js'` and the `TaskType | ModelConfig | ProviderConfig` re-exports — **DELETE** with router.ts.

#### L — DDL cleanup

- `ddl.ts:101-124` `dropLegacyTables()` — **KEEP** — idempotent, fires on every boot, safety net for dev DBs that still carry v0 schema. A no-op on fresh installs; tiny boot-time cost; cheap insurance. Reconsider in a later cycle once we trust every running install has run it once.

#### Dead helpers

- `src/research/src/perturbation.ts` (entire file, 267 lines) — **DELETE** — no caller in `loop/` or anywhere else. Engine + worker pool both gone.
- `src/research/src/similarity.ts` (entire file, 163 lines) — **DELETE** — no caller. The loop engine doesn't use jaccard or cosine similarity anywhere.
- `services/events.ts:17-21` v0 event types in the `ResearchEventType` union (`'thread' | 'job' | 'step' | 'finding' | 'source' | 'concept' | 'concept_link' | 'query'`) — **DELETE** — no `emitResearchEvent` call uses them; only loop event types are emitted (`'loop'`, `'cycle'`, `'cycle_step'`, `'milestone'`, `'artifact'`, `'decision'`).

---

## 3. V8 dogfood grading

**Status:** ✅ done (2026-05-12). Loop `late-sky-peak-5c06` was still in the dev DB — no fresh run needed.

### Verdict: Misleading — confirms the stop-rule planning gap

The planner emitted a 6-branch plan to cover the question correctly. The engine clipped to 3 cycles and only ran the first three branches. The polished document is technically accurate on the topics it covers but **misleading by omission** on the prompt as asked.

**Plan vs. execution**

| # | Branch id | Query | Ran? |
|---|---|---|---|
| 0 | `v8-architecture` | V8 JavaScript engine architecture and design | ✅ |
| 1 | `jit-compilation` | V8 JavaScript engine Just-In-Time (JIT) compilation techniques | ✅ |
| 2 | `optimization-strategies` | V8 JavaScript engine optimization strategies | ✅ |
| 3 | `predecessor-comparison` | JavaScript engines existing before V8: performance and features | ❌ |
| 4 | `memory-management` | V8 JavaScript engine memory management and garbage collection | ❌ |
| 5 | `ecmascript-compliance` | V8 JavaScript engine ECMAScript compliance | ❌ |

The planner specifically planned `predecessor-comparison` — exactly the framing of the user's question ("innovations *over earlier JS engines*"). The stop rule clipped it.

**Document content coverage (3 cycles of synthesis)**

| Topic | Covered | Notes |
|---|---|---|
| JIT compilation | ✅ | Strong section |
| Hidden classes / shapes | ✅ | Doesn't credit Self (1991) as the conceptual ancestor |
| Inline caching | ✅ | Doesn't credit Self either |
| TurboFan | ✅ | Brief, ports-focused |
| Type specialization | ✅ | Light |
| Garbage collection | ⚠️ | Calls it "stop-the-world" — accurate for old V8, misleading for modern V8 which is heavily concurrent / incremental (Orinoco) |
| Crankshaft (TurboFan predecessor) | ❌ | Missing — historical context |
| Ignition (baseline interpreter, 2016) | ❌ | Missing — multi-tier architecture foundation |
| Sparkplug (baseline JIT, 2021) | ❌ | Missing |
| Maglev (mid-tier JIT, 2023) | ❌ | Missing |
| Orinoco / concurrent GC | ❌ | Missing |
| Pointer compression | ❌ | Missing |
| Snapshot startup | ❌ | Missing |
| WebAssembly (Liftoff, TurboFan-wasm) | ❌ | One-line mention in Overview |

Coverage of canonical V8 innovations: roughly **5/14 major items** — and zero from 2016 onward. The doc reads as a circa-2014 V8 retrospective, which is the natural consequence of only running 3 of the 6 planned branches (and not the historical-comparison or memory-management ones).

**Cost**: $0.0000 reported in `envelope_consumed` — but the loop predates this session's cost-sum fix, so cost was never recorded. The real LLM spend for this loop was probably ~$0.006 in retrospect.

**Activity tab visual record** — `/tmp/v8-activity.png` (also embedded inline in the session transcript): KPIs / Cycle Lifecycle / Source Extraction (0% failure since pre-extraction_status sources have no status field) / Branch State (6 branches: 3 finalized, 3 pending — visually shows the bug) / Event Log render. Post-Mortem / Iteration Checks / Decisions panels correctly do NOT mount because this loop predates the backend instrumentation.

**Implication for item 5 (Stop-rule gap)** — confirmed reproducer. The stop rule needs to terminate on `completed >= branches.length` (or `branches.length * per_branch_budget` if the planner intends each branch to run multiple cycles), not on a static `cycles_target`. Item 5 should be prioritized — without it, the planner's branching logic is structurally undercut.

**Next action**: re-run this exact prompt once item 5 lands. Compare resulting document for `predecessor-comparison` and `memory-management` coverage. That will be the right "is V8 innovation grading fixed?" gate.

---

## 4. Persist decision_log in prod derivation

**Status:** ✅ done — landed on main 2026-05-12 (commit `74c4a05`).

### What shipped
Added `sqlite?: Sqlite` to `TemplateDeps`; forwarded via `buildTemplate` to `makeResearchTemplate`; attached the handle in `run.ts:main` right after `buildDeps` returns. Locked the prod path with a new `decisions.test.ts` test that exercises `buildTemplate` (not `makeResearchTemplate` directly).

### Verification (end-to-end on dev server)
Loop `quiet-tide-bay-533f` ran with the new code. The persisted `decision_log` artifact contains **14 followup_pick entries** (previously: 0 in prod). Total entries: 6 canon + 7 branches + 14 follow-ups = 27 — the Activity tab's Decisions panel renders all 27 rows.

Agent A caveat from the Decisions/Source-Extraction work: `run.ts:buildDeps` builds `{ llm }` only for the research template. The derivation hook's `followup_pick` decisions emit as `decision` events (UI sees them live) but don't append to the `decision_log` artifact in prod because `deps.sqlite` is undefined there. Planner-side decisions DO persist because `ensureScheduleArtifact` had sqlite already.

**Touch files**

- `src/research/src/loop/templates/registry.ts` — `TemplateDeps` interface
- `src/research/src/loop/run.ts` — `buildDeps`
- `src/research/src/loop/templates/research.ts` — `ResearchTemplateDeps` (already optional sqlite for tests; just thread it through in prod)

**Acceptance**

- After completion of a prod loop, the `decision_log` artifact contains followup_pick entries.
- `decisions.test.ts` continues to pass.

---

## 5. Stop-rule planning gap

**Status:** ✅ done — landed on main 2026-05-12 (commit `6c8b24d`).

### What shipped
`stop_rule` now computes `effectiveTarget = max(cycles_target, branchCount)` from the schedule artifact, with a corresponding `effectiveMaxCycles = max(maxCycles, effectiveTarget * 2)` for the shape-unreachable escape hatch. Defensive option-chaining for shape-only schedule fixtures. Reason string reports the effective target so a 6-branch run logs `research_target_reached:6`.

### Test (regression-pinned)
New test in `research.test.ts`: a 6-branch plan with `cycles_target=3` now runs all 6 branches and reports `research_target_reached:6`.

### Verification (V8 regrade on dev server)
Fresh loop `quiet-tide-bay-533f` ran with the new code. Planner emitted **7 branches**; engine ran **all 7 cycles** (vs. the original `late-sky-peak-5c06` which clipped to 3). Cost: $0.0029.

**Coverage delta — original (3 cycles) vs. regrade (7 cycles)**

| Topic | Original | Regrade |
|---|---|---|
| JIT compilation | ✅ | ✅ |
| Hidden classes | ✅ | ✅ (better) |
| Inline caching | ✅ | ✅ (better) |
| TurboFan | ✅ | ✅ |
| Crankshaft (predecessor) | ❌ | ❌ (still missing) |
| **Ignition** (baseline interpreter) | ❌ | ✅ |
| **Sparkplug** (baseline JIT, 2021) | ❌ | ✅ |
| **Maglev** (mid-tier JIT, 2023) | ❌ | ✅ |
| **Multi-tier pipeline** explicitly named | ❌ | ✅ |
| GC framing | ⚠️ "stop-the-world" (misleading) | ✅ Incremental + young/old heap |
| **Predecessor comparison** (SpiderMonkey, JavaScriptCore) | ❌ | ✅ |
| Smi pointer tagging | ❌ | ✅ |
| Pointer compression | ❌ | ❌ |
| Snapshot startup | ❌ | ❌ |
| WebAssembly (Liftoff) | ❌ (1 line) | ❌ (1 line) |

Coverage: **9/14 → up from 5/14**. The three branches that previously never ran (`early-js-engines`, `v8-garbage-collection`, `js-engines-comparison`) directly produced the new content. Verdict shifts from **misleading by omission** to **substantially accurate**, addressing the literal question.

Activity tab screenshot at `/tmp/v8-regrade-activity.png` — Branch State now shows 7 branches all finalized (vs. original's 3 finalized + 3 pending).

In an earlier dogfood, the planner planned 4 branches but the engine stopped at 3 cycles with `reason=research_target_reached:3`, never executing the `lifetime-annotations` branch. The polished document was rated "Misleading" as a result. This is a planner/stop-rule design bug.

**Likely culprits**

- `src/research/src/loop/templates/research.ts` `stop_rule` — currently `completed >= cycles_target`. Should be `completed >= per_branch_budget * branches.length` (or whichever invariant the planner intended).
- `src/research/src/loop/planner.ts` — `per_branch_budget` may not be wired into the engine's effective cycle budget.

**Acceptance**

- A loop with a 4-branch plan runs at least 4 cycles (one per branch) before stop_rule triggers.
- Test added covering the multi-branch case.
- V8 grading (item 3) re-run after this fix to confirm coverage improves.

---

## Out-of-scope / parked

- Tabs other than the per-loop detail (Landing, History, Workers) — those got mockup work earlier in the project; verify but don't touch unless drift is visible.
- Document polish prompt tuning (encyclopedia-editor) — out of scope for engine instrumentation.
- Adaptive milestone re-plan (Phase 5 of the build plan) — not part of this thread.
