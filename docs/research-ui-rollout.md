# Research UI Redesign — Omnibus Rollout Plan

**Status:** locked design, ready to implement
**Date:** 2026-05-02
**Mockups (truth):**
- `docs/mockups/research-landing-history-redesign.html` — Landing + History
- `docs/mockups/research-inspect-merge.html` — Activity tab (events+telemetry+reviews) — **Variant A only, refinements applied** ✓
- `docs/mockups/research-knowledge-process-merge.html` — Graph tab (knowledge+process) — **Variant E only, ultrawide-tuned** ✓

This document is the single source of truth for the implementation. It consolidates four mockup-driven redesigns into a parallelizable rollout, names the skills each stream uses, and captures non-negotiable preservation rules from prior conversation.

---

## 1. Locked decisions

| Surface | Mockup file | Variant | Notes |
|---|---|---|---|
| Research landing page | `research-landing-history-redesign.html` | hero compose | inferred panel under textarea (shape · lenses · topic · run plan) |
| History page (`/research/queries` → `/research/history`) | `research-landing-history-redesign.html` | rich archive | summary strip + filter rail + ledger w/ Shape column |
| Session detail · merged "Activity" tab | `research-inspect-merge.html` | **A** (one-scroll dashboard) | drop cost-trajectory chart; compact lifecycle + thread state; **preserve every event-view detail** |
| Session detail · merged "Graph" tab | `research-knowledge-process-merge.html` | **E** (three-pane: tree · canvas · inspector) | optimize for ultrawide; default state must be useful without manual resize |

---

## 2. Pre-work (Phase 0 — small, must finish before main streams)

| Task | Output |
|---|---|
| **0.1** Trim `research-inspect-merge.html` to Variant A only | drop variants B and C |
| **0.2** Drop cost-trajectory svg from Variant A; keep cost stats inline | smaller panel |
| **0.3** Compact Job Lifecycle: 4-row table (queue wait / supervisor lag / run duration / end-to-end) × 4 cols (p50 · p95 · max · avg) replaces 4 stacked pillar cards that repeat the labels | one panel, denser |
| **0.4** Compact Thread State: replace 6-tile grid with one stackbar + one-line counts; keep stuck-threads list (the actionable bit) at full size | one panel, denser |
| **0.5** Embed event-fidelity preservation note inside Variant A's "What this trades" block | implementer cannot miss it |
| **0.6** Trim `research-knowledge-process-merge.html` to Variant E only | drop variants D and F |
| **0.7** Re-layout Variant E for ultrawide (≥ 2560px), tree pane ~320px, inspector ~360px, center pane absorbs the rest. Default state shows tree expanded one level + center graph pre-rendered with focus on seed thread | useful at first paint |
| **0.8** Decide topic-cluster data source — see § 7 | **decided: Option 1 (LLM call at session creation)** ✓ |

Phase 0 is one PR (`docs/phase-0-trim`). Tasks 0.1–0.7 + 0.8 all complete; Stream 1A is unblocked.

---

## 3. Stream graph

```
Phase 0 ─┬─ 0.1–0.7  mockup trim                                           PR-0a
         └─ 0.8      topic-cluster data-source decision                    (no PR)

Phase 1 ─┬─ 1A  topic classifier (backend)         depends on 0.8         PR-1a
         ├─ 1B  run-plan suggester (backend)       independent             PR-1b
         └─ 1C  stats: passRate / flag / halt      independent             PR-1c

Phase 2 ─┬─ 2A  Landing page                       depends on 1A·1B·1C    PR-2a
         ├─ 2B  History page (rename + redesign)   depends on 1A·1C       PR-2b
         ├─ 2C  Activity tab (merge events+telem+reviews)  independent     PR-2c
         └─ 2D  Graph tab (merge knowledge+process)        AFTER 2C        PR-2d
                                                          (same big file)

Phase 3 ─── cleanup + docs + spec drift            after every Phase 2 PR  PR-3
```

**Parallel units:** Phase 1 (1A·1B·1C all at once), Phase 2 first wave (2A·2B·2C all at once). 2D is sequential after 2C because both rewrite chunks of `ResearchQueryDetailPage.tsx`.

---

## 4. Per-stream specs

Each stream lives in its own worktree (`/git-workflow` discipline). Use a unique short name for the worktree directory.

