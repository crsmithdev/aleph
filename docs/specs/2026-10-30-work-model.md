# Work model: Issue, Goal, Run, awaiting

## Problem Statement

Chris reads aleph through words that mean two or three things. One object is called an issue, an item and a todo. "Waits for Chris" has four names: the `needs-chris` label, the `needs-you` run state, the Needs you list and `attention`. `waiting_on` means both "runs after" and "is made of". Four types are called `Verdict`. The ledger lives in `~/.aleph/jobs` and the sandbox folders in `~/.aleph/runs`. Three functions compute an issue's status, and they disagree.

Two failures come from this. Triage rewrites the body of an issue into the goal format, so Chris's own words are lost. A planner's parent goal waits on its children through `waiting_on` and a label, so a dropped child leaves the parent open for ever, and nothing tells Chris.

## Solution

One name for each thing, the same in the code, on disk, in the CLI and in the UI:

- An **Issue** is what Chris (or a worker, the deps check or the correction memory) asks for, kept as written.
- Triage or the planner makes one or more **Goals** from it. A goal is numbered under its issue: `aleph-577.1`. A Goal never has parts. An Issue never has build runs.
- A **Run** is one attempt on a goal (build, land, recheck, facts) or on an issue (triage, plan). The runs of one goal are its **Job**.
- When something waits for Chris, it is **awaiting** input or approval, and an **Ask** holds the question and its options.
- An **Always rule** answers an Ask by its reason, without Chris.
- `after` lists the goals a goal runs after. `issue` and `goals` link a goal and its issue.
- One function, `stage()`, computes the stage of every issue and goal. The CLI, Incoming, the lanes and `aleph status` all read it.

