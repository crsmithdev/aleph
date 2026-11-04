# Aleph data model: clean slate (i12)

Chris's decisions, 31 Oct: this design, not the UI plan. Rename `Run.state`. Markdown store files. The Status page keeps its name.

Assumptions from Chris: history may be wiped, the factory may be paused for the change, and rebuilding history does not matter. Repo: /home/crsmi/aleph. Replaces: docs/specs/2026-10-30-work-model.md. Vault and Langfuse stay.

Six review rounds on earlier versions tried to replace the run ledger as well. Each replacement broke a real path in the factory's flow. Chris's only complaint that touches the ledger is the word `state`. So this version changes the work item and the words, and leaves the ledger's structure and the flow.

## Principles

1. There is one kind of work record: the Issue. "Goal" goes as a word and a record. This fully removes the split for small work, which is 89% of issues with goals. Large work (11%) keeps two roles, parent and part, on the one record, because a container is not built. The split remains there, by role.
2. An issue has a stage. A run has a condition, which is `Run.state` renamed, with the same eight values. `status` goes as a field. The word stays only as the name of the Status page and `aleph status`, which show the factory as a whole. The UI shows stage for an issue and, under the label Condition, condition only where a row stands for a run. Four values stay shared between stage and condition, and `Run.phase` stays as the step inside a running run.
3. The factory's decisions do not change. See "Flow".

## Store

The store's mechanism stays: one file per issue in a git repo, each write one commit on origin/main, with compare-and-swap over the list (`todo/lib/store.ts`), through `aleph issue`. The file stays Markdown with flat frontmatter, at today's path, and `backlog/config.yml` stays. Nothing but `aleph issue` writes it. The body has three parts, each opened by a marker line: `<!-- request -->`, `<!-- spec -->` and `<!-- notes -->`. The writer escapes a marker line that appears in text, so text cannot forge one. `aleph issue edit` takes the part it changes, `--request` or `--spec`, so an edit cannot erase another part. `--body` goes.

The run ledger stays as it is, apart from the rename of `state` to `condition`: `~/.aleph/runs/<run id>/state.json`, with its fields and values, including Job as the grouping of runs, with `Job:` trailers. A sandboxed worker reaches neither store. It reads the `refs/aleph/facts` snapshot, and files follow-ups through `FOLLOWUP:` and `FLAKE:` lines, as today.

## Issue

```markdown
---
id: aleph-910            # or aleph-910.1
title: ...
source: chris
priority: medium
areas: []
after: []
created: ...
updated: ...
plan: true
tracker: true
since: <commit>
closed_as: done          # or dropped
closed_why: ...
closed_at: ...
ask: input               # today's flat Ask keys: ask, reason, question, options, recommended, why
---
<!-- request -->
What was asked. Absent on a part the planner wrote.
<!-- spec -->
Markdown with today's goal sections, read by section() as today.
<!-- notes -->
- <stamp>: <text>
```

All but the identity, `title` and dates are optional. Only Chris rewrites `request`, through Edit. A part's parent comes from its id. Parts are one level, from the planner. `due` goes, because no store file sets it. Notes keep today's line format, including the leading `- `, because `acceptance.ts` and triage read them.

An issue with parts is never built, and its parts roll up; the page does not show a spec on such an issue. An issue is buildable if it has a spec, no parts, and neither `plan` nor `tracker`. So a small request is one record, one row and one page, and a large one is an issue with parts.

## Triage and plan

