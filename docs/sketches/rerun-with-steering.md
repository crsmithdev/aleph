# Sketch: re-run a finished query with steering

## Problem

You finish a loop, read the document, and it's not quite right — the canon
drifted, the synthesis stayed too generic, the planner missed a constraint
that's obvious in hindsight ("focus on dev tools for agents, not chatbots";
"give specific company names, not categories"; "ignore the academic
literature, real products only"). The current options are bad:

- **Re-run the same prompt.** Same planner, same canon. Roll the dice on
  whether a different LLM sample lands somewhere better. Mostly doesn't.
- **Rewrite the prompt.** Loses the original phrasing; if the new run also
  misses, you can't tell whether the prompt change or the model variance
  caused the difference.
- **Start over with Custom mode.** You're hand-editing the schedule again
  from scratch. Defeats the point of having a planner.

What's missing: a one-click "I read this output, here's how it should be
different, go again" path that preserves traceability — the new loop knows
it forked from the old one, and the steering text is a first-class field
the planner sees alongside the original prompt, not blended into it.

This is the v1 simple cousin of v2's full directive/Check abstraction
(`docs/plans/research-engine-build-plan.md` v2 section). v2 supports a
*stream* of mid-run directives authored by user / heuristic / LLM-checker;
v1 here is one steering note, baked in at fork time. Phase 5's plan
already calls out "fork-from-cycle on completed runs" as deferred work —
this is that.

## Change

### Data model

Add one column on `loops`:

```sql
ALTER TABLE loops ADD COLUMN steering TEXT;        -- the user's "do this differently" note
ALTER TABLE loops ADD COLUMN parent_loop_id TEXT;  -- the loop this one re-runs from
```

`parent_loop_id` is nullable (top-level loops have no parent). `steering`
is short free-form text (UI caps at ~500 chars), nullable for non-rerun
loops.

DDL goes in `src/research/src/ddl.ts` via the same `ensureColumn` idempotent
ALTER pattern that `mode` already uses.

### New endpoint

```
POST /api/loops/:id/rerun
Body: { steering: string, mode?: Mode }
Response: 201 { id: <new-loop-id> }
```

Implementation in `src/ui/api/src/routes/loops.ts`, alongside
`/regenerate-document`:

1. Read source loop. 404 if not found.
2. Refuse if source loop is still running (`status` in `pending`/`running`)
   — return 409 with a helpful message. Re-running a still-active loop is
   v2's pause-and-fork flow, not this one.
3. Default `mode` to the source loop's mode if not supplied.
4. `createLoop({ template_id, prompt, mode, parent_loop_id: source.id,
   steering })` — same path as a fresh loop, just with the two extra
   fields populated.
5. Spawn the child (same `spawnLoopChild` call the regular start path uses).
6. Return the new loop's id; the UI navigates the user there.

No deferred-spawn (Custom-mode) variant in v1 — the user already had the
schedule on the source loop; if they want to hand-edit the new schedule
pre-start, they pick `mode: 'custom'` in the rerun modal.

### Planner sees steering alongside the prompt

`ensureScheduleArtifact` in `src/research/src/loop/shape.ts` already
folds URL contents into the planner prompt via `buildGroundedPrompt`.
Steering goes in the same place, *after* URL contents:

```ts
// Pseudocode for the augmentation block in ensureScheduleArtifact:
const fetchedUrls = await fetchUrlContents(urls, urlFetcher);
let plannerPrompt = buildGroundedPrompt(prompt, fetchedUrls);
const loop = getLoop(sqlite, loop_id);
if (loop?.steering) {
  plannerPrompt =
    `${plannerPrompt}\n\nSteering for this re-run ` +
    `(prior loop produced unsatisfactory output; rebalance accordingly):\n` +
    loop.steering;
}
```

The detectors keep the original prompt — output_shape / question_shape /
role are properties of the question itself, unchanged by the steering.
Only the planner changes its mind.

The `[shape] grounding` stderr observability line gets a sibling
`[shape] steering applied (N chars)` so the path is visible in logs.

### Schedule artifact carries the steering

`SchedulePayload` in `src/research/src/loop/types.ts` already has
`predecessor_id` for milestone re-plans. Add `steering?: string` so the
schedule artifact captures what was applied. The UI then reads this back
to show the steering banner regardless of whether the loops row gets
truncated for History display.

### UI

**Source loop (completed) — Document tab.**
A new button next to the existing "Regenerate document" button: **"Re-run
with steering"**. Opens a modal:

```
┌────────────────────────────────────────────────┐
│ Re-run this query with steering                │
│                                                │
│ Original prompt:                               │
│ ┌──────────────────────────────────────────┐   │
│ │ What are under-served areas of AI-focused│   │
│ │ development that are good targets for…   │   │
│ └──────────────────────────────────────────┘   │
│                                                │
│ What should be different this time?            │
│ ┌──────────────────────────────────────────┐   │
│ │                                          │   │
│ │ [textarea, 500 char limit]               │   │
│ │                                          │   │
│ └──────────────────────────────────────────┘   │
│                                                │
│ Mode for new run: [ Default ▼ ]                │
│                                                │
│        [ Cancel ]   [ Re-run with steering ]   │
└────────────────────────────────────────────────┘
```

