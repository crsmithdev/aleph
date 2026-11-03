# Kept goal tests: jobs/lib m–z, jobs/cli.*, other jobs/ tests

Scope: `jobs/lib/*.test.ts` whose base name starts with m to z, every `jobs/cli.*.test.ts`, and the other test files
under `jobs/` that are not in `jobs/lib`.

## Method

- A goal-added case is a case whose first commit has a `Job:` trailer. The first commit is the oldest commit that
  adds the case title to a `*.test.ts` file (`git log --reverse -S<title>`). `git blame -C -C -C` on the `test(` line
  checks it. Each row of the stage table in `jobs/lib/stage.test.ts` counts as one case.
- 259 goal-added cases: 233 `test` calls and 26 stage rows.
- Reason 2: each case ran alone with `bun test --coverage --coverage-reporter=lcov`. The land suite ran with every
  goal-added case skipped. A case stays when it covers product lines that no other case of the land suite covers,
  and those lines are behaviour, not wording, layout or log text. A greedy cover picked one case for each set of
  such lines. After the move, a second coverage run of the land suite, with the reason-2 cases skipped, confirmed
  the lines in the table: no other case covers them. Spawned processes have no coverage, so a case whose branch is
  in `jobs/cli.ts` and only runs through the spawned CLI is checked by reading the code.
- Reason 1: the case's test file at the fix commit ran against the product code of the fix's parent (the test files
  that the fix commit changed were copied over the parent's tree). The case stays when it fails there for the
  behaviour, and when its current body still tests the same behaviour.
- Reason 3: the single CLI test of a command's wiring, and the process-boundary lock tests (landcheck,
  dispatch-once, slots-check).

## Kept cases