### Stream 1A — Topic classifier
- **Worktree:** `.worktrees/research-topic-classifier`
- **Branch:** `feat/research-topic-classifier`
- **Files:** `src/research/src/services/queries.ts`, `src/research/src/ddl.ts`, `src/research/src/types.ts`
- **What:** at session creation, alongside the existing shape detector, run a one-shot LLM call that classifies the seed prompt into one of N topic clusters. Persist on the query row. Schema only first, then writer, then API exposure.
- **Tests:** `src/research/src/research.test.ts` — fixture prompts → expected cluster.
- **Verification (`/verify-completion`):** `bun test.ts` passes; `curl localhost:3001/api/research/queries/<id>` returns the new field.

### Stream 1B — Run-plan suggester
- **Worktree:** `.worktrees/research-runplan-suggester`
- **Branch:** `feat/research-runplan-suggester`
- **Files:** `src/research/src/services/queries.ts` (or new `services/run-plan.ts`)
- **What:** lookup table keyed by `(question_shape × topic_cluster)` returning suggested `model_fast / budget_total_usd / max_thread_depth / role_label`. No LLM call needed for v1 — just a typed table + override resolver. Exposed in the create-query response.
- **Tests:** unit tests for the resolver (every shape × every cluster covered or has a sane default).
- **Verification:** `bun test.ts` passes; lookup is exhaustive.

### Stream 1C — Stats endpoint extension
- **Worktree:** `.worktrees/research-stats-verdict`
- **Branch:** `feat/research-stats-verdict`
- **Files:** `src/research/src/services/stats.ts`, `src/research/src/types.ts`, `src/ui/api/src/routes/research.ts`, `src/ui/web/src/api/research-hooks.ts`
- **What:** add `passRate`, `flagRate`, `haltRate`, and `byVerdict[date]` to `useResearchStats`. Roll up `latest_post_mortem.verdict` per session, scoped to the existing range filter.
- **Tests:** stats fixture with mixed verdicts → expected aggregation.
- **Verification:** `bun test.ts` passes; new fields visible in `/api/research/stats?range=30d`.

### Stream 2A — Landing page
- **Worktree:** `.worktrees/research-landing`
- **Branch:** `feat/research-landing`
- **Depends on:** 1A, 1B, 1C
- **Files:**
  - new `src/ui/web/src/pages/research/ResearchLandingPage.tsx` (replaces `ResearchDashboardPage.tsx`)
  - new `src/ui/web/src/components/research/ComposeBox.tsx`
  - new `src/ui/web/src/components/research/InferredPanel.tsx` (Shape · Lenses · Topic · Run plan rows; reuses chip styling from `QuestionShapeBar.tsx`)
  - update `src/ui/web/src/App.tsx` route
  - update sidebar nav label to "Research"
- **Skills:**
  - `/frontend-design` during component scaffolding
  - `/design-type` auto-applies during JSX gen (en/em dashes, curly quotes, no double-spaces)
  - `/design-audit` before merge — 15-dimension check on the full page
- **Tests:** unit tests for `ComposeBox` (submit disabled when empty, ⌘↵ shortcut, template click populates textarea); UI smoke for `/research`.
- **Verification:** `bun test.ts` + `bun run build` + `bun run ui:smoke` (per CLAUDE.md UI gate).
- **Cleanup:** delete `ResearchDashboardPage.tsx`.

### Stream 2B — History page
- **Worktree:** `.worktrees/research-history`
- **Branch:** `feat/research-history`
- **Depends on:** 1A, 1C
- **Files:**
  - rename `ResearchQueriesPage.tsx` → `ResearchHistoryPage.tsx`
  - update `App.tsx` route `/research/queries` → `/research/history`
  - find/replace every internal link (sidebar, dashboard "view all", session detail back-link)
  - new `src/ui/web/src/components/research/HistoryFilterRail.tsx`
  - new `src/ui/web/src/components/research/HistorySummaryStrip.tsx`
  - extend the ledger row to render Shape chip + sparkline
- **Sortable columns:** started, cost, findings, duration, verdict — extend existing sort state.
- **Group by shape:** client-side grouping toggle.
- **Defer:** "Compare 2" affordance — separate PR (PR-2b-compare).
- **Skills:** `/frontend-design`, `/design-type`, `/design-audit`.
- **Tests:** filter logic unit tests (status × shape × topic × cost-band); snapshot of summary strip; UI smoke for `/research/history`.
- **Verification:** as 2A. Plus: `curl /research/queries` returns 301 → `/research/history` (or remove the old route entirely; pick one).
- **Cleanup:** delete the old `ResearchQueriesPage.tsx`.

