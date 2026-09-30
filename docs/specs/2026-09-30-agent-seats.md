# Agent seats

Written 2026-09-30. Version 1, from one `grill-me` session and two surveys of
the field. It extends [`2026-09-24-agent-jobs.md`](2026-09-24-agent-jobs.md),
which stays true: a job is still a run, and `aleph land` is still the only path
to `main`. Not built.

## Problem Statement

The lead drives every piece of work. A job is an anonymous one-shot run: it
starts clean, it cannot carry work across a wake, and it has no name the lead
can address twice. The lead therefore holds every plan, reviews every diff and
routes every answer.

The ledger under that model no longer says what is true.

| Problem | Evidence |
| --- | --- |
| The ledger is fully drifted | All 73 agent runs in `passed`, `failed` or `needs-you` point at a branch and a worktree that no longer exist. `git branch --list 'job/*'` returns nothing in `aleph`, `sidetone` or `cloudchamber` |
| "Passed" does not mean landable | 58 of those 73 read as `passed`. There is nothing left to land |
| A landed job reads as failed | `aleph jobs` lists `voice-eval`, `prefer-background`, `audio-static` and `tool-batching` as failed. All four reached `main` by hand. Item 2 |
| Evidence is lost at the moment it exists | No run records its branch tip, merge-base or net patch-id, so a run whose branch is deleted can never be resolved. Item 3 |
| The to-do file loses concurrent writes | `todo/lib/todo.ts` reads, renders and rewrites the whole file with no lock and no temporary name. `jobs/cli.ts` locks; `todo` does not. Item 14 |
| A land dirties the checkout it depends on | `aleph land` marks a linked item done in the main checkout, so the next land does not fast-forward there. Item 7 |
| One run can cost more than a normal day | 76 runs carry a cost. Total $115.16, mean $1.52, top $11.54. The variance is inside a run, not across a month |

A second agent that lands work multiplies each of these. The drift is 73 runs
with one lead; it is 73 runs for each seat with several.

## Solution

1. A **seat** is a durable name: a role brief, a fixed seed session id, a vault
   scope and a set of limits, in one markdown file under `~/.aleph/team/`. It
   runs no process between wakes.
2. A seat wakes when it has input. `aleph send` records a message and starts a
   run. A heartbeat is a systemd timer that sends a message, so scheduling needs
   no second mechanism.
3. A wake resumes the item's own session, forked once from the seat's seed
   session. The item, not the seat, owns the context.
4. The **to-do item is the unit**: of work, of ownership, of workspace and of
   fate. A worktree belongs to an item. A handoff moves the item and the
   worktree in one write.
5. **The writer is never the approver.** A different seat approves a diff before
   `aleph land` runs, and a different seat approves a durable fact before it
   enters the vault.
6. Three truths, and they never overlap. `docs/todo.md` owns the item. Git owns
   the fate of code. SQLite owns events that happened once. Nothing derivable is
   stored.
7. `aleph reconcile` derives fate from recorded git evidence, so a branch that
   is deleted after the evidence exists stays resolvable.
8. Limits bind what is scarce: the concurrency cap, a per-seat hourly wake
   budget and a cost ceiling inside one run. Spend is recorded for review and
   never enforced.

## User Stories

1. As Chris, I want to declare a seat in one markdown file, so that a role brief
   reads as prose and not as a YAML block scalar.
2. As Chris, I want `aleph team` to render the roster and its approval edges, so
   that a topology spread over several files is still legible at once.
3. As Chris, I want `aleph team lint` to refuse a roster where a seat has no
   approver but itself, so that two-key cannot silently become one key.
4. As Chris, I want an unknown seat name refused, so that a typo never starts
   work under a role that does not exist.
5. As the lead, I want `aleph send <seat> "<message>"` to reach a named seat, so
   that I address a colleague and not a run.
6. As the lead, I want a message to a running seat to wait in its inbox instead
   of starting a second run, so that a seat's transcript stays linear.
7. As a seat, I want my unread messages in the prompt of my next wake, so that I
   answer everything that arrived while I was not running.
8. As Chris, I want a message on its own to create no work, so that a question
   and an assignment are different things.