On submit: POST `/api/loops/:id/rerun`, navigate to `/research/<new-id>`.

**New loop — header banner.**
At the top of `ResearchLoopDetail.tsx`, above the tab strip, if
`loop.parent_loop_id` is set:

```
↩  Re-run of  prior-loop-name-abc1   ·  Steering: "Focus on dev tools…"
```

The parent-loop-id is a link back to the source loop. The steering text is
truncated to one line with the full text on hover.

**Plan tab — steering line.**
The PlanSummary card grows one row: `Steering` shows the steering text (or
"—" if none). Sits below the Mode row.

**History page row.**
Each loop row already shows the prompt, mode, stats. Add a small chip:
`rerun ↩` for loops with `parent_loop_id`. Hovering reveals "Re-run of
<parent>". Optional: filter rail toggle "Only re-runs" / "Hide re-runs."

### What stays out of v1

- **Chain visualization.** A loop can be re-run multiple times, producing
  a tree (or DAG if forks are forked). v1 just shows the immediate parent
  in the banner. A "lineage view" is v2.
- **Mid-run steering.** v1 only applies steering at the planner's first
  call. Mid-run nudges (the "user types a directive while it's running"
  case) belong to v2's full Check abstraction.
- **Schedule diff between source and rerun.** Useful — "the new plan has
  these branches the old one missed" — but not in v1. The Plan tab on the
  rerun shows the new plan; the source loop is one click away in the
  banner.
- **Auto-suggested steering.** "The post-mortem said the output was
  vague — suggest 'add specifics' as steering." v2.

## Heuristics that need user sanity-check

- **Steering character limit.** 500 chars feels right — long enough for
  "Focus on dev tools for AI agents, not chatbots; prefer specific company
  names and funding rounds over categories" (135 chars) but short enough
  to discourage rewriting the prompt. Could be 1000. Could be 280
  (Twitter-style forcing function). Open.
- **Default mode for re-runs.** Inherit the source loop's mode? Default to
  whatever the user picked last? Always `Default`? The modal defaults to
  the source loop's mode and lets the user override.
- **Refuse re-running failed loops?** A loop that errored mid-cycle could
  be re-run with steering to address whatever failed. Probably yes — allow
  re-running any non-running loop. The status badge will tell the user
  they're forking from a failure.

## Open questions

- **Does steering also reach the synthesizer?** v1 says no — only the
  planner sees it. Rationale: the synthesizer renders the canon the
  planner picked; if the planner correctly absorbed the steering, the
  synthesizer will follow. If empirically the synthesizer ignores the
  re-balanced canon, route steering through to the document generator's
  prompt too. Defer until we have data.
- **Does the rerun inherit the source's schedule artifact, or replan
  from scratch?** v1 = replan. `ensureScheduleArtifact` runs fresh, sees
  `steering` on the loop, builds an augmented planner prompt, emits a
  new schedule with `predecessor_id` linking to the source. The
  alternative — copy schedule then mutate — keeps more of the old plan
  but conflicts with the whole "let the planner rebalance" premise of
  steering.
- **Steering rendered as the user typed it, or LLM-cleaned first?** v1
  just passes it through. Risk: ambiguous steering produces ambiguous
  plans. If empirically that hurts, add a tiny LLM normalize step
  ("rewrite the user's steering as a single clear directive"). Defer.
- **Naming.** "Steering" vs "directive" vs "feedback" vs "nudge." The plan
  doc uses "directive" for the v2 streaming concept, so v1 deliberately
  picks `steering` to avoid collision. The UI label "Re-run with
  steering" is fine; revisit if user testing shows confusion.

## Path forward

1. **Schema.** Add `steering` + `parent_loop_id` columns via
   `ensureColumn` in `ddl.ts`. Add `predecessor_id`-style accessors in
   `db.ts`. Existing loops keep working — both fields default to NULL.
2. **Engine + planner wiring.** Extend `ensureScheduleArtifact` to fold
   `loop.steering` into the planner prompt after URL contents. Add
   `steering` to the schedule payload. Stderr observability line.
3. **API endpoint.** `POST /api/loops/:id/rerun`. Tests: rerun of a
   completed loop succeeds; rerun of a running loop 409s; the new loop's
   prompt and parent fields are correct.
4. **UI — source side.** "Re-run with steering" button on the Document
   tab + modal. Probably the biggest single piece of code.
5. **UI — destination side.** Banner on the rerun loop, Plan-tab steering
   row, History-row chip. Small but spread across three files
   (`ResearchLoopDetail.tsx`, `ResearchHistoryPage.tsx`, the History card).

Steps 1-3 are the backend skeleton; the feature works via curl after step
3. Step 4 makes it usable. Step 5 makes re-runs distinguishable from
fresh loops in the rest of the UI.

Each step is independently mergeable; if step 4 takes longer than
expected, the engine still works and a thin "Re-run" button could ship
without the steering modal as a placeholder (passes empty steering, just
forks).