### Stream 2C — Activity tab merge
- **Worktree:** `.worktrees/research-activity-tab`
- **Branch:** `feat/research-activity-tab`
- **Files:**
  - `src/ui/web/src/pages/research/ResearchQueryDetailPage.tsx` — change `Tab` union: drop `events | telemetry | reviews`, add `activity`
  - `src/ui/web/src/pages/research/ResearchTelemetryView.tsx` — break into smaller panel components for re-use in the Activity dashboard
  - `src/ui/web/src/pages/research/ResearchReviewsView.tsx` — same
  - inline `EventsView` (currently in the big page file) — extract to `EventsList.tsx`
  - new `src/ui/web/src/pages/research/ResearchActivityView.tsx` — composes verdict + KPI strip + telemetry panels (left) + sticky event-log column (right)
- **Refinements (per § 1):**
  - Drop the cost-trajectory svg; keep `total_cost / total_tokens / by_model` numbers in a small "Cost" panel.
  - Job Lifecycle as one 4×4 table.
  - Thread State as stackbar + one-line counts; keep stuck list.
- **🔒 EVENT-FIDELITY GATE — non-negotiable:**
  - **No event type may be dropped.** The `Tab=events` view today renders: `finding`, `thread`, `step`, `search`, `fetch`, `error`. The new event-log column must render every one.
  - **No event detail may be dropped.** The current row formatter (`formatEventDetail`, the `expandedEventKey` expansion, thread-diff chips for status / priority / backoff / retry transitions) all preserve specific information. Carry every field forward.
  - **No event source may be dropped.** Today's view merges live SSE with DB-backed steps + findings (for rows that aged out of the 1000-event SSE cache). The merged view must keep that merge logic.
  - **Filter parity:** filterType (all · finding · thread · step · search · fetch · error), thread filter, search text, expanded-row inspection — all carry forward.
  - **Verification gate:** before merging Stream 2C, diff the rendered event log against a captured fixture from main. Use `bun run ui:smoke` to load a session with ≥ 50 mixed events and assert each event-type label appears at least once.
- **Skills:** `/frontend-design`, `/design-type`, `/design-audit`, **`/verify-completion`** (mandatory due to fidelity gate).
- **Tests:** event-rendering unit tests (one per event type); UI smoke loads a real fixture session and asserts row counts.
- **Cleanup (after merge):** delete the standalone `EventsView`, `TelemetryView`, `ReviewsView` mounts in the tab switch; keep their underlying components if extracted.

### Stream 2D — Graph tab merge (sequential after 2C)
- **Worktree:** `.worktrees/research-graph-tab`
- **Branch:** `feat/research-graph-tab`
- **Files:** `ResearchQueryDetailPage.tsx` — drop `knowledge | process` from the `Tab` union, add `graph`. Extract the existing `LiveView` / `MapView` / `KnowledgeView` into a single `ResearchGraphView.tsx` with the three-pane layout.
- **Default-state requirements:**
  - **Tree (left):** auto-expand to depth 1 from every seed thread; do not require user click to see anything.
  - **Center canvas:** pre-select the lens that has data (`Concepts · graph` if there are concepts, otherwise `Threads · map`); pre-focus the seed thread.
  - **Inspector (right):** if nothing is selected, show seed thread's findings (still useful empty-state).
  - On viewports < 1600px the inspector collapses to a drawer; everywhere ≥ 1600px all three panes are visible.
- **Skills:** `/frontend-design`, `/design-type`, `/design-audit`, `/verify-completion`.
- **Tests:** unit tests for the synced selection (clicking thread → highlights its concepts); UI smoke confirms first paint shows tree-expanded + canvas-rendered without user action.
- **Cleanup:** remove obsolete tab branches in `ResearchQueryDetailPage.tsx`; remove `LiveView` / `MapView` / `KnowledgeView` if their content moved fully.