9. As Chris, I want a heartbeat to be a timed message, so that scheduling adds
   no second mechanism to reason about.
10. As Chris, I want a seat's wakes per hour capped, so that two seats cannot
    ping-pong through my rate limit.
11. As Chris, I want a run stopped when its cost passes the seat's ceiling, so
    that one long run cannot take the window I am working in.
12. As Chris, I want every run's cost recorded against its seat and its item, so
    that a performance review reads real numbers.
13. As a seat, I want a fresh context for each item, forked from my seed
    session, so that I never work in a compacted window.
14. As a seat, I want the item's own session resumed on my next wake, so that I
    carry what I learned across wakes of the same item.
15. As a seat, I want my brief, my vault scope and the repo's own files in that
    context, so that I need no per-repo configuration.
16. As Chris, I want `aleph todo` to carry an owner, so that the to-do list is
    the queue and I keep one tracker.
17. As Chris, I want a rig-level list for work that no single repo owns, so that
    a change across `aleph` and `sidetone` still has a home.
18. As a seat, I want `aleph todo hand` to close my ownership and open theirs in
    one write, so that nothing strands between seats.
19. As Chris, I want `aleph todo` to take a lock and write through a temporary
    name, so that two seats writing at once cannot lose an item.
20. As a seat, I want the item's worktree to persist between my wakes, so that
    half-finished work survives.
21. As Chris, I want a closed item's worktree removed, so that worktrees do not
    accumulate for every item ever opened.
22. As Chris, I want `aleph todo lint` to report a worktree with no live item,
    so that a reaper failure is visible.
23. As a seat, I want my `git push` and `gh` calls to fail, so that only a land
    moves the remote `main`.
24. As Chris, I want `aleph approve` refused on a seat's own item, so that no
    agent ships its own diff.
25. As Chris, I want `aleph land` refused without an approval, so that two-key
    is a rule and not a convention.
26. As Chris, I want a `manual:` path to still wait for me after an approval, so
    that an untested Android change cannot land on an agent's word.
27. As Chris, I want the approver's name recorded with the land, so that a bad
    land has a name on it.
28. As Chris, I want the branch tip, merge-base and net patch-id recorded when a
    run passes, so that no further job becomes unresolvable.
29. As Chris, I want `aleph reconcile` to derive whether work reached `main`, so
    that "anything unlanded?" gets a right answer without a manual `git log`.
30. As Chris, I want `aleph jobs` to show a fate beside the run state, so that a
    landed run does not read as failed.
31. As Chris, I want a land to leave the main checkout clean, so that the next
    land still fast-forwards.
32. As a seat, I want to propose a durable fact rather than write it, so that
    the vault stays a thing a human corrects.
33. As Chris, I want a proposal accepted by a seat other than the one that wrote
    it, so that memory follows the same rule as code.
34. As Chris, I want a vault note to carry the seat that wrote it, stamped by
    the command and not by the note body, so that authorship cannot be claimed.
35. As a seat, I want to write only inside my own vault scope, so that one seat
    cannot rewrite another's notes.
36. As a seat, I want to read the whole vault, so that I learn what other seats
    found.
37. As Chris, I want a superseded note out of the retrieval path, so that a
    stale claim never sits beside its replacement.
38. As Chris, I want `claude plugin eval` to score a skill or a brief against a
    no-plugin arm, so that a brief change has a measured delta.
39. As Chris, I want a seat's record queryable — items owned, landed, reverted,
    approvals given, approvals that preceded a revert, cost per item — so that a
    performance review is a query and not an impression.
40. As Chris, I want the vault's admission rate reported, so that I can see
    whether the gate rejects anything.
41. As Chris, I want a seat's question to reach me as news, so that I answer
    without polling.
42. As Chris, I want news that arrived while Sidetone was down, so that nothing
    is lost.
43. As Chris, I want `aleph seats` to show each seat's wakes, remaining budget
    and spend, so that I can see the team's state in one command.
44. As Chris, I want the SQLite file to be rebuildable or losable without losing
    work, so that the store is never a single point of failure.

## Acceptance Criteria

1. WHEN `~/.aleph/team/<seat>.md` holds frontmatter `seat model session approves
   scope wakes ceiling` and a prose body THE system SHALL load it as a seat
   whose address is the file stem.
