# Goal to shipped

Written 2026-10-25. Version 4, 2026-10-27: version 3 plus the decisions of the
seed spec ([`2026-10-26-seed-factory.md`](2026-10-26-seed-factory.md), v3,
`4f31309`) and the memory research. Not built. Each piece gets its own spec in
this folder; this file stays the map. Versions 1 to 3 are in git (`4e0da45`,
`2c6942d`, `f31014b`).

Version 4 changes:

- The seed is specified; "Bootstrap first" points at its spec.
- The order after the seed is concurrency, the Jev judge through OpenRouter,
  the UI, non-code goals, the rest of routing, memory, then Sidetone.
- The factory runs always on, in parallel with Chris. The seed starts runs
  from a 30-minute timer.
- The work store is Backlog.md files in a private repo at `~/.aleph/items`.
- Workers and checks run under `srt`, Anthropic's sandbox-runtime.
- The memory piece takes the memory research's rules.
- "`aleph land` is the only path to `main`" becomes "the factory's only path
  to `main`".
- The references the seed spec uses are listed at the end.

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
| aleph itself | the pieces below | `origin/main` of aleph, through the factory's land |

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
4. **One report, not many messages.** The report is the one place Chris
   reads. It lists, per goal: delivered, needs a look (with a time estimate),
   stuck, or waiting for an answer. Version 3 called it the digest; the seed
   renamed it, because `hooks/lib/digest.ts` already uses that name.

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
| 2 | Grill | Five to ten questions about the product, never the implementation, each with a recommended answer | planner model, Chris |
| 3 | Spec | The planner expands the goal into a product spec: what done means, the grading criteria, where it is delivered, the budget | planner model |
| 4 | Decompose | Tasks, each sized to finish in one run | planner model |
| 5 | Make | One worker per task, in its own isolated workspace | worker model |
| 6 | Check | Code: lint, tests, no edits to existing tests, a fresh reviewer. Writing and research: the rubric, a fresh judge, source checks. Capped fix rounds | deterministic, reviewer model |
| 7 | Deliver | Code lands on `origin/main` through the factory's land; documents go to their place (a draft branch, a doc, an artifact, the vault) | deterministic |
| 8 | Accept | Run the goal's hidden checks against the delivered thing | deterministic, judge model |
| 9 | Report | The report: delivered, needs a look, stuck, waiting | report model |

Stages 4 to 8 repeat until the goal's checks pass, the budget ends, or a task
is stuck after its fix rounds. A stuck task goes to the report, not into a
retry loop.

## Goal, grill and spec stay at the product level

