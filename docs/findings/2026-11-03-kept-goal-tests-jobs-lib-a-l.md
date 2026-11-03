# Kept goal tests: jobs/lib, files a to l

Date: 2026-11-03. Scope: `jobs/lib/*.test.ts` whose base name starts with a to l.

## Method

- A goal-added case is a case whose first adding commit has a `Job:` trailer. The adding commit is the earlier of
  `git blame -w -C -C -M` on its `test(` line and the first `git log -S` hit of its title. The files hold 517 cases;
  358 are goal-added.
- Reason 1 (proven regression test). For each goal commit, the case's test file at the commit ran against the product
  code of the commit's parent; the cases of one commit ran together, under a scratch HOME with a git identity. A case
  counts when it passes at the commit and fails at the parent without a load error, and the commit fixes a bug. One
  case stays per bug, at the lowest layer.
- Reason 2 (only check of a product branch). Each case of these files ran alone under `bun test --coverage`; each other
  test file of the land suite ran with only its cases that are not goal-added. A greedy set cover then kept the fewest
  goal-added cases that cover every product line that nothing else covers, and swapped a case for one with a smaller
  coverage (a lower layer) when that one covers the same lines. Test helpers (`*.helpers.ts`, `*.testkit.ts`,
  `jobs/inproc.ts`, `tests/`) do not count. Lines that are only log text or report layout do not count:
  `jobs/lib/transitions.ts:99-100` (a warning line), `jobs/lib/ask.ts:230-232` (`askNote` wording),
  `jobs/lib/factory.ts:521-528,545-550,561-565` and `jobs/lib/factory-status.ts:406` (report lines).
- Reason 3 (wiring). The one test that runs a command through `jobs/cli.ts`.
- Check after the move: a coverage run of each land test file before and after. The land suite after the move covers
  every product line it covered before, except the excluded lines above and `jobs/lib/process.ts:22` (the `catch` of
  `pidOf` when a run folder has no `pid` file). Only the moved case "a stuck job holds the factory" in
  `factory.hold.test.ts` reached that line, through the file's case order. A unit test in `process.test.ts` can reach
  it without a product change, so the case moved.

## Limits

- Bun line coverage counts an unrun ternary arm as covered. A moved case that was the only one to run a ternary arm
  does not show in this check.
- 32 cases did not pass at their own commit in the scratch tree, so the revert check could not run for them. They
  went through the coverage check like the rest.
- Other test files lose goal-added cases in parallel audits. The coverage check counted only the cases of those files
  that are not goal-added, so it keeps a case here even when another file keeps a case for the same line.

## Kept cases

39 for reason 1, 59 for reason 2, 2 for reason 3: 100 of 358.