Triage's route, in its run's result, is one of: `close`, `done`, `ask`, `build`, `plan`. `build` writes the spec on the issue. It no longer files a `.1`. `plan` writes the spec and the parts in triage's own reply (`children`, the planner's JSON shape: 2 to 6, each with a title, a Goal, an Edit surface and an Oracle, and `waits_on` earlier children), so no planner run follows. The parts pass the planner's check (`checkChildren` in `plan.ts`), their titles go through the title writer, and they are filed in triage's write as the planner files them (`addParts`): the parent's spec is cleared, and each part waits on its earlier parts and on the issue's own `after`. If the parts fail the check, triage applies `build` instead: the issue keeps the spec, with a note that says why, and builds as one run. Triage no longer sets `plan`. An issue triage routed `build` or `plan` is never planned by `needsPlan`. A plan run (from "plan the rest", a time-box rescue, or `needsPlan` on an issue that did not go through triage) adds parts, in one write that clears `plan` and the spec. If planning fails `PLAN_TRIES` times, the same write clears `plan`, so the issue builds from its spec. `live` is `ask` with reason `live`. `flake` is `close` with a reason, plus its tracker write. A repeated no-commit run on an issue asks Chris, as for a goal today, so the code that tests `plain` at `factory.ts:762,829,852` follows the goal branch and its triage rescue goes. `needsPlan` and `isLarge` (`plan.ts`) stay and run where they run today, on an issue that did not go through triage, such as one filed with a spec. `isLarge` does not count `docs/`, `acceptance/`, test folders or test files as a second folder. When they say plan, they set `plan`. Dispatch starts a plan run for an issue with `plan` set, no open plan run and every `after` done, using `notReady` as it does before a build (`factory.ts:405,419`). Every path where the planner refuses or returns with no parts (`plan.ts:188,189,283,294`) clears `plan` in its write, so the flag cannot stick; the issue builds from its spec, or goes back to triage if it has none and no parts. On a parent with parts, `plan` means "plan the rest": the planner's prompt lists the existing parts, one new part is enough, new parts follow the old ones, `badPlans` counts only since `plan` was set, and a failure fills the Ask slot with `part-dropped` again.

## Flow

`unit.ts`, `gate.ts`, `review.ts`, `acceptance.ts`, `firefighter.ts`, `transitions.ts` and the dispatch in `factory.ts` keep their decisions and their order of writes: the run first, then the store. A run's `on` names an issue, which may be a part. The changes are only these:

- **Dispatch** selects buildable issues, where it selects goals today.
- **Land** writes `Issue: <repo>-<id>` for the issue it built, which may be a part, and `Job:` as today. It does not write a `Goal:` trailer. `landedIndex`, `commitsNaming` and `itemOnMain` all read `Issue:` by the full id, so `910.1` and `910.2` do not collide, and a part's commit does not name its parent. `dottedOnMain` and the filter of dotted ids in `repoStages` (`status.ts:155`) go, so dispatch's `done()` agrees with stage on a part. `ui/state.ts:188-192` shows the new trailers. Older `Item:` and `Goal:` trailers are before every `since`, so nothing reads them.
- **`closeIssues`** still closes a parent on dispatch, when every part is done or dropped, at least one is done, its Ask slot is empty and `plan` is not set. `done` counts a part's trailer. This changes `factory.ts:486`, where a dropped part keeps the parent open with no Ask when the drop was not the last. The write that drops the last open part fills the parent's Ask slot with `part-dropped` once, as today (`store.ts:383-408`), so Chris decides. The Ask's answer closes the parent, or its "plan the rest" clears the slot and sets `plan`. When new parts finish, the rule closes the parent, because Chris already chose. An `after` on a dropped part stays `blocked`, as today, and `why` names the dropped part.
- **Reopen**, by Chris or acceptance: `closed` removed, `since` set to main's head, a note, and a closed parent reopened in the same write. A trailer counts for an issue only if its commit comes after `since`, which generalizes today's `since` in the acceptance record. `itemOnMain` and the guards in `transitions.ts` and `unit.ts` read `since` from the store's last fetched ref, with no fetch, so a GitHub failure cannot remove it. Every write comes from this machine and moves that ref. In a sandbox, `since` comes from the facts snapshot, passed to `landedIndex`. `commitsNaming` does not filter by `since`, because acceptance must see the earlier lands of a reopened issue (`acceptance.ts:153-157,320-335`). `reacceptReopened` (`factory.ts:570`) ignores `since`, because it acts on an item that acceptance reopened.
- **Revert** writes nothing to the store, as today. `closed` stays, so dispatch does not rebuild what Chris reverted, and stage discounts it as `stage.ts:72` does.
- **Ids in `after`:** `refs()` (`firefighter.ts:109`), `checkAfter` (`issues.ts:151`) and the wait action (`ui/api/actions.ts:82`) accept plain ids as well as dotted ids. An id not in the store is a closed item that was not copied: dispatch and stage both treat it as no blocker, through one function, and `checkAfter` refuses a new one. That function separates "list not read" from "id absent". A list not read blocks, as `doneChecker` does today (`factory.ts:186-190`).