This follows Anthropic's harness for long-running apps
(https://www.anthropic.com/engineering/harness-design-long-running-apps).

- **The goal is one to four sentences.** Chris never writes a detailed spec.
  Anthropic's planner took a single sentence and produced a 16-feature spec.
- **The grill asks about the product, not the code:** who it is for, what it
  must do, what good looks like, where it goes, what it must not do. Each
  question has a recommended answer.
- **The planner expands, at the product level.** The spec holds the product
  context, the features as user stories, a high-level technical design and the
  grading criteria. It leaves out detailed implementation, because "errors in
  the spec would cascade into the downstream implementation"; the workers find
  the path as they go.
- **Keep the planner.** Without it, Anthropic's generator under-scoped the
  work. With newer models Anthropic removed sprints and context resets, but
  kept the planner and the evaluator.

## Grading criteria

Each goal kind has a small set of grading criteria. Each criterion has a hard
threshold: one criterion below its threshold fails the check, whatever the
others score. An evaluator that did not make the thing scores it, after it uses
the thing the way Chris would (Playwright for an app, a read-through for a
document). The evaluator is calibrated with a few scored examples, because
Anthropic's evaluator "talked itself into approving" work until it had hard
thresholds.

| Goal kind | Criteria | Source |
|---|---|---|
| App or tool | product depth, functionality, visual design, code quality | Anthropic, full-stack harness |
| Front end | design quality, originality, craft, functionality; the first two weigh more | Anthropic, frontend experiment |
| Writing | to be set in the non-code goal plan; a starting point is the voice sample, clarity, structure, and the humanizer's AI-pattern checks | proposal |
| Research | to be set in the non-code goal plan; a starting point is source credibility, coverage of the question, claims that trace to a fetched source | proposal |

Before a worker starts, it writes a short contract: what it will make and how
the evaluator will check it. The evaluator agrees or asks for changes. They
communicate through files. Anthropic's contracts had up to 27 criteria.

Cost reference (Anthropic, Opus 4.6): one app in 3 h 50 min for $124.70, of
which planning cost $0.46 and three QA passes about $10.

## Standing automations

A standing automation runs on a trigger with no goal behind it, like Ona's
feature planner or product improver. Most of these make work nobody asked for,
which is how Ona's factory ended in chores. The rule:

- **May run unattended:** automations for reliability and stability: finding
  bugs, smoke tests after delivery, broken integrations, flaky checks, stale
  dependencies, the factory's own health.
- **May run unattended for a time:** experiments, each with an end date and a
  budget, listed in the report until they end.
- **Proposes only:** everything else, such as feature generators and product
  improvers. Their output is a proposed goal in Chris's queue, not work in
  progress.

## What this plan treats as fixed

- Claude Code is the agent runtime. Workers are `claude -p` runs, started by
  Chris's systemd user units.
- Git owns the fate of code. `origin/main` on GitHub is the record of what has
  landed. The factory's land is the factory's only path to `main`; Chris still
  lands his own work by hand. In version 3 this given read "`aleph land` is the
  only path to `main`". It moved because the seed's milestone 2 replaces
  `aleph land` with a serial land queue.
- The vault is memory. Langfuse is the trace store.
- One developer, one machine (WSL2), Bun.

## How the factory runs

- **Always on, in parallel with Chris.** Workers never touch his ports,
  servers or checkouts. A land changes only `origin/main`; Chris's checkout
  moves when he runs `git pull`, and for aleph that pull is his review. The
  seed starts runs from a 30-minute timer, with a cap of 12 runs in any 24
  hours, and idles when no goal is open.
- **Sandbox.** Each worker and each check runs under `srt`
  (`@anthropic-ai/sandbox-runtime`) inside the systemd user unit. The sandbox
  sees only its run folder and the pinned `claude` and `bun` binaries, and
  reaches only Anthropic's API and the npm registry. Code goes in and out as
  git bundles. `aleph sandbox probe` tests the isolation before the first run
  and every night. This replaces the corpus's `git clone --shared` in
  bubblewrap (to-do 25). `srt` has not run on this machine yet; the fallback
  is Docker with `--network none`.
- **Work store.** One Backlog.md file per item in a private git repo at
  `~/.aleph/items`. `aleph todo` keeps its commands and writes there; no
  product repo's `main` moves when an item changes.
- **Held paths.** Only the factory's own gate is held for Chris: the land
  code, the gate hooks, identity `CLAUDE.md`, the build files, and edits to
  existing tests. The list per repo is in `~/.aleph/repos.json`, which the
  sandbox cannot see.

## Bootstrap first

The first goal is a factory just able to build the rest of itself. After that,
each remaining piece enters the factory as a goal, and Chris directs it through
the same grill and report as any other goal. This is also the factory's best
first test: aleph is code with tests, so its checks have an oracle.

The minimum factory (the **seed**) has its own spec:
[`2026-10-26-seed-factory.md`](2026-10-26-seed-factory.md) (to-do 31). In
short, milestone 1 is:

1. `/aleph:goal`: a product-level grill that writes one goal item to the work
   store.
2. One sandboxed run per goal, with no plan or decompose stage, then the
   repo's checks, then a land on `origin/main` or a hold for Chris.
3. `aleph report` in the next session Chris opens.
4. A budget and a stop: 12 runs in any 24 hours, a 40-minute time box,
   `aleph pause`, and idle when no goal is open.

The proofs are to-dos 28 and 27. Milestone 2 adds a serial land queue and item
state derived from `Item:` trailers on `origin/main`.

The seed does not need the UI, the desktop app, model routing beyond one
default, episodic memory, or the non-code checks. Those are its first goals,
in this order:

1. Concurrency: the seed's milestone 2, so that several runs land without
   manual steps.
2. The Jev judge (piece 3, first half): Jev through OpenRouter answers the
   typed questions that `hooks/lib/judge.ts` sends to Haiku today. Chris, 27
   Oct: build it early.
3. The UI (piece 4, second half): observability, the report and the waiting
   queue as a page, and management of goals.
4. Non-code goals: the rubric and judge checks, and delivery to docs,
   artifacts and the vault. This opens the personal scope.
5. The rest of model routing (piece 3): a model tier per stage.
6. Memory (piece 1).
7. The Sidetone desktop app (piece 5).

The reviewer, the baseline check on `main` and the report's extras are also
later factory goals.

**Risk.** A harness that builds itself can absorb all the time. Yegge's Gas
Town stopped because the model kept improving the harness ("just two more
things"). Each self-goal therefore has an end state and a budget like any
other goal, and after concurrency at least one goal in three is not about
aleph.

## The pieces

### 1. Memory (to-do 24)

The memory plan covers all seven agent memory types (vault: Seven Agent Memory
Types Mapped Onto Aleph). Each row says what holds it today and what the
factory adds. The memory spec (`docs/specs/2026-10-27-memory.md`) gives each
type its owner, store and gate, and defines milestone 1.

| Type | Holds | Today | The factory adds |
|---|---|---|---|
| Working | the context of one run | `context-gate.ts`, handoffs | a context reset with a file handoff instead of compaction, about every 200K to 300K tokens; each task's run starts from the spec, the task and git log |
| Semantic | facts and preferences | `MEMORY.md`, `wiki/` | facts learned during a goal enter the vault through a reviewer, never from a worker directly |
| Episodic | past tasks and how they went | Langfuse traces, `daily/`, handoffs | `vault recall --episodes`: a run finds how a similar task went before; each goal's report entry is kept as an episode |
| Procedural | rules, skills, workflows | skills, `CLAUDE.md`, hooks | repeated corrections mined from traces become rules or checks; the goal-kind templates (code, writing, research) are procedures |
| Retrieval | search over stored material | `vault recall` (substring) | log recall misses; add embeddings only if misses are frequent |
| Parametric | what the model knows | the model | nothing stored that the model already knows; the routing table (piece 3) picks the model whose knowledge a stage needs |
| Prospective | future intentions | `aleph todo`, `aleph job` | the work store's goals and tasks (Backlog.md in `~/.aleph/items`); the factory's timer; questions waiting for Chris |

Each finished goal writes what it learned: decisions into the goal's own docs,
durable facts into the vault through a reviewer.

The memory research (`~/.aleph/reports/Shared memory across factory
agents.md`) sets these rules:

- **One owner, one store and one gate per memory type.** No new store. No
  agent writes where it reads its orders.
- **Lessons pass between agents only as reviewed files.** A correction seen
  three or more times becomes a proposal in the report: a check first, a repo
  `CLAUDE.md` line second, a skill third. Chris's yes lands it. No shared
  lessons file, no per-agent memory store, no vector or graph database.
- **Workers run with auto memory off.** A worker starts from the item, the
  repo's `CLAUDE.md` and `git log`. Builders read no raw episodes; the planner
  reads them.
- **The verifier's verdict is the only success label.** Nothing downstream
  trusts a worker's own claim of success.
- **The report writer is the single consolidator.** It writes one episode per
  goal from git, the ledger and Langfuse, never from worker claims.

The seed takes the third and fourth rules. The rest is piece 1.

### 2. Factory (to-dos 25, 30 and 15)

The loop above. It revises the agent seats spec with the research before it is
built: a fresh reviewer as key 2, a land check on test-file edits, risk
routing, a cap on items waiting for Chris, no seat-to-seat messaging, a "flag
for human" outcome, stall detection. New parts that the seats spec does not
have: the goal spec with its checks, decomposition, delivery for non-code work,
the acceptance run and the report.

### 3. Model routing (to-dos 26 and 28)

A fixed tier per stage, not a router per request. Starting point: Fable 5.1
plans and writes the report, Opus 5.5 reviews, Sonnet 5.5 makes, and Jev
answers typed questions (is this stop claim backed, does this pass the rubric
item). Jev runs through OpenRouter (Chris, 27 Oct), at $0.042/M input tokens.
It is the one paid API in the factory; every other stage bills to the
subscription. Jev is built first, as the second goal after the seed. Cost
accounting must price every model in use first (to-do 28).

### 4. Work store, UI and visibility (to-do 29)

The unit of work grows from a line in `docs/todo.md` to an item with a parent
goal, a state, links to runs and deliveries, and a history. The seed builds
the first half: Backlog.md files in `~/.aleph/items`, with Backlog.md's board
until the UI exists. Then a UI whose front page is the report: delivered, needs a look, stuck, waiting. It shows the
evidence for each delivery, so a spot check takes minutes. Old aleph's UI
(`~/aleph-old/src/ui`) is a source of components, not a base. The UI's spec is
[`2026-10-27-ui.md`](2026-10-27-ui.md).

### 5. Sidetone desktop app (Sidetone to-do 93)

The control surface for Chris's input. Start a goal and answer its grill by
voice, hear the report, and approve or reject what waits. It is a client of the
work store and the factory; it owns no state. It reuses Sidetone's bridge for
speech. Because Chris's input is the constraint, voice is the cheapest input
channel, but it is built last: the corpus has no evidence on voice intake.

## Open decisions

Each detailed plan settles these with Chris. Recommendations are not decisions.
The seed settled three of version 3's open decisions: the work store
(Backlog.md in `~/.aleph/items`), the budget (subscription only, 12 runs in
any 24 hours; Jev through OpenRouter is the one paid API) and isolation (`srt`).

| Decision | Options | Recommendation |
|---|---|---|
| Delivery without a yes | drafts and local or preview only; also public | Drafts and local or preview only |
| Non-code checks | rubric and judge only; also a second model's review | Rubric and judge, with sources checked by fetch for research |
| Desktop app | Electron; Tauri; a web app in a desktop shell | Decide in piece 5's plan |

## References

The references the seed spec uses, corrected by the runtime red team
(`~/.aleph/handoffs/red-team/seed-decisions-round1-runtime.md`). Notes are in
`~/.aleph/research_notes/Seed factory references/notes.md`.

1. A. Karpathy, "autoresearch", GitHub, March 2026.
2. A. Karpathy, "AgentHub", GitHub, March 2026 (read through a preserved fork).
3. A. Karpathy, "From Vibe Coding to Agentic Engineering", Sequoia AI Ascent,
   April 2026 (third-party transcript).
4. A. Karpathy, post on collaborative agent swarms, 8 March 2026.
5. E. Schluntz and B. Zhang, "Building Effective Agents", Anthropic
   Engineering, December 2024.
6. Anthropic, "Dynamic Workflows", Claude Code, May 2026.
7. Anthropic, Knowledge Graph Construction Cookbook, claude-cookbooks (partly
   read).
8. L. Martin, G. Cemaj, M. Cohen, "Scaling Managed Agents", Anthropic
   Engineering, April 2026.
9. A. Karpathy, "Software 3.0, Agentic Engineering, and Jagged Intelligence",
   30 April 2026.
10. Fortune, "Why everyone is talking about Karpathy's autonomous AI research
    agent", 17 March 2026.
11. Anthropic, "Building Effective AI Agents: Architecture Patterns", 2026
    (behind a form; not used).
12. J. Sumner, Bun Zig-to-Rust port using Dynamic Workflows, May 2026.
