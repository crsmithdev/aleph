# Post Activity-Rebuild Follow-ups

Living doc for the work that remains after `feat/activity-tab-rebuild` landed on `main` (commits `ee64f8c` → `04925b5`, 2026-05-12).

The Activity tab is mockup-parity — KPI strip, Cycle Lifecycle, Post-Mortem, Iteration Checks, Source Extraction, Branch State, Decisions, and the filterable Event Log all render against real loop data. Cost flows correctly into `envelope_consumed.cost_usd`. The remaining work is broken into five threads below.

Track status here as items land. Each item lists the trigger files / mockups / acceptance gate so a fresh context can pick up without rediscovering the surface.

---

## 1. Document / Plan / Config tabs — mockup parity

**Status:** ⏳ in progress (Agent A in worktree).

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

**Status:** ⏳ in progress (orchestrator, foreground).

The original `late-sky-peak-5c06` loop was wiped from the DB during this session. A fresh run is needed.

**Procedure**

1. Confirm dev server on port 3001 is on the post-merge main code; hard-restart if `bun --watch` didn't re-pick up cross-package changes.
2. `POST /api/loops/start` with `template_id: 'research'`, prompt: "What innovations did the V8 JavaScript engine introduce over earlier JS engines?", default models (gemini-2.0-flash-001, ~$0.006/loop).
3. Wait for status=completed; let the post_mortem hook fire.
4. Grade the polished `kind: 'document'` artifact against the literal question. Capture: does it cover JIT (Crankshaft/TurboFan), hidden classes, inline caching, ignition interpreter, sparkplug baseline JIT, type feedback, GC innovations? Where does it land on the original "Misleading" rating?
5. Capture screenshots of the Activity tab on the completed run so we have a real-data record of all eight panels.

**Acceptance**

- Grade recorded here (factual coverage / hallucination check / verdict).
- Activity tab screenshots saved at `/tmp/v8-dogfood-activity-{1..N}.png`.

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