2. WHEN `aleph team` runs THE system SHALL print one row per seat with its
   model, its vault scope and the seats it may approve, and an edge list.
3. IF a seat's only possible approver is itself THEN `aleph team lint` SHALL
   exit 1 and name that seat.
4. IF a command names a seat with no file THEN THE system SHALL exit 1 with
   `no seat <name>; the roster holds: <names>` and start no run.
5. WHEN `aleph send <seat> "<text>"` runs and the seat is idle THE system SHALL
   record a `message` event and start one run for that seat.
6. WHILE a seat has a live run `aleph send` SHALL record the `message` event,
   start no second run, and exit 0 reporting the run it joined.
7. WHEN a seat wakes THE prompt SHALL contain every `message` event for that
   seat recorded since its last wake, oldest first.
8. WHEN `aleph send` completes THE system SHALL create no to-do item.
9. WHEN a systemd timer fires for a seat THE system SHALL run `aleph send
   <seat> "check your queue"` and nothing else.
10. IF a seat's `wake` events in the last hour equal its `wakes` limit THEN
    `aleph send` SHALL record the message, start no run, and exit 0 reporting
    the budget.
11. WHILE a run's summed `total_cost_usd` exceeds the seat's `ceiling` THE unit
    SHALL terminate the worker, write state `stopped` and reason `ceiling`.
12. WHEN a run ends THE system SHALL record a `cost` event carrying the run,
    seat, repo, item and the result event's `total_cost_usd`.
13. WHEN a seat takes an item with no recorded session THE system SHALL start
    the worker with `--resume <seed> --fork-session` and record the new session
    id against the item.
14. WHEN a seat wakes on an item that has a recorded session THE system SHALL
    start the worker with `--resume <that session>`.
15. WHEN a worker starts THE prompt SHALL contain the seat's brief, the output
    of `vault recall --scope <its scope>`, and the item's notes.
16. WHEN `aleph todo add <repo> "<title>" --owner <seat>` runs THE item's
    frontmatter SHALL carry `owner: <seat>`, and `aleph todo list <repo> --owner
    <seat>` SHALL return it.
17. WHEN `<repo>` is `rig` THE system SHALL read and write
    `~/.aleph/team/todo.md` and SHALL NOT require a registry entry.
18. WHEN `aleph todo hand <repo> <id> <seat>` runs THE system SHALL set the
    owner and append one note naming both seats in a single write, and the
    worktree path SHALL NOT change.
19. WHEN two `aleph todo note` processes run concurrently on one repo THE
    resulting file SHALL contain both notes.
20. WHEN a seat wakes twice on one item THE second wake's worktree SHALL be the
    same directory, with the first wake's uncommitted changes present.
21. WHEN an item's status becomes `done` or `dropped` THE system SHALL remove
    its worktree and delete its branch.
22. IF `.worktrees/<id>-<slug>` exists and no item `<id>` is open THEN `aleph
    todo lint` SHALL report it and exit 1.
23. WHEN a seat's worker runs `git push` or `gh` THE call SHALL fail, and the
    host the worker reached SHALL NOT be the real remote.
24. IF the approving seat is the item's owner THEN `aleph approve` SHALL exit 1
    with `a seat cannot approve its own item` and record no event.
25. IF no `approval` event exists for an item THEN `aleph land` SHALL exit 1
    with `<repo>/<id> has no approval` and SHALL NOT touch the remote.
26. IF a changed path matches a `manual:` rule THEN `aleph land` SHALL stop
    after the checks, say what to look at, and leave the item landable.
27. WHEN a land succeeds THE commit message SHALL carry `Approved-By: <seat>`
    and the system SHALL record a `land` event naming the approver.
28. WHEN a run's checks pass THE system SHALL record an `evidence` row holding
    the repo, item, run, branch, tip sha, merge-base sha and the branch's net
    diff patch-id.
29. WHEN `aleph reconcile <repo>` runs THE system SHALL report, for each item
    with evidence and no `land` event, whether its patch-id appears in `main`'s
    history, and SHALL NOT change `docs/todo.md`.