| File | Case | Reason | Evidence |
|---|---|---|---|
| `acceptance.cap.test.ts` | the fifth goal failing at one commit does not reopen, the fourth does, and a later commit reopens as usual | 2 | only check of `jobs/lib/acceptance.ts:254,284-290` |
| `acceptance.fail.test.ts` | an infra result leaves the issue done, writes no record and says acceptance not run | 1 | fails at `9fd990ce73` with the product code of its parent (acceptance: an infra error (the command did not start, bundle failed)...) |
| `acceptance.oracle.test.ts` | a run with exit 0 whose bun test summary reports failures fails; with 0 fail it passes | 1 | fails at `9f52fd47d4` with the product code of its parent (acceptance: run Oracle shell loops over bun checks, and fail a run who...) |
| `acceptance.oracle.test.ts` | a done goal whose Oracle command passes gets the pass note and stays done | 2 | only check of `jobs/lib/acceptance.ts:431-438` |
| `acceptance.parse.test.ts` | a placeholder of more than one word is not runnable; a redirection with a space is | 1 | fails at `2b37f50c2d` with the product code of its parent (acceptance: an Oracle placeholder of more than one word, such as <that...) |
| `acceptance.pin.test.ts` | a failure pinned to a file that lacks the test name reruns the Oracle's command and loses the pin | 1 | fails at `07c9243c90` with the product code of its parent (Acceptance: clear a pin whose file lacks the test...) |
| `acceptance.reaccept.test.ts` | reacceptReopened closes the goal whose Oracle passes and leaves the failing one open with a note | 2 | only check of `jobs/lib/acceptance.ts:487-488` |
| `acceptance.reaccept.test.ts` | reacceptReopened leaves the goal open after an infra error, notes the tail, and retries next time | 2 | only check of `jobs/lib/acceptance.ts:482-483` |
| `acceptance.reaccept.test.ts` | reacceptReopened skips goals not landed, not reopened by acceptance, or outside the window | 2 | only check of `jobs/lib/factory.ts:339-340` |
| `acceptance.retest.test.ts` | a failure pinned to the wrong file does not reopen the goal when the original command passes | 1 | fails at `910df0a297` with the product code of its parent (Acceptance: check untouched repeats against the goal's parent, rerun t...) |
| `acceptance.scenario.test.ts` | a failed scenario reopens by number only; a second fail asks Chris | 2 | only check of `jobs/lib/acceptance.ts:298-300,373-374` |
| `acceptance.skip.test.ts` | a command that names a test file missing on main is dropped; the real file's command runs | 1 | fails at `2b287c6cfb` with the product code of its parent (acceptance: a bun test command that names a test file missing on origi...) |
| `acceptance.skip.test.ts` | a command with an angle-bracket placeholder is not runnable; a redirection is | 1 | fails at `4542fe7f21` with the product code of its parent (acceptance: an Oracle command with an angle-bracket placeholder is not...) |
| `ask.test.ts` | askChris with a null text sets the Ask and adds no note | 2 | only check of `jobs/lib/ask.ts:295` |
| `ask.test.ts` | grant then always round-trips; revoke removes it | 2 | only check of `jobs/lib/ask.ts:269-273` |
| `ask.test.ts` | aleph always grant, list and revoke work on always.json | 3 | the one wiring test of `aleph always` |
| `checks.flow.test.ts` | a check that fails then passes on the same tree passes the run, is recorded and reported; two make a health line | 2 | only check of `jobs/lib/factory-status.ts:324-325,362-366` `jobs/lib/factory.ts:533,537-544,551-552,555-560,566-567` |
| `checks.test.ts` | the check prelude carries both NO_SUBMODULES lines | 1 | fails at `7423148614` with the product code of its parent (Check and deps preludes set NO_SUBMODULES after git init, as the unit...) |
| `corrections.test.ts` | a drop whose run made no commit is not a signal, whatever Jev says | 1 | fails at `8c15ad5f4f` with the product code of its parent (Corrections: a drop because the run made no commit is not an agent fau...) |
| `corrections.test.ts` | notifications, hand-backs and bridge text make no signal | 1 | fails at `d57c1226b9` with the product code of its parent (corrections: skip notifications, hand-backs and factory sessions; keep...) |
| `corrections.test.ts` | a proposed lesson with the same sentence takes the text | 2 | only check of `jobs/lib/corrections.ts:406-415` |
| `corrections.test.ts` | a proposed lesson without target gets title and target on the next mine | 2 | only check of `jobs/lib/corrections.ts:310` |
| `corrections.test.ts` | approve files the goal at once | 2 | only check of `jobs/lib/corrections.ts:338-342,365-383,385,387-390` `todo/lib/store.ts:414` |
| `corrections.test.ts` | decline marks it declined | 2 | only check of `jobs/lib/corrections.ts:344-346,395-401` |
| `corrections.test.ts` | the kind falls to claude-md, then skill | 2 | only check of `jobs/lib/corrections.ts:104-116,123-134,324` |
| `deps.test.ts` | two sweeps at once for one repo do not remove each other's deps folder | 1 | fails at `a979e32d18` with the product code of its parent (deps: each outdated() call has its own run folder, so overlapping swee...) |
| `deps.test.ts` | a bun outdated table gives one proposal per package whose latest is newer | 2 | only check of `jobs/lib/deps.ts:46` |
| `deps.test.ts` | a standing proposal grant starts a minor update and leaves a major one asking | 2 | only check of `jobs/lib/deps.ts:160-162,173-190,192,194-196` |
| `doc-claims.test.ts` | a claim that a file imports only some modules | 2 | only check of `jobs/lib/doc-claims.ts:159,166-170,248-257` |
| `doc-claims.test.ts` | a file:line past the end of the file, or a bare name no file has | 2 | only check of `jobs/lib/doc-claims.ts:199-200` |
| `doc-claims.test.ts` | a function named in a file that does not have it | 2 | only check of `jobs/lib/doc-claims.ts:243-245` |
| `doc-claims.test.ts` | an edit after a passing run fails the next run, which quotes the edited line | 2 | only check of `jobs/lib/doc-claims-repo.ts:26,90-92` |
| `doc-claims.test.ts` | every default, setting name, repo path, file:line, symbol, import claim and aleph flag in the docs | 2 | only check of `jobs/lib/doc-claims.ts:121-122,183,219-225,260` |
| `doc-claims.test.ts` | aleph doc-claims runs the check and exits 0 on this tree | 3 | the one wiring test of `aleph doc-claims` |
| `doctor.test.ts` | a 0-byte git lock in objects is not an empty object | 1 | fails at `33266a1db3` with the product code of its parent (Doctor: count only loose objects and packs as empty objects...) |
| `doctor.test.ts` | no next run while the tick service is activating (exit 3) passes | 1 | fails at `23fb3c7b35` with the product code of its parent (doctor: pass the timer next-run check while aleph-tick.service runs...) |
| `doctor.test.ts` | --fix removes an empty object behind refs/aleph/facts and writes the ref again | 2 | only check of `jobs/lib/doctor.ts:73-75,164-171` `jobs/lib/status.ts:108-113` |
| `doctor.test.ts` | a clock fault replaces a bun test failure, and nothing else | 2 | only check of `jobs/lib/probe.ts:49-51` |
| `doctor.test.ts` | a run with a pid, no exit and no process is lost | 2 | only check of `jobs/lib/doctor.ts:144-145` |
| `doctor.test.ts` | a wall clock that jumps beyond the monotonic clock is a step | 2 | only check of `jobs/lib/clock.ts:16` |
| `doctor.test.ts` | aleph.home answers or does not | 2 | only check of `jobs/lib/doctor.ts:126-130` |
| `episode.test.ts` | a 400-character multi-byte title is cut to fit a file name | 1 | fails at `697956b30e` with the product code of its parent (episode: cap the page title at the file name limit (aleph-611)...) |
| `episode.test.ts` | two done parts of one issue get a page each, named by their refs | 1 | fails at `1750cd2d9e` with the product code of its parent (Episodes of parts are named by their ref, so the skip filter finds the...) |
| `episode.test.ts` | an unreachable Langfuse does not block the page | 2 | only check of `jobs/lib/episode.ts:113` |
| `every-gate.test.ts` | gate browser step: reviewBack on a held run leaves it awaiting when call.md says chris, and passes it when call.md says land | 2 | only check of `jobs/lib/ledger.ts:331` `jobs/lib/unit.ts:521-531` |
| `every-gate.test.ts` | gate held path: a branch that changes a path in repo.held is awaiting, and sandbox.ts is held path jobs/lib/sandbox.ts | 2 | only check of `jobs/lib/checks.ts:254-256` `jobs/lib/unit.ts:486-488,516` |
| `explain.test.ts` | a failing explainer leaves the lesson; after two failed sweeps no third run opens | 2 | only check of `jobs/lib/explain.ts:64-65,100-103,107-112,115,238-239` |
| `explain.test.ts` | an awaiting run's state.json gets the text on run.ask | 2 | only check of `jobs/lib/explain.ts:49-50,57-61,77-78,82-85,90-91,137-143,147-155,162-172,174-186,193-207,235-236` |
| `factory-claims.test.ts` | a rescue that finds the lock taken waits, then acts once on the state it finds under the lock | 1 | fails at `b4013732b8` with the product code of its parent (factory: rescueStuck waits up to 60 s for the rescue lock instead of s...) |
| `factory-claims.test.ts` | a standing rescue: recommended drops the unsafe stuck run, no Ask, an always: Rerun note | 2 | only check of `jobs/lib/rescue.ts:260-265` |
| `factory-dispatch.holds.test.ts` | a goal parked after the first read | 2 | only check of `jobs/lib/factory.ts:199-202` |
| `factory-dispatch.order.test.ts` | a parent whose parts are all done closes in a dispatch where main's baseline is red | 2 | only check of `jobs/lib/factory.ts:272-283` |
| `factory-dispatch.races.test.ts` | a goal added while the baseline of a repo that joined the list runs is started by the holder | 1 | fails at `2ad0dcdfe5` with the product code of its parent (factory: run baselines until every repo in the goal list has one, so t...) |
| `factory-dispatch.races.test.ts` | a goal closed during the baseline is not started | 1 | fails at `cbb25aaee4` with the product code of its parent (factory: a goal whose label or status changes during the baseline is n...) |
| `factory-dispatch.spec-check.test.ts` | a hold sets the Ask and the hold record, counts in the day's spend and not in its runs, and the goal is not started | 2 | only check of `jobs/lib/factory-status.ts:96-104` `jobs/lib/spec-check.ts:57-60,87-89,147-150` |
| `factory-dispatch.spec-check.test.ts` | an error starts the goal, as the unit did | 2 | only check of `jobs/lib/factory.ts:233-234` `jobs/lib/spec-check.ts:62,103-107` |
| `factory-dispatch.spec-check.test.ts` | with no verdict, the dispatch starts one detached check and not the goal; a second dispatch while the lock is held starts none | 2 | only check of `jobs/lib/factory.ts:229-232` `jobs/lib/spec-check.ts:120-121` |
| `factory-gates.test.ts` | a land that failed 'job lock busy' does not hold the factory | 1 | fails at `b949d356e2` with the product code of its parent (land: a second 'main moved' retry keeps the leader; land-start lock ca...) |
| `factory-gates.test.ts` | after a land that failed 'job lock busy' the passed agent run is waiting to land again | 1 | fails at `271e84b45f` with the product code of its parent (land: a real [L, B] splice-guard test; waitingToLand skips a 'job lock...) |
| `factory-gates.test.ts` | gates returns the first reason, in the order pause, hold, probe, live cap, day cap, waiting | 2 | only check of `jobs/lib/factory-status.ts:180-181` |
| `factory-nocommit.test.ts` | no commit, the item on main by its Item trailer: the open item is closed with a note naming the commit | 1 | fails at `121b473b74` with the product code of its parent (factory: a land that finds its own commit on main closes the item; a d...) |
| `factory-pure.test.ts` | a dispatch with checks, three factory repos and no open goals fetches the work store at most twice | 1 | fails at `8c5fc24b3d` with the product code of its parent (A reader fetches the work store once; acceptanceStep shares one reader...) |
| `factory-pure.test.ts` | an explain run has no repo; its cost counts in the day's spend, not in runsToday, and an old one adds nothing | 1 | fails at `c3a2b9868e` with the product code of its parent (Explain runs: counted in spentToday (not runsToday), shown as Explaine...) |
| `factory-pure.test.ts` | stalled counts a red baseline only on the commit origin/main still has | 1 | fails at `b1d31bbd88` with the product code of its parent (stalled() counts a red baseline only on origin/main's commit...) |
| `factory-pure.test.ts` | report lists each new episode page once, and nothing without a wiki/episodes folder | 2 | only check of `jobs/lib/factory.ts:595-600` |
| `factory-restart.test.ts` | a build a host restart killed, with a commit ahead of main, starts a recheck of its branch and no new run | 1 | fails at `26fc5722a8` with the product code of its parent (A host restart rechecks a killed build with commits ahead of main, and...) |
| `factory-restart.test.ts` | a facts run a host restart killed ends done, with the reason, and stays unshown for the news | 1 | fails at `933111c885` with the product code of its parent (End a facts run that a host restart killed...) |
| `factory-restart.test.ts` | a held run whose PENDING call.md is older than the boot gets one new review start | 1 | fails at `04540e0cdd` with the product code of its parent (The dispatch pass starts again a review that a host restart killed...) |
| `factory-restart.test.ts` | a recheck a host restart killed, with a commit ahead of main, starts a new recheck of its branch and no new goal run, and uses no rerun | 1 | fails at `699af45913` with the product code of its parent (A host restart rechecks a killed recheck with commits ahead of main, a...) |
| `factory.hold.test.ts` | a stuck or failed run holds the factory only once no next run is pending for it | 1 | fails at `a800a6ffa9` with the product code of its parent (factory: a stuck or failed run does not hold the factory while its nex...) |
| `factory.tick.test.ts` | the nightly sweep logs a repo with no list and still files the next repo's proposals | 2 | only check of `jobs/lib/deps.ts:140` `jobs/lib/probe.ts:71,73-78` |
| `facts.test.ts` | a job with only unsourced FACT lines is gated once and marked | 1 | fails at `51c720861d` with the product code of its parent (facts gate: mark the land run with facts: true once it has looked at a...) |
| `facts.test.ts` | a command that exits 1 ends the run failed | 2 | only check of `jobs/lib/facts.ts:93-95` |
| `facts.test.ts` | a kept fact is written, an unsourced one dropped, a rejected one logged, a contradiction rejected; a second dispatch adds no run | 2 | only check of `jobs/lib/facts.ts:46-55,88-91,106-108,110-118,120,122,125,128,131,135-147,166-171,173-180` |
| `facts.test.ts` | a reply with no JSON fails the run and rejects every fact | 2 | only check of `jobs/lib/facts.ts:85-87` |
| `firefighter.ask.test.ts` | a triage question on a mark whose reason Chris handed is cleared; without the handed reason it is refused | 1 | fails at `5978465e24` with the product code of its parent (firefighter: clear-needs-chris judges the item's current needs-chris r...) |
| `firefighter.goal.test.ts` | a handed spec-check Ask is an event with handed set, and the firefighter's edit-goal clears it and stores the spec | 2 | only check of `jobs/lib/firefighter.ts:356-360` |
| `firefighter.goal.test.ts` | an after naming no goal is refused | 2 | only check of `jobs/lib/transitions.ts:34` |
| `firefighter.land.test.ts` | a firefighter drop of a run whose goal is on main writes fate already-met to the run's state | 1 | fails at `e39c4e6ae9` with the product code of its parent (The firefighter's drop of a run whose work is on main writes fate alre...) |
| `firefighter.land.test.ts` | a diff that changes REVIEW_SANDBOX in jobs/lib/review.ts is not landed | 2 | only check of `jobs/lib/firefighter.ts:298-303` |
| `firefighter.land.test.ts` | a firefighter land standing lets the firefighter land a held run on a security path, and logs it | 2 | only check of `jobs/lib/firefighter.ts:304-306` |
| `firefighter.red.test.ts` | a saved red CI gives one red event; while a red-main issue is open it gives none; a new head after it is done gives one, and the same head then none | 1 | fails at `83ad84c116` with the product code of its parent (The firefighter gives a red main one event per red head, and none whil...) |
| `firefighter.red.test.ts` | an add for a red repo files the body as the spec | 2 | only check of `jobs/lib/firefighter.ts:313-322` |
| `firefighter.reply.test.ts` | a flake action notes the repo's flake tracker, makes it when missing, files no other item, and logs it | 2 | only check of `jobs/lib/firefighter.ts:325-326` |
| `firefighter.reply.test.ts` | parseReply reads a flake action and refuses one with no text | 2 | only check of `jobs/lib/firefighter.ts:145` |
| `firefighter.reply.test.ts` | parseReply reads each action, and names a malformed one | 2 | only check of `jobs/lib/firefighter.ts:148-149` |
| `firefighter.step.test.ts` | a close reply drops the stuck job, writes no rerun file, and marks the issue done with the note | 2 | only check of `jobs/lib/firefighter.ts:331-337` |
| `firefighter.step.test.ts` | a goal with 4 runs in 30 minutes is an event, and a drop from the reply is applied | 2 | only check of `jobs/lib/firefighter.ts:86-88` |
| `firefighter.step.test.ts` | an 11th action in one reply is not applied | 2 | only check of `jobs/lib/firefighter.ts:144,340-341` |
| `job.test.ts` | a facts run does not reopen a landed job | 1 | fails at `8f8e306963` with the product code of its parent (isOpen ignores facts runs: a landed job stays closed while its reviewe...) |
| `job.test.ts` | reads, the latest run that has one, tails, marks, batch and notes | 2 | only check of `jobs/lib/job.ts:72-73,78-80` |
| `landing.batch.test.ts` | a member that failed in attempt 1 does not take the leader out when main moves twice | 1 | fails at `b949d356e2` with the product code of its parent (land: a second 'main moved' retry keeps the leader; land-start lock ca...) |
| `landing.batch.test.ts` | a member that failed its checks in attempt 1 is not in the retry after main moved | 1 | fails at `41a7675763` with the product code of its parent (land batching: the check skip needs the branch tip too; one land start...) |
| `landing.batch.test.ts` | the check issue filed after a land takes the priority of the landed issue | 2 | only check of `todo/lib/store.ts:391-397` |
| `landing.checks.test.ts` | a commit added to the branch after its checks gets the checks on land | 1 | fails at `41a7675763` with the product code of its parent (land batching: the check skip needs the branch tip too; one land start...) |
| `landing.checks.test.ts` | a land with checks skipped: main unchanged since records the pushed commit as green | 2 | only check of `jobs/lib/landing.ts:259,261-263` |
| `landing.follow.test.ts` | aleph-ui restarts when an aleph land changes a file in the server's import graph, and only then | 1 | fails at `07cd954277` with the product code of its parent (followCheckout restarts aleph-ui only for the server's import graph (a...) |
| `landing.merge.test.ts` | the run after a conflicted land has a merge prompt: the paths and the last commit on main, no spec text | 2 | only check of `jobs/lib/continuation.ts:80-84,182-192` `jobs/lib/landing.ts:198-202` |
| `launch.test.ts` | detached starts its verb in a unit of its own, a different one per call | 1 | fails at `6a3a29d99b` with the product code of its parent (detached() starts its verb in a transient unit of its own...) |
| `launch.test.ts` | acceptanceDetached starts no process in the foreground, and ignores ALEPH_DISPATCH=off elsewhere | 2 | only check of `jobs/lib/launch.ts:132` |