| Case | File | Reason | Evidence |
|---|---|---|---|
| a large goal whose spec has no Goal section starts one worker run at the rated tier and no planner run | jobs/lib/plan.test.ts | 1 | fix 9728a0b121 (aleph-982, the planner restarted forever); fails on its parent |
| a plan run with the cause no-answer and a free reason counts as a try | jobs/lib/plan.test.ts | 1 | fix f1be9a488e, plan.ts half; fails on its parent (Expected 1, Received 2) |
| a triage run with the cause no-answer and a free reason counts toward the Ask | jobs/lib/triage.test.ts | 1 | fix f1be9a488e, triage.ts half; fails on its parent (no Ask). One case for each module that the fix changed |
| the probe script sets each NO_SUBMODULES setting after git init and before git fetch | jobs/lib/probe.test.ts | 1 | fix caf7c0fb45 (the probe read .gitmodules); fails on its parent when `NO_SUBMODULES` is exported from git.ts as a stub |
| a spec QUESTION run, then the firefighter's answer: the job keeps its Ask or is started again, never open with neither | jobs/lib/rescue.test.ts | 1 | fix 3e6d57cf03; fails on its parent |
| the resolver rule maps every host to NOTFOUND but leaves loopback by name and by address | jobs/lib/review-browser.test.ts | 1 | fix 9995bb29f5; fails on its parent (no `EXCLUDE 127.0.0.1`) |
| a dotted goal is keyed by its dotted id, a plain item by its number | jobs/lib/stage.test.ts | 1 | fix 6e3bb6c632 (aleph-661); fails on its parent (`proj-5` for `proj-5.1`) |
| row "new goal: planning" | jobs/lib/stage.test.ts | 1 | fix 8c528cba4b (aleph-654); fails on its parent |
| row "dotted goal: done by its trailer commit while the store holds it open" | jobs/lib/stage.test.ts | 1 | fix cced16cde9; fails on its parent. The three other rows of this fix move |
| row "dotted goal: awaiting its Ask while a trailer commit on main names it" | jobs/lib/stage.test.ts | 1 | fix 40f625419e; fails on its parent |
| a touched item the store closed is done without a fresh trailer commit, unless a revert undid its trailer | jobs/lib/status.test.ts | 1 | fix 791315e06a (aleph-509); fails on its parent |
| k-3.1 and k-3.2 are separate entries; a reverted goal is in revertedIn and its sibling is not | jobs/lib/trailers.test.ts | 1 | fix fd5792348b; fails on its parent |
| refuses a start while the last run is starting: made, running, no pid and no exit | jobs/lib/transitions.test.ts | 1 | fix 2f1d43855c; fails on its parent |
| a triage run whose process ended before a verdict is ended as failed by the next triage | jobs/lib/triage.test.ts | 1 | fix bf41b7cd5d; fails on its parent |
| a fetch that fails keeps git's error text in the reason | jobs/lib/unit.fetch.test.ts | 1 | fix 40241a2e2c (aleph-703); fails on its parent (`fetch failed` with no text) |
| a worker that commits only result.md is stuck with no commit, and no check, review or land starts | jobs/lib/unit.worker.test.ts | 1 | fix 165a889920 (aleph-874.1); fails on its parent |
| a started run with no pid yet counts against the live cap | jobs/live-cap-pid.test.ts | 1 | fix 520a7da7ba (aleph-743); fails on its parent when `STARTING_MS` is a stub (Expected 1, Received 0) |
| drop --fate with an unknown value is refused and the job stays open | jobs/cli.basic.test.ts | 2 | jobs/cli.ts:475, the `--fate` check; only the spawned CLI reaches it |
| aleph status with no item gives the stage of each open item in the recent repos | jobs/cli.milestone.test.ts | 2 | jobs/cli.ts:392 and `statusRecent`; only the spawned CLI reaches it |
| drop keeps the fact that a no-commit run ended with no commit | jobs/cli.onmain.test.ts | 2 | jobs/cli.ts:473,476, `--quiet` gives no fate; only the spawned CLI reaches it |
| a recheck that clears the factory hold starts the next goal | jobs/cli.transitions.test.ts | 2 | transitions.ts:262-287, `recheck` (in-process through jobs/inproc.ts) |
| fetchOrigin waits out a ref lock that goes away | jobs/git-fetch.test.ts | 2 | git.ts:59-60, the retry after a ref lock |
| addWorktree waits out a config lock that goes away | jobs/git-fetch.test.ts | 2 | git.ts:69-79, the retry after a config lock |
| sandboxNetnsPid is null for a child in the host namespace | jobs/lib/netns.test.ts | 2 | netns.ts:36-39 |
| bridge keeps the inner socat's connection error | jobs/lib/netns.test.ts | 2 | netns.ts:42-47,56-62,69-76,85-111 (`bridge`); review-browser.ts:51-59 (`freePort`) |
| a reply that fails the check (${bad}) is retried once; two bad replies start the goal as one worker run with a note | jobs/lib/plan.test.ts | 2 | plan.ts:175-186 (`endPlan`), 239-240, 279-282 |
| the check: sections, the oracle, the waits and the count | jobs/lib/plan.test.ts | 2 | plan.ts:31-36,49-52 |
| the top episodes are put in the planner's prompt, and only two of their sections | jobs/lib/plan.test.ts | 2 | plan.ts:99-108 (episode parse), 115-116, 157-171, 271-274 |
| a QUESTION run waits for a spec edit: the Ask says so, and an edit drops the run, clears the Ask and starts the goal | jobs/lib/rescue.test.ts | 2 | rescue.ts:162-178, the release after a spec edit |
| recordReview puts the call on state.json: chris reads as ask, a pending or malformed review records none | jobs/lib/review.test.ts | 2 | review.ts:234-240 |
| a held run starts one review, a second pass none | jobs/lib/review.test.ts | 2 | review.ts:213-224 (`startReview`) |
| a drop that removes the run folder does not throw from review | jobs/lib/review.test.ts | 2 | review.ts:202 |
| a ui goal: the harness starts the server, Chrome loads the changed view from it, the server is gone after (reviewer exit ${code}) | jobs/lib/review.test.ts | 2 | review.ts:63-66,77-78,107-135; review-browser.ts:64-70,82-109,164-274 |
| a Jev 500 gives no model and writes no line | jobs/lib/route.test.ts | 2 | route.ts:29-30, the catch that gives no model |
| profile hides a CI-missing tool under denyRead only with the option | jobs/lib/sandbox.test.ts | 2 | sandbox.ts:38-45,100-118 (`profile`) |
| a shot with click and dark scheme gives a PNG of the requested width | jobs/lib/shot.test.ts | 2 | shot.ts:71-117,125-149,153-154,162-175,181-202 |
| a failed call or a reply with no verdict is an error that is not tried again | jobs/lib/spec-check.test.ts | 2 | spec-check.ts:90-91 |
| onMain finds a Job trailer, an Issue trailer and a branch's content, and fetches only when asked | jobs/lib/status.test.ts | 2 | status.ts:219-225, the content check |
| a reviewer's run is a second tree under the same trace | jobs/lib/trace.test.ts | 2 | trace.ts:23-24,29-58,62-83,88-112; hooks/lib/otlp.ts:35,44 |
| a goal waiting on several items comes due once every one is done | jobs/lib/transitions.item.test.ts | 2 | factory.ts:624,630-631, the seen file |
| does not refuse for the starting rule once the last run's made is older than STARTING_MS | jobs/lib/transitions.test.ts | 2 | launch.ts:55-56 |
| a triage run records its route and the issue it is on | jobs/lib/triage.test.ts | 2 | triage.ts:54-59,162-164,170-173,178-179 (the flake route) |
| a malformed verdict leaves the item unchanged and is skipped | jobs/lib/triage.test.ts | 2 | triage.ts:75 |
| retry: no label, the count starts again, and a third triage runs the command | jobs/lib/triage.test.ts | 2 | triage.ts:215-218 |
| close: the item is done with the note | jobs/lib/triage.test.ts | 2 | triage.ts:221-226 |
| recommended: an ask with options leaves no Ask and a note naming the recommendation; a prose question is asked | jobs/lib/triage.test.ts | 2 | triage.ts:62-66,184-189 |
| a triage that exits non-zero counts toward the limit | jobs/lib/triage.test.ts | 2 | triage.ts:273-275 |
| a non-goal issue is triaged with no tick; a goal is not | jobs/lib/triage.test.ts | 2 | factory.ts:655-659 (`triageNow`); triage.ts:287-296 (`triageIssue`) |
| triage closes it as done with the commit in the note, and starts no worker | jobs/lib/triage.test.ts | 2 | triage.ts:107,175-176,262-263 |
| a done verdict naming a commit that is not on main is not applied | jobs/lib/triage.test.ts | 2 | triage.ts:258-261 |
| walks relative imports from the server and api roots | jobs/lib/ui-graph.test.ts | 2 | ui-graph.ts:35, an unreadable import is skipped |
| a worker follow-up takes the priority of the run's issue, medium when there is none | jobs/lib/unit.followups.test.ts | 2 | unit.ts:679-694 (`fileFollowups`) |
| the sandbox prompt asks for FACT lines that parseFacts reads; the other prompt does not | jobs/lib/unit.prompt.test.ts | 2 | continuation.ts:72-74,85-99: the choice of prompt and its hidden checks, notes and previous result |
| checksInSandbox states a failed setup as the check `setup` | jobs/lib/unit.tz.test.ts | 2 | checks.ts:147-148 |
| checksInSandbox states a failed hidden check as hidden-check | jobs/lib/unit.tz.test.ts | 2 | checks.ts:90-104 (`runHidden`), 154 |
| two dispatches at once start each goal once | jobs/cli.dispatch-once.test.ts | 3 | lock test: `aleph dispatch` |
| two dispatches at once with a live cap of 1 start only one goal | jobs/cli.dispatch-once.test.ts | 3 | lock test: `aleph dispatch` |
| aleph spec-check: a hold asks and is noted, and the same version is not checked again | jobs/cli.factory-checks.test.ts | 3 | wiring: `aleph spec-check` |
| two lands of one job at once start one land run | jobs/cli.landcheck.test.ts | 3 | lock test: `aleph land` |
| a job stuck on a failed check passes once main is fixed, keeps the worker's commit and starts no worker | jobs/cli.recheck-stuck.test.ts | 3 | wiring: `aleph recheck` |
| the nightly sweep files one proposal per stale package, once, and a moved latest files one more | jobs/cli.reviewer-sweep.test.ts | 3 | wiring: `aleph tick` (probe, then sweep) |
| with one slot two checks started together run one after the other, and both pass | jobs/cli.slots-check.test.ts | 3 | lock test: check slots |
| the wait for a slot does not count against ALEPH_CHECK_TIMEOUT | jobs/cli.slots-check.test.ts | 3 | lock test: check slots |
| an edit that sets the status back to open starts the goal | jobs/cli.transitions.test.ts | 3 | wiring: `aleph issue edit`, whose dispatch jobs/cli.ts starts |

