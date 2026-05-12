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

**Status:** ⏳ in progress (Agent B in worktree).

The prior session's Explore subagent cataloged 80+ legacy v0 concepts surviving in v1 code. They're grouped by category but the SARIF/JSON findings were not persisted, so the sweep needs to re-discover them first, then delete each unused trace per CLAUDE.md commandment 7 ("when removing something, remove it completely").

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

**Status:** 🟡 deferred.

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

**Status:** 🟡 deferred (explicitly out of scope this session).

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
