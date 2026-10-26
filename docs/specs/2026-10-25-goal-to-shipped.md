# Goal to shipped

Written 2026-10-25. Version 2: version 1 plus three corrections from Chris on
the same day (bootstrap first, personal scope, Chris's input and checking time
as the constraint). Not built. Each piece gets its own spec in this folder; this
file stays the map. Version 1 is in git (`4e0da45`).

## The vision

Chris states a goal in one or two sentences, by voice or by text. The system
asks a short grill at the level of the goal. Then it works without input: it
plans, makes the thing, checks it and delivers it to where it belongs. Later it
reports what it delivered, how well it went, what broke and what it could not
solve. Many goals are in flight at once, and Chris keeps adding more.

## Scope: personal work, not products

The goals are Chris's own projects. Most are not code, and none is an
enterprise product. Examples:

| Kind | Example | Delivered to |
|---|---|---|
| Writing | a blog post draft | the blog repo, as a draft branch |
| Learning material | a training program for AI SWE interviews | a doc or an artifact |
| Research | a survey with ranked sources | `~/.aleph/reports/` and the vault |
| Small app or tool | an app that helps write blog copy interactively | a repo and a local or preview URL |
| aleph itself | the pieces below | `aleph`, through `aleph land` |

Production deploys, public posts and anything that spends money or speaks for
Chris stay behind his yes.

## The constraint: Chris's input and checking time

The scarce resource is Chris's time: what he must type or say to direct the
work, and what he must check by hand. Agent hours and tokens are not the
constraint, within the budget. Every design choice is judged by one measure:
**Chris-minutes per delivered goal**, split into minutes of input and minutes
of checking.

This sets four rules:

1. **Input is batched.** A goal costs one grill at the start, with a
   recommended answer for every question, so "use your defaults" is a valid
   answer. Questions that arise later wait in one queue, not in a chat.
2. **Checking is made cheap.** Every delivery comes with its evidence: what was
   checked, by what, and the result. Chris spot-checks; he does not
   re-derive.
3. **Checks run without Chris where an oracle exists.** Code has tests and a
   running app. Writing and research have no oracle: a rubric and a judge model
   filter them, and Chris's taste is the final check. The report says which
   kind of check each delivery had.
4. **One digest, not many messages.** The report is the one place Chris reads.
   It lists, per goal: delivered, needs a look (with a time estimate), stuck,
   or waiting for an answer.

## What the evidence says

The factory research (`~/.aleph/reports/AI agent software factory design.md`
and `~/.aleph/reports/Software factory corpus.md`; vault: Software Factories
Are Pipelines Gated By Verification, A Personal Dark Factory Needs An End State
Per Goal) sets these limits:

- A working factory is a fixed pipeline. One task goes to one agent in one
  isolated workspace. Agents do not talk to each other.
- Passing visible checks is a weak gate. Agents edit tests to pass them. Code
  needs checks the worker cannot read or edit; writing needs a rubric applied
  by a judge that did not write it.
- Each goal needs an end state. Ona's factory had none, ran out of goals and
  filled its days with chores. The factory idles when no goal is open.
- Long unattended runs work only against an oracle. Without one, the output
  is a draft for Chris, and the report says so.

## The loop

| # | Stage | What happens | Who |
|---|---|---|---|
| 1 | Intake | A goal arrives from Sidetone, the CLI or the UI | Chris |
| 2 | Grill | Five to ten questions at goal level, each with a recommended answer | planner model, Chris |
| 3 | Spec | What done means, the checks (tests, scenarios or a rubric), where it is delivered, the budget | planner model |
| 4 | Decompose | Tasks, each sized to finish in one run | planner model |
| 5 | Make | One worker per task, in its own isolated workspace | worker model |
| 6 | Check | Code: lint, tests, no edits to existing tests, a fresh reviewer. Writing and research: the rubric, a fresh judge, source checks. Capped fix rounds | deterministic, reviewer model |
| 7 | Deliver | Code lands through `aleph land`; documents go to their place (a draft branch, a doc, an artifact, the vault) | deterministic |
| 8 | Accept | Run the goal's hidden checks against the delivered thing | deterministic, judge model |
| 9 | Report | The digest: delivered, needs a look, stuck, waiting | report model |

Stages 4 to 8 repeat until the goal's checks pass, the budget ends, or a task
is stuck after its fix rounds. A stuck task goes to the report, not into a
retry loop.

## What this plan treats as fixed

- Claude Code is the agent runtime. Workers are `claude -p` runs.
- Git owns the fate of code. `aleph land` is the only path to `main`.
- The vault is memory. Langfuse is the trace store.
- One developer, one machine (WSL2), Bun.

The corpus argues that unattended workers should run in a `git clone --shared`
inside bubblewrap, not a git worktree (to-do 25). That changes the isolation
item, not the list above.

## Bootstrap first

The first goal is a factory just able to build the rest of itself. After that,
each remaining piece enters the factory as a goal, and Chris directs it through
the same grill and digest as any other goal. This is also the factory's best
first test: aleph is code with tests, so its checks have an oracle.