An Ask stays where it is today: on the run that asked, or in the issue's slot.

## Stage

`stage(issue) = { stage, why }`, computed as today from the issue, its parts, its jobs and main's trailers. `why` includes the phase, such as "at land: a held path". The first match wins:

1. `dropped`, from `closed`. `done`, from `closed`, unless every trailer commit is reverted, or from a trailer past `since` that is not reverted.
2. `awaiting`: its slot, its last real run, or a part.
3. `stuck`: its last real run is stuck or failed, or a part is stuck.
4. `working`, with n of m: it has parts.
5. Among open jobs other than triage and plan runs, as `stage.ts:85` filters them: `landing` if the last real run is a land, otherwise `working`.
6. `blocked`: an `after` that is open and not done, as `stage.ts:105` tests it, so a reverted closed item blocks nothing. `closeIssues` likewise counts a closed, reverted part as done.
7. `planning`: `plan` is set or a plan run is open. `queued`: it has a spec.
8. `new`: otherwise, including a tracker and a triage run in progress, with `why` saying so. The Status page omits a tracker from its lanes.

`Subject` and `RunView` in `stage.ts` gain the fields these rules read, in the facts snapshot as well.

## UI

Inventory lists issues, and parts nest under them. The Issue page shows the request, the spec, parts if any, jobs, notes and commits; Edit edits the title, the request, the spec and the labels. The Status page keeps its name, and its lanes follow stage. A run's row shows its condition under Condition. Notes fold by their prefix.

## Change

Build and test step 3's branch, and the rewrite on a copy of the store, before step 1. Steps 1 to 4 then run as one script, with no other Claude session open, so no old code runs against the new store.

1. Stop the tick timer and `aleph-ui.service`, and end every open job: it lands or Chris drops it. A job names its old item, so none may stay open across step 2. Archive `~/.aleph/issues` and `~/.aleph/runs` as tars in `~/.aleph/backups`. Nothing is deleted until Chris says so. Runs stay, and the script renames `state` to `condition` in each `state.json`.
2. Rewrite the store's items in the new form. Each open item becomes an issue with its number, and `since` set to main's head. An only goal under an open issue becomes that issue's spec; two or more become parts, keeping their numbers. Closed issues are not copied. `after` entries that name a closed item go, and an entry that names an only goal is mapped to its issue. A flake tracker gets `tracker: true`. The script stops and reports an open issue whose goals are all closed, or an open goal under a closed issue, so that Chris closes or fixes it first. A store file in each repo's folder holds a floor for the repo and for each open issue's parts, and `nextId` and `nextSub` use the higher of the floor and the items present, so a new number, or a part number, is above every old one and inherits no old job or acceptance record.
3. Squash merge the branch to main, in the main checkout `bin/aleph` runs from. The branch changes `todo/lib/store.ts`, `todo/lib/todo.ts`, `jobs/lib/stage.ts`, `jobs/lib/status.ts`, the readers of `kind`, `goals`, `issue`, `status`, `labels`, `Run.state`, `ui/`, `skills/goal/SKILL.md` and `identity/CLAUDE.md`. `aleph goal` and `aleph migrate` (`jobs/lib/migrate.ts`) go, and `aleph goal hidden` becomes `aleph issue hidden`. The Intake of `ui/api/speed.ts` measures from the issue's filing commit to its first build run, because `build` no longer files a goal.
4. Start `aleph-ui.service` and the tick timer. A run that names an old closed item still shows on its own page, with no issue link.

## Costs

- One branch changes the Issue shape and its readers, built by hand while the factory is paused, since the factory runs on what it changes.
- Past issue pages start empty. Cost charts read runs, which stay, but some name items no longer in the store. Speed reads the store's log, so it starts over.
- A run keeps its eight values under the new name, and the rename reaches at most 123 reads in 23 files.
- `closed` and the Ask stay as flat frontmatter keys.