## Kept with no reason from 1 to 3

| Case | File | Why it stays |
|---|---|---|
| drop writes the fate by-hand, none with --quiet, and --fate overrides it | jobs/lib/unit.flow.test.ts | The next case in its describe ("a new job with an ended job's name starts fresh", not goal-added) needs the job `alpha` that this case drops. Moving it needs an edit to that kept case. |
| row "new goal: blocked" | jobs/lib/stage.test.ts | The case "aleph status prints the same stage as JSON and as one line" (not goal-added) reads `GOALS_NEW[1]` and wants a blocked goal. The row now comes after "new goal: working", so it stays at index 1. |

## Moved, with the checks that did not keep them

- 193 cases move to `acceptance/`, at the mirrored path. A file that already had an archive takes
  `<name>.pass2.accept.ts`. 11 test files become empty and go. No case was an exact duplicate.
- `review.land.accept.ts` holds a copy of the land-suite case "a held path needs Chris with the rule and the diff
  stat": the archived report case reads the run that it leaves.
- Reverted-fix checks that did not keep a case:
  - 74b6f98d54 (the drop's rerun waits): the case passes on the parent.
  - 4709d9c4ac: the plain-number Goal case fails on the parent, but its current body has no `Goal:` trailer, so it
    no longer tests the fix.
  - 1fbbd86e03 (dotted ids in `aleph status`): the fix is in jobs/cli.ts, and the rows now call `repoStages`
    in-process.
  - 87afea85cc (worker setup without .gitmodules): the case tests the `NO_SUBMODULES` list, not the worker script
    that the fix changed.
  - dc198c8492 (a check frees its slot): the cases import `withSlot`, which the fix adds, so they cannot run on the
    parent.
  - acaf9e261b (baseline records no red when checks cannot start): the case fails at the fix commit too, on the
    sandbox probe of this host. Not checked.
  - Other fixes with a kept case: the other cases of the same fix move (cced16cde9, 520a7da7ba, 165a889920,
    8c528cba4b, 791315e06a, bf41b7cd5d, 7f70b1f8ae, 6db6eba4f6).
- Coverage: a case that covers no line that the rest does not cover, or only prompt wording, report or log text,
  moves. Examples: the worker prompt wording cases in unit.prompt.test.ts, the route cost log line, the report lines
  in review.land.test.ts, the shot error text.
- The probe case "a probe with no results names exit code and stderr" covered its lines alone until the move. After
  it, the kept reason-1 probe case covers them, so it moves too.
- Spawned CLI cases whose code is in the library (`aleph land` on an item, `aleph report` after a baseline, `aleph
  tick` triage, the cli.onmain land cases): a lower-layer test is possible, so they move. `aleph tick` keeps one
  wiring test.
- Tests of repo files, not product code (jobs/systemd/aleph-ui.service, jobs/windows/start-wsl-at-boot.ps1,
  package.json, the test helpers in jobs/cli.helpers.ts) move.
