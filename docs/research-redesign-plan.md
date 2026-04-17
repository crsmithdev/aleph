# Research Module Redesign — Plan

**Status:** approved direction, ready to implement
**Date:** 2026-04-17
**Branch:** `fix/datatable-fill-columns` (mockups committed there; implementation should move to a new branch)
**Mockups:** served at `http://localhost:8090/research/` and `http://localhost:8090/research-config/`

This plan is self-contained. It captures the full design conversation, the chosen direction, and the implementation steps so work can resume in a fresh context.

---

## 1. Architectural reframe (agreed)

### Problem

- Documents produced by research sessions are ~75% bibliography, ~25% content. The LLM synthesizes from *finding summaries* (already shallow) — it can't produce depth it doesn't have.
- The "map" view is a tree of questions → follow-up questions via `parent_thread_id`. Not novel, becomes unusable as sessions grow.
- URLs aren't deduplicated at aggregation. Every finding contributes citations, piling up.
- The 8192-token output cap on the doc generation pass (`engine.ts:1615`) further strangles expression.

### Direction

Introduce **Concept** as a first-class entity. Concepts are the *knowledge* layer (durable, cross-query). Threads remain the *process* layer (per-query trajectory). A Finding belongs to a thread (how we got here) and links to N concepts (what it's about).

```
Concept { id, canonical_name, aliases[], summary, key_facts[], embedding }
ConceptLink { from_concept_id, to_concept_id, relation, evidence_finding_ids[] }
Finding <-> Concept  (many-to-many)
```

Research loop change: extract concepts from a query → load existing knowledge for those concepts → search to fill gaps → attach new facts to concepts (not just threads). Document generator walks relevant concepts and emits one section per concept. Map view renders the concept subgraph (force-directed). Process-tree view is kept for debugging search paths.

### Full-text extraction — optional, deferred, queueable

A **`Source`** entity:

```
Source {
  id, url, title, snippet,
  extraction_status: 'pending'|'extracted'|'failed'|'skipped',
  extracted_text, extracted_at, fetched_at
}
```

A background worker drains an extraction queue. Extraction is a depth multiplier, not a prerequisite — the system works without it and gets richer as extractions land. Users can trigger extraction per-source, per-concept, or per-session.

### Token / truncation limits (three to lift out of hardcode)

| Current | Location | Meaning |
|---|---|---|
| `8192` | `engine.ts:1615` | LLM max output tokens, per call |
| `3000` | `providers/openrouter.ts:58` | Chars of each source passed to synthesis |
| `200`  | `providers/openrouter.ts:76` | Chars of each source stored for citation UI |

All three become fields on `SessionConfig`.

---

## 2. UI — selected designs

### Config page — **Variant A chosen**

Grouped cards, single page, all visible. Six cards: Budget / Depth & Breadth / Quality / Generation / Extraction / Models. "Show advanced" toggle for rarely-touched knobs (perturbation, coherence, schedule, serendipity). Mockup: `mockups/research-config/index.html` (Variant A block).

### Other pages — all approved

- `mockups/research/queries.html` — queries list
- `mockups/research/query-detail.html` — session detail with five tabs: Document, Knowledge, Process, Sources, Events, Config
- `mockups/research/events.html` — global live activity feed

### Hard constraint

**No font size below 14px anywhere in the final implementation.** The mockups currently violate this throughout — the type scale must be rebuilt around a 14px floor before these ship.

---

## 3. Design audit (phased plan)

Format per `src/skills/design-audit/audit-template.md`.

```
DESIGN AUDIT RESULTS

Overall Assessment: The mockups express the right information architecture and
hierarchy, but the type scale is built on a 13px body with heavy 10-12px usage
for metadata. Accessibility, readability, and the 14px floor demand a full
type-scale rebuild. Once the scale is corrected and tokens consolidated, the
design holds up.

---

PHASE 1 — Critical

- Global type scale: base font is 13px with 10-12px metadata everywhere ->
  rebuild scale on a 14px floor (see tokens below) ->
  Readability at normal viewing distance, user's explicit constraint.

- Font-size inline styles scattered across .html files ->
  move every font-size to a utility class (`.t-meta`, `.t-body`, `.t-h3`) in
  common.css; zero `font-size:` in page-level <style> blocks or inline ->
  One source of truth prevents future drift, makes the 14px floor enforceable
  by lint.

- Config page (Variant A) uses `font-size:11px` on card subs, hints, edited
  dot chips, and status pills, plus 10px on badges ->
  Minimum 14px for all copy; status pills use uppercase 12px -> WAIT, also
  lifted to 14px (uppercase + tracking conveys hierarchy without shrinking) ->
  Enforces constraint; pills with text under 14px are unreadable at arm's
  length on a dense settings page.

- Query detail → Document tab: `article.doc` is 14px already, but inline
  citation `sup` is 10px and bibliography meta is 11-12px ->
  Citations 12px is below floor — raise sups to 14px baseline-shifted, raise
  bib source/meta to 14px ->
  The bibliography is half the point of the rail; illegible meta breaks it.

- Query detail → Events tab, Events page: `.event` rows are 12px with 11px
  kind pills ->
  Rows to 14px, kind pills to 14px (keep uppercase + letter-spacing for
  hierarchy) ->
  Activity feed is meant to be scannable; 12px cadence makes it tiring.

- Sidebar section labels (`.sidebar-section`) are 10px uppercase ->
  14px uppercase with reduced opacity, or drop uppercase entirely ->
  10px is unreadable; the existing visual distinction is letter-spacing +
  color, both of which survive at 14px.

- Queries list: `.metric .l` label is 10px, `.title-cell .sub` 11px, filter
  chips 11px, status pill text 11px ->
  All 14px ->
  These are the primary scanning surfaces for the list.

- Inconsistent color token: `--border` vs `--border-primary` — `themes.ts`
  defines `--border`, ResearchConfigPage.tsx uses `border-border-primary` ->
  Standardize on one name in common.css; mocks must use the same token as
  prod ->
  Prevents rework when porting mocks to React.

Review: All Phase 1 items are consequences of the explicit 14px constraint or
outright inconsistency. Nothing here is taste — each item is either a
readability or a correctness bug.

---

PHASE 2 — Refinement

- Typography rhythm: with the floor raised, existing vertical rhythm (built
  on a 13px base with 4/6/8px steps) will feel cramped ->
  Rebuild spacing scale so padding/margin steps are multiples of 4 starting
  at 8px for dense surfaces and 12/16/20/24 elsewhere; line-height 1.5 for
  body, 1.35 for dense tables ->
  Rhythm is the other half of readability; just raising font-size without
  opening spacing produces crowded screens.

- Too many colors competing in Events: kind pills use info / accent / success
  / warning / info again / error across search/synth/finding/dedup/extract ->
  Reduce to three semantic colors (process = accent, success = finding,
  warning = dedup+error) and distinguish search/synth/extract with different
  weight or uppercase-only labels ->
  Restraint. The feed should read like a log, not a pride flag.

- Sidebar nav dot is decorative with no behavior ->
  Remove the dot entirely; active state uses bg + text color only ->
  Dots that don't change state earn nothing.

- Concept graph legend at bottom of knowledge tab overlaps the footer rail
  at narrow widths ->
  Move legend to a collapsible inspector in the top-right of the graph, not
  the bottom ->
  Predictable placement regardless of viewport.

- Document tab fact box (`.fact-box`): borders + dashed rows + box wrapper
  create three visual enclosures ->
  Keep the box; remove the dashed row borders; use row padding + zebra bg
  instead ->
  One enclosure per conceptual unit.

- Budget bar colors: amber at 79%, red at 100% — no earlier-stage warning
  and amber+red are too close perceptually ->
  Tokenize as `--bar-ok`, `--bar-warn` (>=70%), `--bar-danger` (>=95%); use
  the existing `--warning` and `--error` consistently ->
  Clearer early-warning threshold, consistent semantic tokens.

- Queries list uses sparkline in one column without a y-axis or tooltip ->
  Keep sparkline, add a tooltip on hover with the numeric weekly series ->
  Sparklines without interaction are decoration.

- Header actions on query detail: Pause / Export / Resume — Resume is primary
  color but reads as less destructive than Pause ->
  Primary color for Resume only when paused; when active, Pause is primary ->
  Primary means "the likely next action," which is state-dependent.

Review: Phase 2 items clean up the design-level noise that Phase 1's floor
raise exposes. Best done right after Phase 1 in one pass.

---

PHASE 3 — Polish

- Loading states: no skeletons for any page ->
  Add skeleton rows for the Queries table, Events feed, Sources table;
  concept panel skeleton on Knowledge tab ->
  App should feel alive during load; avoids layout jump.

- Empty states: no "no queries yet" / "no sources extracted yet" illustrations
  or guidance ->
  One shared empty-state component: icon + short headline + primary action.
  Queries empty: "Start your first research query" CTA. Events empty: "No
  activity in the last hour" ->
  First-run and quiet-state feel finished.

- Error states: extraction 403 shows "403 · retry" inline — fine, but no
  aggregate surface ->
  Sources tab "Retry failed" already exists; add an error-banner on Events
  page when failure rate spikes ->
  Surfaces systemic problems before user investigates one-off.

- Focus states: anchors in the tab strip are clickable but have no
  :focus-visible outline ->
  Add a 2px accent outline offset by 2px on all interactive elements ->
  Keyboard access; WCAG 2.1 SC 2.4.7.

- Tab strip animation: tab change is instant ->
  200ms ease on the underline color + translateX so the active indicator
  feels connected ->
  Micro-continuity; tabs feel like one object, not N separate objects.

- Graph interactions: clicking a node doesn't visibly select it in the SVG
  beyond the side panel swap ->
  On selection, dim non-neighbor nodes to 30% opacity and thicken selected
  node's edges ->
  Focus the user on the chosen concept's neighborhood.

- Sticky table headers on long Sources/Events lists ->
  `position:sticky; top:0` on thead; add bg-primary + 1px border-bottom ->
  Keeps columns labeled during scroll.

- Dark-mode parity check: mocks built for one-dark-pro only ->
  Verify tokens work in nord, dracula, ayu-mirage; specifically check that
  `--accent-dim` is defined in each theme (currently a one-off in the mocks) ->
  Theme parity is a hard Construct requirement.

Review: Phase 3 is the premium layer — none of it is blocking, but a polished
research surface needs the loading/empty/error trio and keyboard parity.

---

DESIGN SYSTEM UPDATES REQUIRED

Typography tokens (add to common.css / global theme)

  --t-meta:    14px  (was implicit 10-12px)  weight 500, letter-spacing .02em
  --t-body:    14px  (was 13px)              weight 400, line-height 1.5
  --t-body-lg: 16px  (new)                   weight 400, line-height 1.6   — document body
  --t-h3:      16px  (was 13px)              weight 600
  --t-h2:      18px  (was 16/18px)           weight 600
  --t-h1:      22px  (unchanged)             weight 600
  --t-mono:    14px  (was 12px)              ui-monospace

Spacing tokens (confirm / add)

  --sp-1: 4px     --sp-2: 8px     --sp-3: 12px
  --sp-4: 16px    --sp-5: 20px    --sp-6: 24px    --sp-8: 32px

Color tokens to consolidate

  --border          (canonical; retire `--border-primary` alias in prod)
  --bar-ok          = var(--accent)
  --bar-warn        = var(--warning)
  --bar-danger      = var(--error)
  --accent-dim      (add to every theme in themes.ts, not just mocks)

Component additions

  <Skeleton variant="row|card|graph"/>
  <EmptyState icon label cta/>
  <StatusPill status="active|paused|exhausted|done|error|pending"/>  — extract
    the pill styles into one component so each status is defined once

---

IMPLEMENTATION NOTES

File: mockups/research/common.css

  Line 25:  font:13px/1.5 -> font:14px/1.5
  Line 38:  .sidebar-brand font-size:14px -> font-size:var(--t-h3) (16px)
  Line 41:  .sidebar-section font-size:10px -> 14px; keep letter-spacing
  Line 44:  .sidebar-link font-size:13px -> 14px
  Line 54:  .page-header .sub font-size:12px -> 14px
  Line 57:  .btn font-size:12px -> 14px
  Line 66:  .pill font-size:11px -> 14px
  Line 79:  .card-head .sub font-size:12px -> 14px
  Line 81:  .mono font-size:12px -> 14px
  Line 83:  Delete `.tiny {font-size:11px}` entirely; replace usages with
           `.t-meta` or remove
  Line 85:  table.data font-size:13px -> 14px
  Line 87:  table.data th font-size:11px -> 14px
  Line 105: .tab font-size:13px -> 14px
  Line 110: .tab .count font-size:11px -> 14px

File: mockups/research/queries.html

  Remove ALL inline `font-size:` style attrs and replace with classes.
  Specific sites: .title-cell .sub, .metric .l, .budget-cell .amt, .filters
  .chip, and the three summary cards at bottom.
  Any 10-12px becomes 14px; any 18-22px keeps its token.

File: mockups/research/query-detail.html

  Line 11-117: full <style> block rewrite against the new token scale
  Line 411-701: strip inline `font-size:11-13px` style attrs; apply utility
  classes
  article.doc sup -> wrap in .citation span with font-size:14px, vertical-align:super

File: mockups/research/events.html

  Lines 13-67: ditto — replace every 10-12px with 14px against tokens

File: mockups/research-config/index.html (Variant A is in-scope; B/C can be
deleted after A is built in React)

  Lines 31-319: rebuild scale — delete Variants B and C blocks entirely from
  the committed mock; keep only Variant A as the reference.
  Fields with `font-size:10-13px`: upgrade to 14px. Field hints must be 14px
  with color var(--text-muted) — color conveys secondary, size does not.

Constraint check

  After edits, run:
    grep -nE 'font-size:\s*([0-9]|1[0-3])px' mockups/ -r
  Must return 0 matches. (Values 14 and above only.)
```

---

## 4. Implementation order

Once the audit's Phase 1 is approved, implement in this sequence:

### Milestone A — Mock cleanup (pre-React)

1. Kill Variants B and C in `mockups/research-config/index.html`; keep Variant A only.
2. Rewrite `common.css` to the 14px scale; move every inline font-size into utility classes.
3. Apply the class sweep to all four HTML mocks.
4. Verify `grep -nE 'font-size:\s*([0-9]|1[0-3])px' mockups/` returns 0.
5. Commit.

### Milestone B — Lift hardcoded values

1. Add three fields to `SessionConfig` in `src/research/src/types.ts` and `DEFAULT_SESSION_CONFIG`:
   - `llm_max_output_tokens: number` (default 8192)
   - `snippet_synthesis_chars: number` (default 3000)
   - `snippet_display_chars: number` (default 200)
2. Replace the hardcoded literals:
   - `engine.ts:1615` → read from session config
   - `providers/openrouter.ts:58` → read from session config
   - `providers/openrouter.ts:76` → read from session config
3. `bun test.ts` — confirm nothing regresses.

### Milestone C — Persist DEFAULT_SESSION_CONFIG

Currently `DEFAULT_SESSION_CONFIG` is a code constant in `types.ts`. Move to a single-row DB table so the UI can edit it:

1. Migration: `research_defaults` table, one row, JSON column matching `SessionConfig` shape.
2. On boot, seed from the code constant if empty.
3. `services/queries.ts:8` deep-merge now merges against the DB row, not the constant.
4. Read/write API routes: `GET /api/research/defaults`, `PUT /api/research/defaults`.

### Milestone D — Config UI (Variant A, in React)

1. Build `ResearchDefaultsPanel` as a new tab on `ResearchConfigPage.tsx` (alongside Providers).
2. Schema-driven form: one TS metadata object describes each field (label, hint, unit, min/max, group). Renderer reads the metadata + current + default.
3. Save on blur. Per-field reset-to-default. Advanced section collapsed by default.

### Milestone E — Per-session config panel

1. Add a "Config" tab to `ResearchSessionDetailPage`.
2. Reuse the same field components and metadata from Milestone D.
3. Show override dots + reset-per-field; changes apply next iteration.

### Milestone F — Concept reframe (separate PR, larger)

Scoped as a follow-up. Not part of the config-surface work above.

1. Schema: `concepts`, `concept_links`, `findings_concepts` join.
2. Concept extraction step in the research loop (`engine.ts` post-synthesis).
3. Aggregate URL dedup at concept level (not per-finding).
4. Doc generator rewrite: per-concept sections + per-section token budget, replacing the single-pass `updateDocument`.
5. Knowledge tab implementation (concept graph).
6. Process tab preserves current thread-tree view.

### Milestone G — Extraction pipeline (separate PR)

1. `sources` table with `extraction_status` column.
2. Extraction worker draining a queue, concurrency from config.
3. Sources tab implementation with per-row retry/cancel actions.
4. Re-run concept linking after successful extraction.

---

## 5. Follow-up decisions still open

- Sidebar nav dot: remove entirely (per audit Phase 2) vs. keep as status indicator. Default: remove.
- `--border-primary` vs `--border` naming: pick one, global search-replace in `src/ui/web/src/`.
- Whether to move mockups out of `mockups/` once the React implementation lands, or keep as historical reference. Default: keep.

---

## 6. Quick resume instructions for next session

1. Read this file.
2. `git log --oneline -10` to see the current state.
3. Mockups at `mockups/research/` and `mockups/research-config/` (Variant A only matters).
4. Current branch: `fix/datatable-fill-columns` — create a new branch `feat/research-config-defaults` for Milestones A–E.
5. Start with Milestone A (mock cleanup + 14px enforcement), then run the audit's Phase 1 checklist as acceptance criteria.