30. WHEN `aleph jobs` runs THE output SHALL carry a `fate` column beside
    `state`, and a run whose work reconcile found in `main` SHALL read `landed`
    whatever its state.
31. WHEN `aleph land` completes THE main checkout SHALL have no modified files.
32. WHEN a seat runs `vault write --propose --as <seat>` THE note SHALL be
    written under `proposals/`, SHALL NOT appear in `vault recall`, and SHALL
    record a `propose` event.
33. IF the accepting seat is the proposing seat THEN `vault accept` SHALL exit 1
    and the note SHALL stay under `proposals/`.
34. WHEN `vault write` or `vault accept` runs THE note's frontmatter SHALL carry
    `written_by` set by the command, and any `written_by` in the submitted body
    SHALL be replaced.
35. IF a seat writes a note whose `scope` is not its own scope THEN the write
    SHALL be refused and name both scopes.
36. WHEN a seat runs `vault recall` with no `--scope` THE result SHALL include
    notes of every scope.
37. WHEN a write supersedes a note THE superseded note SHALL move to `archive/`
    and SHALL NOT appear in any `vault recall` result.
38. WHEN `claude plugin eval --ablation with-without` runs against the aleph
    plugin THE report SHALL carry a score for the with arm, the without arm and
    the delta.
39. WHEN `aleph seats --review <seat>` runs THE output SHALL carry items owned,
    items landed, reverts of its landed work, approvals given, approvals that
    preceded a revert, and mean cost per item, each derived from events.
40. WHEN `aleph seats --review` runs THE output SHALL carry the count of
    proposals made and the count accepted.
41. WHEN a seat's run ends with a question THE system SHALL POST one line to
    Sidetone `/tell` naming the seat, the item and the question.
42. IF Sidetone refuses the POST THEN THE system SHALL leave the news unsent and
    the next successful `/tell` SHALL carry it.
43. WHEN `aleph seats` runs THE output SHALL carry, per seat, its live run if
    any, its wakes in the last hour against its limit, and its spend today.
44. WHEN `~/.aleph/aleph.db` is deleted and `aleph jobs`, `aleph todo list` and
    `aleph land` run THE system SHALL work, and only event-derived reports SHALL
    be empty.

## Implementation Decisions

**The seat file.** One markdown file per seat at `~/.aleph/team/<seat>.md`,
`ALEPH_TEAM` overriding the directory. Frontmatter carries `seat`, `model`,
`session` (the seed session uuid), `approves` (a list of seat names), `scope`
(its vault scope), `wakes` (per hour) and `ceiling` (USD per run). `repos` is
optional; absent means every registered repo. The body is the role brief and
goes into the worker's prompt verbatim. The format follows `SKILL.md`, the vault
note and the to-do item, which are the three markdown-plus-frontmatter formats
aleph already parses.

**The seed session.** `session` is a uuid the roster assigns, not one Claude
generates: `claude --session-id <uuid>` takes it. A seat's first run against an
item forks it with `--resume <seed> --fork-session`; later wakes of that item
resume the item's own session. The seat's seed session is briefed once and never
worked in, so a fork always starts from the same prefix.

**The store.** `bun:sqlite`, one file at `~/.aleph/aleph.db`, `ALEPH_DB`
overriding it. No daemon, no port, no native module. Two tables.

```
event(id INTEGER PRIMARY KEY, at TEXT, kind TEXT, seat TEXT,
      repo TEXT, item INTEGER, run TEXT, data TEXT)
evidence(repo TEXT, item INTEGER, run TEXT, branch TEXT,
         tip TEXT, merge_base TEXT, patch_id TEXT, at TEXT,
         PRIMARY KEY (repo, item, run))
```

`event` is append-only: no row is ever updated or deleted. Kinds are `message`,
`wake`, `cost`, `approval`, `land`, `revert`, `check`, `propose`, `accept`,
`eval`. `evidence` is written once per run whose checks pass and is the only
input `reconcile` needs.

**Three truths, strictly.** `docs/todo.md` owns the item, including its status
and owner. Git owns the fate of code. `event` and `evidence` own what happened
once. No fact is in two places, because a mirror is what produced the 73-run
drift. Fate is never stored; `reconcile` computes it and prints it, and does not
write to `docs/todo.md`.