### Stream 3 — Cleanup + docs
- **Worktree:** `.worktrees/research-redesign-cleanup`
- **Branch:** `chore/research-redesign-cleanup`
- **Tasks:**
  - Remove dead code identified post-2A/2B/2C/2D
  - Update `docs/spec/RESEARCH.md` to reflect the new tab list and the renamed history route
  - Update `README.md` if any nav surface was documented
  - `/code-simplify` pass over the diff
  - `/docs-review` against the spec
- **Verification:** `bun test.ts` + `bun run build` + `bun run ui:smoke` clean run.

---

## 5. Skill discipline (per stream)

For every stream's PR:

| Step | Skill | When |
|---|---|---|
| Spawn worktree, branch | `/git-workflow` | start |
| New components / pages | `/frontend-design` | during scaffold |
| Any visible text in JSX | `/design-type` | enforced silently while writing |
| Whole-page review before merge | `/design-audit` | pre-PR |
| Evidence the change works | `/verify-completion` | before claiming done |
| Land + push | `/git-workflow` | end |

Streams 2C and 2D additionally require the **event-fidelity gate** (§ 4 Stream 2C) and the **default-state gate** (§ 4 Stream 2D). Both are mandatory `/verify-completion` checkpoints — no merge without evidence.

---

## 6. Acceptance criteria (whole rollout)

- [ ] `/research` renders the new landing page; the old dashboard page is deleted.
- [ ] `/research/history` is the canonical archive route; `/research/queries` no longer exists or 301s.
- [ ] `Tab` union in `ResearchQueryDetailPage.tsx` is `'document' | 'graph' | 'sources' | 'activity' | 'config'` (8 → 5).
- [ ] Compose box's inferred panel shows live shape detection within ≤ 2s of typing, with editable Shape · Lenses · Topic · Run plan rows.
- [ ] Activity tab passes the event-fidelity gate against a 50-event fixture.
- [ ] Graph tab is useful at first paint on a 2560px viewport with no clicks or resizes.
- [ ] `bun test.ts` 100% pass, `bun run build` clean, `bun run ui:smoke` clean across all five new/changed routes.
- [ ] `docs/spec/RESEARCH.md` reflects the new tabs and routes.
- [ ] No orphaned components remain (`ResearchDashboardPage`, `ResearchQueriesPage`, the old per-tab views).

---

## 7. Topic-cluster data source — DECIDED

**Decision (2026-05-02):** Option 1 — LLM call at session creation.

- Mirrors the existing question-shape detector exactly (one extra fire-and-forget call, persisted to a new column on the query row).
- Output enum starts at: `AI / LLM tooling`, `Music history`, `Databases`, `Audio & DSP`, `Personal infra`, `Misc`. Add buckets in config as the corpus grows; no retraining needed.
- Stream 1A is now unblocked.

(Options 2 and 3 — K-means over embeddings, user-tagged — rejected. Option 2 needed a training pass and centroid rebalancing for too little gain in a single-user system; option 3 lost the "system tells you about you" UX that motivates the topic row in the first place.)

---

## 8. Risks & rollback

- **Big-file conflicts on the detail page** — 2C and 2D both rewrite chunks of `ResearchQueryDetailPage.tsx` (3,638 lines). Mitigation: 2D starts only after 2C lands, and 2C extracts the views into separate files first so 2D operates on smaller surface.
- **Event regression** — covered by § 4 Stream 2C gate. Rollback path: revert PR-2c; old tabs return verbatim.
- **Topic classifier flakiness** — Stream 1A may produce inconsistent clusters early on. Mitigation: cluster enum starts with 6 buckets including `Misc`; classifier prompt includes the enum and a few-shot example per cluster. Rollback: hide the topic row in `InferredPanel` behind a feature flag if confidence stays low.
- **History route rename breaks bookmarks** — keep a 301 redirect from `/research/queries` for at least one release.

---

## 9. PR cadence — recommended order

1. **PR-0a** Phase 0 mockup trims (1 hour)
2. **PR-1a / PR-1b / PR-1c** Phase 1 backends in parallel (≤ 2 days each, can ship independently)
3. **PR-2a / PR-2b / PR-2c** Phase 2 first wave in parallel (≤ 3 days each)
4. **PR-2d** Graph tab — sequential after 2C (≤ 3 days)
5. **PR-3** Cleanup + docs (≤ 1 day)

Total wall-clock: ~7–10 working days with one engineer running parallel worktrees, ~3–4 days with multiple agents in isolated worktrees.
