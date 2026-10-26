# Goal to shipped

Written 2026-10-25. Version 1: the vision and the pieces, before any piece has
a detailed plan. Not built. Each piece gets its own spec in this folder; this
file stays the map.

## The vision

Chris states a goal in one or two sentences, by voice or by text. For example:
"an app that helps me write copy for blog posts with AI, interactively." The
system asks a short grill at the level of the goal, not the code. Then it works
without input: it plans, builds, tests and deploys. The next morning it reports
what it shipped, where it is, how well it went, what broke and what it could
not solve. A dozen goals can be in flight at once, and Chris keeps adding more.

## What the evidence says about the vision

The factory research (`~/.aleph/reports/AI agent software factory design.md`,
vault: Software Factories Are Pipelines Gated By Verification) sets three
limits on this plan:

- Every factory that ships is a fixed pipeline, not a team of agents that talk
  to each other. One task goes to one agent in one isolated workspace.
- Tests passing is a weak gate. Agents edit tests to pass them. The gate must
  use acceptance scenarios that the workers cannot read, a diff check on test
  files and a reviewer that did not write the code.
- Chris's attention is the scarce resource, not agent count. The system must
  cap what waits for him and route by risk.

"Done the next morning" is therefore realistic for a preview deployment that
passes its acceptance scenarios. It is not realistic for production quality
with no review. The morning report is where Chris gives the review.

## The loop

| # | Stage | What happens | Who |
|---|---|---|---|
| 1 | Intake | A goal arrives from Sidetone (voice or desktop), the CLI or the UI | Chris |
| 2 | Grill | Five to ten questions at goal level, each with a recommended answer; Chris may say "use your defaults" | planner model, Chris |
| 3 | Spec | A goal spec: what done means, acceptance scenarios, deploy target, budget | planner model |
| 4 | Decompose | The spec becomes tasks, each sized to finish in one run | planner model |
| 5 | Build | One worker per task, in its own worktree | worker model |
| 6 | Gate | Lint and tests; no edits to existing tests; a fresh reviewer reads spec, diff and test diff; capped fix rounds | deterministic, reviewer model |
| 7 | Land | Squash merge to `main` through `aleph land` | deterministic |
| 8 | Deploy | Deploy to the goal's preview target | deterministic |
| 9 | Accept | Run the hidden acceptance scenarios against the deployment | deterministic, judge model |
| 10 | Report | One morning report over all goals: shipped, failing, stuck, needs Chris | report model |

Stages 4 to 9 repeat until the goal's scenarios pass, the budget ends, or a
task is stuck after its fix rounds. A stuck task goes to the report, not into
a retry loop.

## What this plan treats as fixed

- Claude Code is the agent runtime. Workers are `claude -p` runs.
- Git owns the fate of code. `aleph land` is the only path to `main`.
- The vault is memory. Langfuse is the trace store.
- One developer, one machine (WSL2), Bun.

## The pieces

### 1. Memory (to-do 24)

Episodic recall over Langfuse traces, so a run can find how a similar task
went before. Log recall misses before adding embeddings. Each finished goal
writes what it learned: decisions into the goal's repo docs, durable facts into
the vault through a reviewer. Vault: Seven Agent Memory Types Mapped Onto Aleph.

### 2. Factory (to-dos 25 and 15)

The loop above. It revises the agent seats spec with the research before it is
built: a fresh reviewer as key 2, a land check on test-file edits, risk
routing, a cap on items waiting for Chris, and no seat-to-seat messaging.
New parts that the seats spec does not have: the goal spec with hidden
acceptance scenarios, decomposition, the deploy step and the acceptance run.

### 3. Model routing (to-dos 26 and 28)

A table that gives each stage a model tier and an escalation rule. Starting
point: Fable 5.1 plans and writes the report, Opus 5.5 reviews diffs, Sonnet
5.5 builds, Haiku 5.5 or Jev screens intake and judges stop claims. Cost
accounting must price every model in use first (to-do 28).

### 4. Work store, UI and visibility (to-do 29)

The unit of work grows from a line in `docs/todo.md` to an issue with a parent
goal, a state, links to runs, branches and deploys, and a history. Then a UI
whose front page is goals: their state, the night's report and the items that
wait for Chris. Trace views read Langfuse's API. Old aleph's UI (Fastify and
React, about 25 pages in `~/aleph-old/src/ui`) is a source of components, not
a base.

### 5. Sidetone desktop app (Sidetone to-do 93)

A desktop app that controls the whole system. It is the voice and the window
for the same loop: start a goal and answer its grill by voice, hear and read
the morning report, approve or reject what waits, and watch runs. It is a
client of the work store's API and the factory's controls; it owns no state.
It reuses Sidetone's bridge for speech.

## Build order

1. Work store (piece 4, first half). Every other piece writes to it.
2. Factory on one goal end to end (piece 2), with the report as a text file.
3. Model routing inside the factory (piece 3).
4. The UI (piece 4, second half).
5. The Sidetone desktop app (piece 5).

Memory (piece 1) has no dependency and can go in at any point.

The acceptance test for the whole plan is the example goal: Chris says "an app
that helps me write copy for blog posts with AI, interactively", answers the
grill, and the next morning the report links to a preview that passes its
scenarios.

## Open decisions

Each detailed plan settles these with Chris. Recommendations are not decisions.

| Decision | Options | Recommendation |
|---|---|---|
| Work store | GitHub Issues through `gh`; a local SQLite tracker; extend `docs/todo.md` | GitHub Issues: a web and mobile UI, sub-issues and PR links for free |
| Overnight autonomy | preview deploys only; full deploy; no deploys | Preview only; production, DNS, paid services and public posts wait for a yes in the report |
| Night budget | subscription only; a capped API spend | Subscription first, with the report showing how much of the weekly cap each goal used |
| UI | new and goal-first; revive old aleph; none yet | New and goal-first, porting old components |
| Desktop app | Electron; Tauri; a web app in a desktop shell | Decide in piece 5's plan |
| Deploy targets | per goal; one default (Vercel preview, a LAN port) | One default per kind of app, set in the goal spec |