**Locks stay files.** The interview sketched leases in SQLite. The existing
`lock()` in `jobs/lib/ledger.ts` is proven and tested, so it keeps dispatch and
per-job locking, and `todo` gains the same lock plus a write to a temporary name
and a rename. Adding a second locking mechanism would put liveness in two
places, which is the rule this spec exists to hold.

**Wake and budget.** `aleph send <seat> "<text>"` records a `message` event and,
if the seat has no live run and its `wake` events in the last hour are under its
limit, starts one. A heartbeat is a systemd timer running `aleph send <seat>
"check your queue"`. `aleph wake <seat>` is not a separate command. The budget
reads `event`, so a test seeds rows with chosen timestamps instead of sleeping.

**Cost kill.** The unit already streams the worker's `stream-json` to
`output.log`. It sums `total_cost_usd` as it reads, and terminates the worker
when the sum passes the seat's `ceiling`, writing state `stopped` and reason
`ceiling`. The mean run costs $1.52 and the largest cost $11.54, so the ceiling
binds inside a run, which is where the variance is.

**Two-key.** `aleph approve <repo> <id> --as <seat>` records an `approval` event
and refuses when the approving seat owns the item. `aleph land` refuses without
an approval, and `manual:` still stops a land after the checks. The land commit
carries `Approved-By: <seat>`.

**Vault two-key.** `vault write --propose --as <seat>` writes under
`proposals/`, which `recall` and `lint` skip as `archive/` is skipped today.
`vault accept "<title>" --as <seat>` refuses the proposing seat, then performs
the ordinary write, so every existing refusal — schema, duplicate, dangling
link, folder, budget, template — applies at acceptance and not before.
`written_by` is stamped by the command and any value in the submitted body is
replaced, so a note cannot claim an author. A seat writes only inside its own
`scope` and reads every scope.

**Landing evidence.** A run whose checks pass writes an `evidence` row before
anything else can delete the branch. The patch-id is the branch's **net diff**
against its merge-base, not a per-commit id: `git cherry` marks both commits of
a squashed branch as unlanded, and the net diff matches a squash exactly. Tree
equality fails once `main` moves, so `reconcile` uses `git merge-tree
--write-tree` where a patch-id match is absent.

**The main checkout.** A land writes the linked item's status through a
projection hash: the command records the sha256 of the file it wrote, and a
later land that finds a different hash reports an operator edit instead of
overwriting it. This is the only mechanism found in the field for telling a
human edit from a stale projection, and it is what item 7 needs.

**Rejected alternatives.**

| Alternative | Reason |
| --- | --- |
| Live tmux sessions as seats, terminal as the wire | forces a daemon, screen capture, a typing guard, session adoption and a TUI; every one of those is downstream of the choice |
| Adopting OpenRig | its own runtime needs Node 22 or 24 and calls Node 26 and WSL2 untested; it also duplicates `aleph job` |
| A separate rig queue beside `docs/todo.md` | a third tracker whose items mirror to-dos and go stale |
| The job ledger as the queue | a job is one run; work across four wakes would have four records and no single one |
| A rig per repo | three rosters for one person, and a cross-repo change would own nowhere |
| One endless transcript per seat | the context gate already ends a session at its first compaction |
| Rolling a seat's session at a context threshold | the reset lands mid-work and the handoff is written under context pressure |
| The vault as a seat's working memory | 202 notes, `Home.md` at 95 of a 150-line budget, no note ever deleted; per-item notes belong to the item |
| Seats writing to the vault unmediated | mem0's own 32-day audit found 224 clean entries of 10,134 |
| A monthly USD budget per seat | the subscription is not billed per token, and the variance is inside a run |
| Per-seat permission modes | recreates the case where an agent judges its own work |
| A bidirectional markdown-to-SQLite mirror | the one published attempt silently discarded hand edits and was removed |
| Dolt as the store | real merge semantics, but a far larger dependency than a `bun:sqlite` file |
| Seats declared as skills | a skill is a procedure the lead invokes; a seat is a colleague with a queue |
| A seat eval corpus | weak transfer to a forty-minute task against a real repo; outcome data first |
| A clock seam for the wake budget | the budget reads timestamped rows, so a test needs no clock |