The minimum factory (the **seed**):

1. A work store that holds goals and tasks with a state (piece 4, first half).
2. The loop for code goals: grill, spec, decompose, make, check, land.
3. The digest as a text file, read in the morning.
4. A budget and a stop: a cap per run and per night, and idle when no goal is
   open.

The seed does not need the UI, the desktop app, model routing beyond one
default per stage, episodic memory, or the non-code checks. Those are its
first goals, in this order:

1. Model routing (piece 3): cuts the cost of every later goal.
2. Non-code goals: the rubric and judge checks, and delivery to docs,
   artifacts and the vault. This opens the personal scope.
3. The UI (piece 4, second half): the digest and the waiting queue as a page.
4. Memory (piece 1).
5. The Sidetone desktop app (piece 5).

**Risk.** A harness that builds itself can absorb all the time. Yegge's Gas
Town stopped because the model kept improving the harness ("just two more
things"). Each self-goal therefore has an end state and a budget like any
other goal, and at least one goal in three is not about aleph.

## The pieces

### 1. Memory (to-do 24)

The memory plan covers all seven agent memory types (vault: Seven Agent Memory
Types Mapped Onto Aleph). Each row says what holds it today and what the
factory adds.

| Type | Holds | Today | The factory adds |
|---|---|---|---|
| Working | the context of one run | `context-gate.ts`, handoffs | a context reset with a file handoff instead of compaction, about every 200K to 300K tokens; each task's run starts from the spec, the task and git log |
| Semantic | facts and preferences | `MEMORY.md`, `wiki/` | facts learned during a goal enter the vault through a reviewer, never from a worker directly |
| Episodic | past tasks and how they went | Langfuse traces, `daily/`, handoffs | `vault recall --episodes`: a run finds how a similar task went before; each goal's digest entry is kept as an episode |
| Procedural | rules, skills, workflows | skills, `CLAUDE.md`, hooks | repeated corrections mined from traces become rules or checks; the goal-kind templates (code, writing, research) are procedures |
| Retrieval | search over stored material | `vault recall` (substring) | log recall misses; add embeddings only if misses are frequent |
| Parametric | what the model knows | the model | nothing stored that the model already knows; the routing table (piece 3) picks the model whose knowledge a stage needs |
| Prospective | future intentions | `aleph todo`, `aleph job` | the work store's goals and tasks with due dates and a trigger; the factory's wake schedule; questions waiting for Chris |

Each finished goal writes what it learned: decisions into the goal's own docs,
durable facts into the vault through a reviewer.

### 2. Factory (to-dos 25, 30 and 15)

The loop above. It revises the agent seats spec with the research before it is
built: a fresh reviewer as key 2, a land check on test-file edits, risk
routing, a cap on items waiting for Chris, no seat-to-seat messaging, a "flag
for human" outcome, stall detection. New parts that the seats spec does not
have: the goal spec with its checks, decomposition, delivery for non-code work,
the acceptance run and the digest.

### 3. Model routing (to-dos 26 and 28)

A fixed tier per stage, not a router per request. Starting point: Fable 5.1
plans and writes the digest, Opus 5.5 reviews, Sonnet 5.5 makes, Haiku 5.5 or
Jev answers typed questions (is this stop claim backed, does this pass the
rubric item). Cost accounting must price every model in use first (to-do 28).

### 4. Work store, UI and visibility (to-do 29)

The unit of work grows from a line in `docs/todo.md` to an item with a parent
goal, a state, links to runs and deliveries, and a history. Then a UI whose
front page is the digest: delivered, needs a look, stuck, waiting. It shows the
evidence for each delivery, so a spot check takes minutes. Old aleph's UI
(`~/aleph-old/src/ui`) is a source of components, not a base.

### 5. Sidetone desktop app (Sidetone to-do 93)

The control surface for Chris's input. Start a goal and answer its grill by
voice, hear the digest, and approve or reject what waits. It is a client of the
work store and the factory; it owns no state. It reuses Sidetone's bridge for
speech. Because Chris's input is the constraint, voice is the cheapest input
channel, but it is built last: the corpus has no evidence on voice intake.

## Open decisions

Each detailed plan settles these with Chris. Recommendations are not decisions.

| Decision | Options | Recommendation |
|---|---|---|
| Work store | GitHub Issues through `gh`; a local SQLite tracker; extend `docs/todo.md` | GitHub Issues: a web and mobile UI and links to PRs for free |
| Delivery without a yes | drafts and local or preview only; also public | Drafts and local or preview only |
| Night budget | subscription only; a capped API spend | Subscription first, with the digest showing how much of the weekly cap each goal used |
| Non-code checks | rubric and judge only; also a second model's review | Rubric and judge, with sources checked by fetch for research |
| Isolation | worktree; `git clone --shared` in bubblewrap | Decide in the factory plan (to-do 25) |
| Desktop app | Electron; Tauri; a web app in a desktop shell | Decide in piece 5's plan |