The design was drawn in the "Aleph Work Model" page (https://claude.ai/artifact/FtPvQP3335AAmFwNgmeTQt) and checked against other factories (vault: "Agent Factories Keep The Input And Put States On The Session"). All existing data is migrated, and no old number changes.

## User Stories

1. As Chris, I want my request kept as I wrote it, so that I can check a goal's oracle against what I asked.
2. As Chris, I want one name for each object everywhere, so that the CLI, the UI and the code mean the same thing.
3. As Chris, I want a large issue split into goals numbered under it, so that I can see at a glance which goals belong to which request.
4. As Chris, I want a small issue to get exactly one goal without a planner run, so that small work stays fast.
5. As Chris, I want one "Awaiting you" list that says whether each Ask needs my input or my approval, so that I know what kind of answer each one takes.
6. As Chris, I want an issue whose goal was dropped to await my input, so that it does not stay open for ever.
7. As Chris, I want the Always button to write an Always rule named for the reason, so that I can see and undo what I granted.
8. As Chris, I want one stage for each issue and goal, the same in the CLI and the UI, so that the two never disagree.
9. As Chris, I want every old issue, run and grant migrated, so that history reads in the new names.
10. As Chris, I want old numbers, commit trailers, specs and vault notes to keep resolving, so that no reference breaks.
11. As the factory, I want to dispatch goals only, so that a build run always has a goal with an oracle.
12. As the factory, I want `after` to mean order only, so that a dependency list never holds a decomposition.
13. As the factory, I want the ledger in `~/.aleph/runs` and the sandboxes in `~/.aleph/sandbox`, so that "run" names one thing on disk.
14. As Claude in the chat, I want to file a ready goal for Chris in one command, so that I do not need a triage run for work already in goal format.
15. As a worker, I want my `FOLLOWUP:` lines to become issues with source `worker`, so that follow-ups go through triage like any other issue.
16. As the triage step, I want my verdict to be a route (goal, close, done, ask), so that its name does not clash with the review's call.
17. As the reviewer, I want my verdict to be a call (land, back, ask), so that its name does not clash with triage.
18. As Chris, I want `aleph issue lint` to refuse the old fields and labels after the migration, so that old names do not come back.
19. As Chris, I want the README, the skills, my global CLAUDE.md and the vault's current-state notes to use the new names, so that agents learn the right words.
20. As Chris, I want the migration to back up the store and the ledger first and to run with the factory paused, so that I can undo it.

## Acceptance Criteria

1. WHEN an issue is filed with a body THE store SHALL keep that body under `## Request` word for word, apart from whitespace and the spelling and grammar fixes of aleph-617; WHEN triage or the planner writes a goal THE `## Request` text of the issue SHALL be unchanged.
2. WHEN `grep -rE` runs over `jobs/ todo/ ui/ hooks/ skills/ bin/ README.md identity/` for `needs-chris|needs-you|waiting_on|waitingOn|review2|standing\.json|\battention\b|ALEPH_ITEMS|ALEPH_WAITING_CAP` after the last goal lands THE result SHALL hold only the migration module, its tests and the legacy readers named in Implementation Decisions.
3. WHEN the plan run splits issue `aleph-N` into k goals THE store SHALL hold `aleph-N.1` to `aleph-N.k`, each with `kind: goal` and `issue: aleph-N`, and the issue SHALL hold `goals: [aleph-N.1, …, aleph-N.k]`, in one commit.
4. WHEN triage routes issue `aleph-N` to `goal` THE store SHALL hold one goal `aleph-N.1`, and no plan run SHALL start for the issue.
5. WHEN any run, issue or goal waits for Chris THE `/api/state` field `asks` SHALL hold one entry for it with `kind` `input` or `approval` and a `reason` from the reason list; THE Status page SHALL show it under "Awaiting you" with that kind.
6. WHEN a goal of an open issue is dropped and no other goal of the issue is open THE issue's stage SHALL be `awaiting` with an Ask of reason `part-dropped` and the options "Close with what landed" and "Plan the missing part".
7. WHEN Chris presses the Always button on an Ask with reason R THE file `~/.aleph/factory/always.json` SHALL map R to `{ action, at }`, and the next Ask with reason R SHALL take that action without appearing in `asks`.
8. WHEN `aleph status <id>`, the Incoming list and the lanes report the same issue or goal THE three SHALL show the same stage, read from `stage()`.
9. WHEN `aleph migrate --apply` finishes THE store SHALL hold no item with a `goal`, `needs-chris`, `planned`, `followup`, `triaged`, `live-check` or `proposal` label or a `waiting_on` field, THE ledger SHALL hold no run with `todo`, `needs` or state `needs-you`, and `aleph issue lint` SHALL exit 0 for every repo.
10. WHEN `aleph migrate --dry-run` runs on a copy of the real `~/.aleph` THE report SHALL list, for every old item, its old status (from today's `itemStatus`) and its new stage, and every pair SHALL match the mapping table in Implementation Decisions; any other pair SHALL fail the dry run with exit 1.
11. WHEN the migration runs THE numbers of all existing items SHALL be unchanged, and `aleph status aleph-578` SHALL still find the item, its runs and its `Item:` commit.
12. WHILE a goal's `after` list names an open goal THE goal's stage SHALL be `blocked` and dispatch SHALL not start it; WHEN an issue has `goals` THE issue SHALL never appear in any goal's `after` list.
13. WHEN the migration finishes THE ledger SHALL be in `~/.aleph/runs/`, the sandbox folders in `~/.aleph/sandbox/`, the store in `~/.aleph/issues/`, and no code path SHALL read `~/.aleph/jobs` or `~/.aleph/items`.
14. WHEN Claude runs `aleph issue add aleph "<title>" --goal -` with a goal-format body THE store SHALL hold the issue and its goal `.1` in one commit, the goal SHALL be `queued` (or `blocked` with `--after`), and no triage run SHALL start.
15. WHEN a worker's result holds a `FOLLOWUP:` line THE store SHALL hold a new issue with `source: worker` and stage `new`.
16. WHEN triage ends THE triage run SHALL record `route` with one of `goal`, `close`, `done`, `ask`; the old `live` route SHALL be an `ask` with reason `host-check`.
17. WHEN the reviewer ends THE run SHALL record `review.call` with one of `land`, `back`, `ask`.
18. IF an issue or goal file holds a label from the list in criterion 9, or a `waiting_on` field, THEN `aleph issue lint` SHALL exit 1 and name the file and the field.
19. WHEN the last goal of this spec lands THE README, every skill under `skills/`, `identity/CLAUDE.md` and the vault notes of kind decision, concept and gotcha that describe current behaviour SHALL use the new names; episode notes SHALL be unchanged.
20. WHEN `aleph migrate --apply` starts IF the factory is not paused or a run is live THEN it SHALL refuse with exit 1; WHEN it runs THE command SHALL first write `~/.aleph/backups/<time>-migrate/` with the store, the ledger state files, `standing.json` and `caps.json`, and `aleph migrate --undo <time>` SHALL restore them.

## Implementation Decisions

### What this spec treats as fixed

The factory flow (triage, dispatch, build, checks, review, land, facts), the gates and caps, the sandbox, the correction memory's signals and lessons, Backlog.md as the file format, the store as a git repo whose `origin/main` is the record, and the `/api/*` endpoints' paths. Only field names, file names, labels, states and the issue-to-goal link change.

### Objects

```text
Issue   <store>/<repo>/backlog/tasks/<repo>-<n>.md
  id, title, repo, created, updated, priority
  The store file holds created under the key created_date, because Backlog.md reads only that key.
  kind: issue
  source: chris | worker | deps | memory
  status: open | done | dropped           only stored state
  goals?: [<repo>-<n>.<k> | <old goal id>]
  areas: [ … ]                             the labels that remain
  ask?: Ask
  body: ## Request (as written), then notes

Goal    <store>/<repo>/backlog/tasks/<repo>-<n>.<k>.md   (old children keep <repo>-<m>.md)
  id, title, repo, created, updated, priority
  The store file holds created under the key created_date, because Backlog.md reads only that key.
  The store file holds updated under the key updated_date, because Backlog.md reads only that key.
  kind: goal
  issue: <repo>-<n>
  after: [<goal id>]
  status: open | done | dropped
  areas, ask?, body (Goal, Edit surface, Oracle, Time box), notes

Run     ~/.aleph/runs/<time>-<repo>-<id>-<kind>/state.json
  on: <goal id> | <issue id>
  kind: build | land | recheck | facts | firefighter | plain   (on a goal)
        triage | plan                                          (on an issue)
  state: running | passed | awaiting | stuck | failed | landed | dropped | done
  ask?: Ask, review?: { call: land | back | ask, reason }, … other fields unchanged

Ask     { kind: input | approval, reason, question, options[{label, line, after?}], recommended?, why[] }
  approval reasons: review, held-path, proposal
  input reasons:    question, manual, no-commit, part-dropped, triage-failed, host-check, rescue

Always  ~/.aleph/factory/always.json: reason → { action, at }
```

`Run.kind` `agent` becomes `build`. A `plain` run (a job started by hand) also needs a goal: `aleph run` files an issue and its `.1` goal for it.

### stage()

One module owns it; every reader calls it.

```text
goal.stage  = dropped | done                        from status
            | awaiting                              its ask, or its last run awaiting
            | stuck                                 last run stuck or failed
            | landing                               last run is a land, running
            | building                              last run open, not a land
            | planning                              a plan run is open
            | blocked                               an `after` goal not done
            | queued
issue.stage = dropped | done                        from status
            | awaiting                              its ask, or any goal awaiting
            | stuck                                 any goal stuck
            | building (n of m)                     it has goals
            | planning                              a plan run is open
            | triaged                               triage routed it, no goals yet
            | new
```

### Migration mapping (old status → new stage)

| Old `itemStatus` | New stage |
|---|---|
| untriaged | new |
| sorted | triaged |
| waiting on Chris | awaiting (Ask kind input, reason from the last `needs-chris` note: question, triage-failed or no-commit) |
| queued | queued, or blocked when the old `waiting_on` names an open item |
| building | building |
| landing | landing |
| needs you | awaiting (approval for held and review, input for question and manual) |
| stuck | stuck |
| landed (item still open) | landing |
| done, dropped | done, dropped |

### Migration rules

- **No old number changes.** An old item with "Part of aleph-N." in its body becomes a Goal with its old number and `issue: aleph-N`. An old item labelled `planned` becomes an Issue whose `goals` list is its old `waiting_on` list. An old goal-labelled item with no parent becomes an Issue with the same number plus a new Goal `.1` that takes its goal-format body; its runs get `on: <id>.1`. Its `## Request` holds the old body, because the original words are gone. An old item with no `goal` label becomes an Issue with no goals.
- **Labels become fields:** `goal` → kind as above; `followup` → `source: worker`; `deps` with `proposal` → `source: deps` and an Ask (approval, proposal); `memory` → `source: memory`; `needs-chris` → an Ask; `triaged` → stage triaged; `live-check` → an Ask (input, host-check); `planned` → `goals`. Every other label goes to `areas`. Items with no source label get `source: chris`.
- **The ledger:** `todo` → `on`, `needs` → `ask` (with `kind` as in the mapping), state `needs-you` → `awaiting`, kind `agent` → `build`, `review2` → `review`. The folder names keep their old job part, so old links still work.
- **Files:** `~/.aleph/runs` → `~/.aleph/sandbox` first, then `~/.aleph/jobs` → `~/.aleph/runs`, then `~/.aleph/items` → `~/.aleph/issues` (`ALEPH_ISSUES`, was `ALEPH_ITEMS`). `standing.json` → `always.json` with reasons renamed (held → held-path, triage-no-verdict → triage-failed, decision → question). `caps.json` key `waiting` → `awaiting` (`ALEPH_AWAITING_CAP`).
- **Store commit:** the migration writes the store as one commit on `origin/main`, so `git revert` of it undoes the store part.
- **Run by Claude on the host:** a factory worker cannot reach `~/.aleph`. Claude pauses the factory, waits for no live run, runs the dry run on a copy, checks the report, applies, checks `aleph issue lint`, and resumes.

### Commit trailers

New lands write `Issue: <issue id>` and `Goal: <goal id>`. Readers accept `Item:` as an issue reference for history. The trailer reader is the one legacy reader that stays after the contract step.

### CLI

- `aleph issue add|list|show|note|edit|done|drop|lint` works on issues. `add --goal -` also files goal `.1` from stdin; `--after <goal id>` sets its order.
- `aleph goal list|show|note|edit|drop|hidden` works on goals. Hidden checks move to `<store>/<repo>/hidden/<goal id>/`.
- `aleph todo` is removed.
- `aleph migrate --dry-run | --apply | --undo <time>` is new.

### API and UI

- `/api/state`: `attention`, `needs`, `needsIssues` and `waiting` become one `asks` list. `incoming` lists issues with `stage`. The lanes read `stage`. `standing` becomes `always`.
- Status: "Needs you" becomes "Awaiting you", with an input or approval mark on each card. An issue in Running shows its goals nested, with "n of m goals".
- The Issue page shows the `## Request`, then its goals, each with its Job.

### Renames in the code

| Old | New |
|---|---|
| `todos`, `Item`, `readTodo`, `todo` field | `issues`, `Issue` / `Goal`, `readIssues`, `on` |
| `Decision` | `Ask` |
| triage `Verdict` | `Route` |
| `Review2`, `review2` | `Review`, `review` |
| facts `Verdict` | `FactCheck` |
| unit `verdict` (the run result) | `outcome` |
| `standing`, `REASONS` | `always`, `ASK_REASONS` |
| `ItemState`, `derive`, `itemStatus` | `stage()` |
| `NEEDS_CHRIS`, `PLANNED`, `isChild` | removed |
| `jobsDir()` | `runsDir()`; the sandbox root is `sandboxDir()` |

### Order of work (expand, migrate, contract)

1. **Readers and stage():** the store and ledger readers accept the old and the new shape; `stage()` replaces the three status functions; behaviour on old data is unchanged. The readers own the layout: one function (`jobs/lib/layout.ts`) gives the store, ledger and sandbox paths, the new ones (`issues`, `runs`, `sandbox`) once `~/.aleph/issues` exists and the old ones (`items`, `jobs`, `runs`) before, and the env variables still win.
2. **The migrate command,** with dry run, apply, backup and undo, tested on fixtures.
3. **Host migration** by Claude (not a factory goal).
4. **Writers and the CLI:** triage, plan, dispatch, land, firefighter, review, Always rules and the CLI write the new shape only. Runs after aleph-617.
5. **API and UI.** Runs after aleph-618.
6. **Contract and docs:** remove the old-shape readers (apart from the trailer reader), make lint refuse old fields, and update the README, skills, `identity/CLAUDE.md` and the current-state vault notes.

Rejected: a big-bang rename in one goal (one diff over about 100 files, and the factory would run mixed code against mixed data); renumbering old children (breaks quoted numbers); a third Plan object between Issue and Goal (the plan run's record and the issue's notes already hold it).

## Testing Decisions

- Tests check behaviour at three seams and never import a module's internals:
  1. **The `aleph` CLI** against a fixture store and ledger: issue add, triage, plan, dispatch, land, status. Prior art: `jobs/cli.*.test.ts` with `jobs/cli.helpers.ts`, `todo/cli.test.ts`.
  2. **`/api/state`** built from the UI fixtures: `asks`, `incoming` stages, lanes. Prior art: `ui/state.test.ts`, `ui/fixtures/`.
  3. **`aleph migrate`** on a fixture store and ledger that hold one item of every old status and label, then as a dry run on a copy of the real `~/.aleph`, as in acceptance criterion 10.
- `stage()` gets a table test: one row per stage, for issues and for goals, built through the CLI seam.
- The dry run on the real data is a host check by Claude, recorded in the migration issue's notes with the report's counts.

## Out of Scope

- A plan approval step before a large issue's goals run (Jules, Factory.ai). It can be a later goal.
- Renaming "run" to "session".
- Rewriting vault episode notes, old specs or old commit messages.
- Changes to the correction memory's signals, Jev questions or mining.
- Moving off Backlog.md.

## Open Questions

- Does Backlog.md 1.55.3 accept a dotted id such as `aleph-577.1` in a file name and in `id:`? **Yes.** Checked against Backlog.md 1.55.3 (`bunx backlog.md@1.55.3 --version` printed `1.55.3`; no `backlog` binary on PATH). In a temporary project with `config()`'s `config.yml` (`task_prefix: "aleph"`) and `aleph-577.md` and `aleph-577.1.md` (`id: aleph-577.1`) shaped as `renderItem` writes them, `task list` lists `ALEPH-577.1`, `task view aleph-577.1` and `task 577.1` both open that file, and `task create` gives the next integer id (`ALEPH-578`), not a subtask of 577. Commands and output:

  ```text
  $ backlog task list --plain
  open:
    ALEPH-577 - Parent goal
    ALEPH-577.1 - Dotted child goal

  $ backlog task view aleph-577.1 --plain
  File: /tmp/backlog-dotted-vuQB/backlog/tasks/aleph-577.1.md

  Task ALEPH-577.1 - Dotted child goal
  ==================================================

  Status: ○ open
  Created:
  (description, acceptance criteria and definition of done: none defined)

  $ backlog task 577.1 --plain
  File: /tmp/backlog-dotted-vuQB/backlog/tasks/aleph-577.1.md

  Task ALEPH-577.1 - Dotted child goal
  (same output as task view aleph-577.1)

  $ backlog task create "next" --plain
  File: /tmp/backlog-dotted-vuQB/backlog/tasks/aleph-578 - next.md

  Task ALEPH-578 - next
  Status: ○ open
  Created: 2026-10-30 19:53 (UTC)

  $ backlog task list --plain
  open:
    ALEPH-577 - Parent goal
    ALEPH-577.1 - Dotted child goal
    ALEPH-578 - next
  ```

  The `Created:` line is blank for the hand-written files; this was not investigated and does not concern the id. Consequence: goals stay in `<store>/<repo>/backlog/tasks/` with dotted ids, so `backlog/goals/` is not needed. Backlog.md does not number a child from its parent, so aleph must allocate the dotted ids itself. `backlog browser` was not checked.
- Which current vault notes count as current-state notes for criterion 19? Unblocked by a `vault lint` pass in step 6 that lists notes of kind decision, concept and gotcha that use an old name.

## Further Notes

- This spec includes aleph-617 (short titles, the input kept as `## Request`) and aleph-618 (proposal buttons that name their change and target); both land first.
- aleph-338 (a `waiting_on` with two refs never started) is the kind of bug the `after` list and the issue-to-goal link remove.