## Testing Decisions

A good test here drives `aleph` or `vault` as a process and asserts on files,
git state and the store — never on a function's internals. No test sleeps: the
wake budget and the cost kill are both driven by data the test writes.

| Seam | Covers | How | Prior art |
| --- | --- | --- | --- |
| `aleph` as a process | 1–31, 39, 40, 43, 44 | the existing temp repo, remote and fake worker, plus `ALEPH_TEAM` and `ALEPH_DB` | `jobs/cli.test.ts` |
| the fake worker's output | 11, 12 | it emits `stream-json` whose `total_cost_usd` rises past the ceiling | `ALEPH_WORKER_CMD` in `jobs/cli.test.ts` |
| the event table | 10 | the test inserts `wake` rows with chosen timestamps, then asserts the refusal | none; new |
| the push and `gh` block | 23 | `GIT_SSH_COMMAND` pointed at a script that records its host argument and exits 1 | `jobs/cli.test.ts` |
| two concurrent processes | 19 | two `aleph todo note` spawns on one repo, both notes present after | none; new |
| `vault/cli.ts` as a process | 32–37 | `ALEPH_VAULT` at a temp vault | `vault/cli.test.ts` |
| Sidetone `/tell` | 41, 42 | the fake `/tell` server already in the job tests, plus one that refuses | `jobs/cli.test.ts`, Sidetone's route tests |
| `claude plugin eval` | 38 | one case under `evals/` with a grader, run in CI against the plugin | none; new |

Criterion 44 is tested by deleting the database file between two process runs
and asserting the second still lands work.

## Out of Scope

- A daemon, an HTTP API, a TUI or any live view.
- Agent-to-agent messaging that does not go through `aleph send`.
- Seats on another machine, or any multi-user concept.
- Retiring the 73 already-drifted runs. Their branches are gone and no evidence
  was recorded, so they are unresolvable; `reconcile` will report them as
  unknown and they stay that way.
- Replacing `aleph job` and `aleph run`. A one-shot job stays useful and keeps
  working unchanged.
- Cross-provider runtimes. The worker is `claude`.
- Migrating `docs/todo.md` into the database.
- A seat eval corpus.

## Open Questions

| Question | What unblocks it |
| --- | --- |
| What does a seat do when `reconcile` reports its item landed by another path? | one real occurrence after `evidence` ships |
| Does a seat need `vault recall` of scopes other than its own in the prompt, or only on demand? | the first seat's cost per wake, measured |
| How large may a seat's brief be before the fork stops being cheap? | measure the fork's cached prefix against a cold start |
| Should `reconcile` run on a timer or only on demand? | whether `aleph jobs` with a derived fate is fast enough to compute per call |
| Does the reviewer seat need its own to-do items, or only approvals? | a week of real use |

## Further Notes

Build order. Stage 1 stops evidence being lost and is worth landing before
anything else is designed further.

| # | Stage | Content | Done when |
| --- | --- | --- | --- |
| 1 | stop the bleeding | items 3, 4, 5, 14 | `evidence` is written on every pass; `todo` locks and renames; `land()` guards a missing worktree; conflicted paths are captured before the abort |
| 2 | foundation | the two tables, `aleph team`, `aleph team lint`, the roster loader | `team lint` refuses a roster with no valid approver |
| 3 | seats | `send`, wake, inbox, fork per item, worktree per item and its reaper, wake budget, cost kill | two seats take, hand and finish an item without the lead touching a worktree |
| 4 | two-key | `approve`, land gating, `--propose` and `accept` in the vault, `written_by` | a land without an approval is refused and a self-approval is refused |
| 5 | reconcile | items 1, 2, 7 — derived fate, the `fate` column, the projection hash | "anything unlanded?" is right without a manual `git log` |

Surveys behind this spec, both run 2026-09-29: eighteen agentic-coding harnesses
on state storage, and thirteen agent memory systems on growth and partitioning.
Their two load-bearing results are that no project maintains a bidirectional
markdown-to-database mirror successfully, and that automatic memory extraction
without an admission gate produces almost entirely noise. The numbers quoted
above from outside this repo come from those surveys and were not measured here.
The numbers in the Problem Statement were measured here on 2026-09-29.
