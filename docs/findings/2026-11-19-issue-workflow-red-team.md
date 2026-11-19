# Issue workflow red-team, 2026-11-19

Two rounds of adversarial review of the factory's issue workflow, intake to land, and the seven-change plan that came out of round 1. Source: session `70126ff5` (subagent reports, copied as they arrived). The figures of the process are in [2026-11-19-issue-lifecycle.html](2026-11-19-issue-lifecycle.html).

## Outcome

- Round 1 verdict: REVISE. It produced seven issues, a3324 to a3330.
- Round 2 found fatal or high flaws in five of the seven. Chris dropped all seven.
- a3324 (delete the mechanical rebase) landed as `70d0e57d`: 123 logged tries, 123 conflicts, 0 successes.
- a3325 (delete the no-answer timeout setting) was started and discarded. The `timeouts` setting is `{}` in `~/.aleph/aleph.db`.
- The claims-and-measurement reviewer of round 2 was stopped before it reported.

## Round 1 synthesis

**Verdict: REVISE.** The happy path works: 863 issues landed in 15 days, with a median of 11 minutes from start to land. Around that path are three problems:

- **Expensive steps run on every issue whether or not they pay.** Intake is 29% of all spend.
- **Retry loops slip past their own caps.** The worst issues reran 6 and 7 times.
- **Failures pile up quietly.** Parked follow-ups, flake notes and ghost runs grow, and no step clears them.

Five reviewers (efficiency, reliability, failure modes, simplicity, fixed assumptions) read the code and `~/.aleph/aleph.db`. Tags: **verified** means I re-ran the query or read the code myself. **reported** means only the reviewer saw it. One finding was refuted and dropped (see the end).

### Correctness defects

1. **An Always "Rerun" skips the once-per-issue rescue limit** (verified). At `jobs/lib/land/rescue.ts:345` the standing `rescue: resolve` rule drops the run and never marks the rescue. Your rule has stood since 10-29. The reviewer saw 7 reruns on 3203 and 6 on 2955, and only the run-cap stopped them.
2. **Ghost `running` rows** (verified). `job.10073` (land, since 11-17) and `job.9126` (review, since 11-15) are `running` with `pid` null. Their issues are closed. Nothing closes a lost run's review row, and the rescue never caught the land.
3. **The sweep does routine work** (verified). 35 of 43 `missed` events are `ingest:` keys. The reviewer saw an answered Ask on 3203 wait 1.5 to 2 minutes for the sweep, twice on 11-18. Reported: the sweep can't see a dropped start while other work runs (`jobs/lib/transitions/stall.ts:21`).
4. **The land lock is held across a model call and has no time box.** Verified: `writeTitle` runs inside the land lock region of `jobs/lib/land/landing.ts`. Reported: 19 lands ran longer than 1800 s, and one hung check blocks every land in the repo.
5. **A `started` event is logged before the start can still be refused** (reported, `jobs/lib/transitions/transitions.ts:366`). A refused start then clears the rerun note and the run-cap mark.
6. **The director drops the run before it writes the rerun note** (reported, `jobs/lib/roles/director.ts:576`). The rescue does these in the opposite order.

### Silent sinks

7. **Parked follow-ups grow without bound** (reported). Workers filed 295 since 11-10, 132 sit parked, and only 8 were unparked. The housekeeper only writes notes, which matches your 11-12 decision. No step ever drains the pile.
8. **The flake tracker swallows flakes** (reported). Issue 1156 holds 129 notes after 15 days open. Flake follow-ups are paused on purpose, but real order-dependence bugs land in the same pile.
9. **Test-only worker follow-ups are dropped and nobody is told** (reported, `jobs/lib/roles/intake.ts:366`). 24 issues closed this way.
10. **A red main can lock everything** (reported, `jobs/lib/transitions/baseline.ts`). If the red-main fix fails or is dropped, nothing clears the hold. One red spell lasted about 25 h on 11-02/03.
11. **A worker's `already_met` claim plus a green suite closes the issue as done** (reported, `jobs/lib/land/rescue.ts:395`). A green suite doesn't prove the claim. Issue 2892 closed this way, and the real fix was a config change you made by hand.
12. **Only repos marked `sandbox` get intake** (verified, `jobs/lib/transitions/dispatch.ts:73`). Issues in the other repos stay `new` with no signal; `aleph status` shows 6. This may be on purpose, but nothing tells you.

### Efficiency (15 days, about $1,490 spent)

13. **Intake costs $392 (29%) before any code exists** (reported). 758 of 968 runs only route to build. 64 issues went through intake 2 to 4 times.
14. **Fix rounds succeed about 55% of the time** (reported). Round 1 passes 55% and round 2 passes 57%. A round-2 drop reruns from main and discards three rounds of work.
15. **The reviewer runs on every build and holds about 16%** (reported). It cost $158. No record says whether a hold was right. 244 of 251 held issues landed later anyway.
16. **Director runs with a fixed outcome** (verified). 78 runs ended `escalated` ($37.4). For held-path Asks, code fixes the outcome before the model reads the case.
17. **The mechanical rebase has never succeeded** (verified). Job logs show `mechanical rebase: conflicts` 123 times and `ok` 0 times. Every conflict still pays for a merge run and a review.
18. **Tests run three times** (reported): in verify (14.2 h), in the land checks (5.3 h), then in the hourly suite.
19. **The size router shows no pass-rate gain** (reported). First-run pass rate: deepseek/small 0.62, sonnet/medium 0.51, opus/large 0.44.
20. **Busy-file holds idle issues** (reported). There were 615 holds, mostly on `docs/design.md` and `ui/views/issues.js`. Issues waited 231 h in total between intake and build.

### Simplicity

21. **Machinery that never fires** (verified for timeouts, reported for the rest). The `timeouts` setting is `{}`, so the timeout code, CLI and Gates control have no users. The `credit` cause fired 0 times in a month. 5 of 12 causes covered 5 events.
22. **Two vocabularies for Ask reasons** (reported). The code (`lib/naming.ts:13`) says `protected`, `incomplete`, `capped`. The doc and the events say `held-path`, `part-dropped`, `run-cap`.
23. **Five mechanisms mean "try again"** (reported): fix rounds, the rescue, `recheck`, director `rerun`, and the land bounce. Each has its own cap and its own once-mark.
24. **About 5 jobs per landed issue** (reported). 13.6k lines of code and 12k lines of tests serve about 75 lands a day.

### Cheaper alternatives (ranked by code and risk)

1. Delete the mechanical rebase and the timeout machinery. Both are dead, by the data.
2. Send held-path and security Asks straight to you with code-written case text. This skips about 78 director runs.
3. Make the Always Rerun count toward the once-per-issue limit.
4. Put a time limit on land runs, and move `writeTitle` outside the land lock.
5. Skip the intake model for issues whose request already holds a valid spec.
6. Re-measure the keep-gate and the doc-claims check: 222 of 380 check returns came from these two procedural checks, not broken code.

**Refuted:** "the keep-gate returns runs, contrary to the doc." It did, 135 times, until commit `a796c8e4` (11-18 14:28) changed it to report to the reviewer. Its last failure was 11-18 21:25 UTC, before that commit.

Not verified: every finding tagged reported. I re-checked only the ones tagged verified.

The five reviewers are still running, so you can push back on any finding by lens name. Next step: pick which findings to file as issues. I haven't filed any.

## Round 1 reports

### Givens

Data read from aleph.db (read-only): 1831 intake runs cost $506.1, 1708 passed builds $686.8, 665 returned builds $322.6, 560 dropped builds $76, 506 director runs $184.9, 1246 reviews done and 943 failed, 1660 lands landed and 231 failed. Mean minutes: intake 1.4, build 6.9, land 1.7, review 0.3. Events span 2026-09-26 to 2026-11-19, 27,676 rows. Nothing was written. Not verified: why 943 reviews are `failed`, because I saw only `{"told":true}` in `extra`.

1. [high] [premise], evidence: read
   Where: premise; `docs/workflow.md` Path
   Failure: "One issue, one job" makes every issue pay the full pipeline (intake, build, verify, review, land, director on any Ask). Costs: 1831 intake runs, $506.1, 74% of the $686.8 spent on passed builds. A code-only or trivial route that skips intake would cut that spend. The route for small issues is not measured.

2. [high] [design], evidence: read
   Where: `docs/workflow.md` §1 Intake
   Failure: The spec (Goal, Edit surface, Oracle) is written before any code exists. Edit surface and Oracle paths are guesses the code gate (`problems`) can only check for existence. The cost shows later: 665 returned builds ($322.6) and a time-box or `question` rescue path. A spec written or amended by the worker after it reads the code would remove the "spec question" rescue and the `oracle-pin`.

3. [medium] [design], evidence: read
   Where: `docs/workflow.md` §4 Verify, Oracle pin
   Failure: Oracle pin forbids editing existing files that the Oracle names but the Edit surface does not. It exists only because the spec's author and the builder are different, and the builder could otherwise weaken the check. With the oracle moved to a held-out test set or the worker given no write path to it, this check, the keep-gate and the reviewer's test-change findings could shrink to one mechanism. Principle 5 says one way.

4. [high] [design], evidence: read
   Where: `docs/workflow.md` §4, §6, Background (Suite)
   Failure: The same tests run three times: verify on the branch, land checks on the merged tree, and the hourly suite on main. The land runs only critical tests when main did not move. The land takes 1.7 minutes on average. The suite is the only full-suite gate and is hourly, so a bad interaction sits on main up to an hour and blocks all dispatches (Baseline gate) until a `red-main` fix lands. If the land checks alone ran on the merged tree, verify would only need the fast checks. The cost of that is more failed lands (231 failed of 1660) and a longer lock hold.

5. [medium] [design], evidence: read
   Where: `docs/workflow.md` §4 vs §6
   Failure: A branch is verified on its own tip, which is not the tree that ships. Verify results can be stale for a squash commit on a moved main. Verify on the in-memory merge removes the land's second run and the "moved" re-land path (up to 3 relands, `continuation.ts:155`).

6. [medium] [design], evidence: read
   Where: `docs/workflow.md` §5; `jobs/lib` review role
   Failure: Review runs after verify, as a separate Opus run on the whole diff, and a hold costs a full fix round (max 2). 943 review jobs are in `failed`, against 1246 `done`, so review often has no verdict before the fix-round pipeline sees it. Review inside the worker's turn (or on the spec only) would remove one run per job and the "reviewer runs once more" path. The cost is a worker that grades its own work.

7. [high] [design], evidence: read
   Where: `docs/workflow.md` §8 director; `director.ts`
   Failure: Every Ask goes first to a Fable director, one run each. 506 runs cost $184.9, and 111 `escalated` events show the director often hands the Ask on anyway (for example "a protected file: hooks/lib/judge.ts" appears 7 times). For `held-path`, security-path and `core-change` Asks, code already refuses what the director may do, so the run adds latency and cost with no decision. Code could route those Asks to Chris directly.

8. [medium] [premise], evidence: read
   Where: `PRINCIPLES.md` 2 vs `docs/workflow.md` §5 held paths
   Failure: Principle 2 sets a target of zero routine Asks, but `question` event counts show `held-path` 55, `review-held` 22, `rescue` 16 in the log. A held glob is a rule that always makes an Ask by design, so the target cannot be reached while held paths exist. The given is the path list, not the Ask.

9. [medium] [design], evidence: read
   Where: `docs/workflow.md` §6 Land
   Failure: Lands go one at a time per repo with in-memory merges and no queue. Batch (8) plus bisect splitting is a hand-built merge train. A land that fails a batch costs a halving search of land-check runs. GitHub merge queue or CI is out by choice ("GitHub CI on main does not gate"), yet the Firefighter still files bugs from GitHub CI. The factory therefore pays for a second, advisory CI.

10. [medium] [design], evidence: read
    Where: `docs/adr/0001-holds-are-events.md`, `docs/architecture.md` "One writer per store"
    Failure: State is in job JSON, events, an issues store on `origin/main`, and SQLite (`jobs` table has 10333 job dirs under `~/.aleph/jobs`, and an `issue_state` table). ADR 0001 removed one duplicate (wait columns) but the same fact still lives in several places: job state in `jobs` and in `record.ts` JSON, issue done-ness in a trailer on main and in the store. The `missed` events (43) show the sweep exists to repair disagreement. Moving to one store (SQLite or git only) removes the sweep's reconciliation role.

11. [medium] [design], evidence: read
    Where: `docs/architecture.md` line 114
    Failure: An issue is done when a commit on main names it in an `Issue:` trailer, and the issues store is git-committed. Each issue write is a commit on `origin/main` (CLAUDE.md), so 974 `filed` events plus notes and decisions make main history noisy and make intake race with writes. The store in SQLite would remove the commits and the "issue write starts intake" coupling, and cost the audit trail in git.

12. [medium] [design], evidence: read
    Where: `jobs/lib/infra/settings.ts:99-106`, `jobs/lib/transitions/continuation.ts:153-155`
    Failure: Caps are fixed constants (`FIX_ROUNDS_DEFAULT` 2, `BOUNCES` 2, `RELANDS` 3, `LAND_BATCH_DEFAULT` 8) with partial settings overrides (`fixRounds`, `landBatch`), but `BOUNCES` and `RELANDS` have no override. They are counts that ignore cost: a round on a $0.49 build and a round on a $2 build count the same. A dollar budget per issue would replace three caps, and `run-cap` and `no-commit` Asks, with one rule. A cap is smaller code, a budget is more reliable.

13. [medium] [detail], evidence: read
    Where: `docs/workflow.md` §2 Loop guard
    Failure: "3 starts in 60 minutes" and "last 3 runs made no commit" are count guards. They set `run-cap` and `no-commit` Asks. Chris sees them as Asks even though Principle 2 says the system decides what it can. A spend ceiling would let the system stop an issue on its own.

14. [medium] [design], evidence: inferred
    Where: `docs/workflow.md` §7 Rescue
    Failure: Rescue is ten cases of "drop and rerun once" or Ask. Drop-and-rerun discards the worker's context each time (560 dropped builds, $76). The "once per issue" mark is global, so a second unrelated failure on the same issue goes straight to Chris. Keeping the branch and worktree across all cases (as `aleph recheck` does) is a smaller table. The cost is a branch that may carry a bad commit.

15. [medium] [design], evidence: read
    Where: `docs/workflow.md` §2 Gates (Live cap, Busy file, Backend, Baseline)
    Failure: Admission is split across seven gates and a load queue, so an issue's non-start has eight possible reasons, each logged as a `held` event (484) and a `full`/`busy` event (496, 725). One host with one shared worker slot count would need fewer. The given is the single factory host: moving runs to a remote or per-job container would drop Live cap, Load admission and Busy file, and add network and image management.

16. [low] [detail], evidence: read
    Where: `docs/workflow.md` §4 "A failing check runs once more"
    Failure: A rerun passes are recorded as flakes: 135 `tests` rows in `flaky`. Each rerun costs wall time for every verify, and the 2-fix-round cap is spent when the rerun is not used. The record shows flaky tests exist but the workflow has no consumer that fixes them beyond a `flake` issue note.

17. [medium] [design], evidence: read
    Where: `docs/workflow.md` §1 Intake send-backs, `docs/workflow.md` §3
    Failure: Worker follow-ups become new parked issues, each of which needs its own intake, spec and job. Test-only follow-ups are dropped by a code rule. The one-issue-one-job given turns every follow-up into the full pipeline cost (see 1), so work is dropped or parked rather than done. A follow-up inside the same branch (one job, several commits) would remove the issue/branch/commit one-to-one.

18. [medium] [design], evidence: read
    Where: `docs/workflow.md` §6 step 4, Land
    Failure: One squash commit per job discards the worker's commit history, so a bisect on main finds a whole job and the fix-round commits are lost. Keeping the commits would cost a merge-commit history and more conflicts. Squash is right only while jobs stay small, which the intake spec check enforces only by "2 to 6 sub-issues".

19. [low] [design], evidence: read
    Where: `docs/verify-gate.md`; `docs/workflow.md` §4
    Failure: Two different "verify" mechanisms share one name. `verify-gate.md` is the Stop hook for interactive turns (Haiku/Jev judge, fails open), and `workflow.md` §4 is the factory's verify. The factory runs the doc-claims check from the hook inside verify. The hook judges claims in prose, which Principle 9 says components should not parse. A structured claim field in `WORKER_SCHEMA` would replace the parser.

20. [medium] [design], evidence: read
    Where: `docs/workflow.md` §2 "GitHub CI on main does not gate"; Background (Firefighter)
    Failure: The Baseline gate is the hourly suite, so the factory is blind between runs. A land to main happens at most 1.7 minutes after a pass, so up to about 35 lands can happen in an hour on one main before a red baseline stops the next. Running the suite after each land instead (the land already holds the lock) would shrink that window.

21. [low] [premise], evidence: inferred
    Where: premise; `PRINCIPLES.md` 1 (Solo)
    Failure: The design has one user and one machine, so a single-host lock (`issue-<name>`, `arch-land.lock`) is enough. The same given means the factory has no recovery if the host or `~/.aleph` is lost: state is outside the repo apart from the issue store. Backups exist (`~/.aleph/backups`), but nothing in the workflow says they cover jobs/.

22. [low] [detail], evidence: read
    Where: `docs/workflow.md` Stages table
    Failure: `stage.ts` derives a stage by testing eleven conditions in order, with "working" in two rows. Stage is computed from the record, events, store and sub-issues. One stored state per issue (the moved given in 10) would delete this ordered test.

### Simplicity and YAGNI

  Data: ~/.aleph/aleph.db and ~/.aleph/jobs, window 2026-10-18 to 2026-11-18, read-only. Counts: 1642 `landed` events (1618 issues), about 75 per day. 13,616 non-test lines in jobs/lib plus 12,026 test lines.
  
  1. [high] [premise], evidence: read
     Where: premise, jobs/lib
     Failure: one landed issue costs about 5 jobs. The month shows 1831 intake, 2190 review, 2276 build, 1626 land and 495 director jobs. Intake plus review alone is 4.0k jobs for 1.6k landings. Maintainer cost: 25.6k lines for one person's queue.
  
  2. [high] [design], evidence: read
     Where: jobs/lib/records/outcome.ts:21, lib/naming.ts:17
     Failure: 12 causes, but 11 share one POLICY row. Only `credit` differs. `holdsBackend` and `waitMs` exist for `credit`, which fired 0 times. `moved` fired 0, `locked` 1, `stalled` 1, `infra` 3. 5 of 12 causes covered 5 events in a month.
  
  3. [high] [design], evidence: read
     Where: docs/workflow.md:141 vs data
     Failure: the doc says the keep-gate "never fails the run". 135 build runs carry `checkName: keep-gate` (124 returned, 11 dropped). The doc is wrong or the code differs. Keep-gate is also the largest source of send-backs, ahead of doc-claims (94) and oracle (54).
  
  4. [medium] [detail], evidence: read
     Where: jobs/lib/land/landing.ts:221
     Failure: the mechanical rebase logged `mechanical rebase: conflicts` 123 times and `ok` 0 times across every retained job log. The step has never saved a merge run in the retained logs.
  
  5. [medium] [design], evidence: read
     Where: jobs/lib/asks/timeout.ts (116 lines), settings.timeouts
     Failure: the `timeouts` setting is `{}`. The no-answer timeout code, its CLI and Gates page control, and a 9.5K test have 0 users. Principle 7 forbids waiting on a timer in any case.
  
  6. [medium] [design], evidence: read
     Where: docs/workflow.md:225, settings.always
     Failure: 13 Ask reasons use only 3 button pairs. approve/disapprove has 6 reasons, resolve/dismiss 4, continue/discontinue 3. Chris set 3 Always rules in a month, all `resolve`: rescue, question, blocker-dropped. 13 reasons exist to vary the card text.
  
  7. [high] [design], evidence: read
     Where: lib/naming.ts:13, docs/workflow.md:225
     Failure: two names for the same Ask reasons. Code `ASKS` has `protected`, `incomplete`, `capped`. The doc has `held-path`, `part-dropped`, `run-cap`. The `OLD` map translates, and 7 `OLD_HOLDS` words are still read. Events show both vocabularies (`held-path` 55, `run-cap` 3).
  
  8. [medium] [design], evidence: read
     Where: lib/naming.ts:7-37
     Failure: `waiting` is a state, a stage, a hold action and a gate. `held` is a stage, an event and a gate group. `STATES` has 8 words, `STAGES` 10, `CAUSES` 12, `ROLES` 13, `HOLDS` 5. A reader must learn five overlapping word sets.
  
  9. [medium] [design], evidence: read
     Where: jobs/lib/gates/issue-decision.ts:15
     Failure: 10 gates plus `parked`, `parent` and `starting`. Month counts: busy 725, full 496, red 332, after 337, looping 38, paused 12, starting 4, parked 2, parent 65. The busy-file gate fires often, so it is not dead. `paused`, `starting`, `parked` and `looping` total 56 against 1.6k landings.
  
  10. [medium] [design], evidence: read
      Where: jobs/lib/land/rescue.ts, workflow.md:206 and :198
      Failure: rescue (about 10 cases), fix rounds, `recheck`, director `rerun`, and the land-conflict bounce all mean "try again". The rescue's own header comment needs 12 lines to say who retries what. The `reran` event comes from three subjects: rule 224, director 18, gate 13. Rescue Asks (115) mostly produce director "Wait" answers, which is a no-op.
  
  11. [medium] [detail], evidence: read
      Where: rescue.ts:85 `askSlowLands`
      Failure: a slow-land Ask goes to the director, and the data shows it answers "Wait" in 8 of the 13 events seen. The comment says 99% of lands end within 20 minutes. This Ask costs a director run to say nothing.
  
  12. [medium] [design], evidence: read
      Where: docs/workflow.md:192
      Failure: batch cap 8. 156 of the batch logs say 2 or 3, 4 say 5, 1 says 7, 2 say 8. 130 of about 1600 lands were batch members. The split-in-half logic covers a rare failure. The `batch of 40` and `batch of 24` lines I could not explain.
  
  13. [medium] [design], evidence: read
      Where: workflow.md:198, models setting
      Failure: the "merge run" has no role in `ROLES`. It is a `build` on haiku, and the models setting has a `merge` key. Conflict is cause on 223 lands (14% of 1626). The cap of 2 bounces then rescue then Ask is 3 layers for one cause. "Merge" is two things: a run kind and a git operation.
  
  14. [medium] [design], evidence: inferred
      Where: roles/intake.ts, routing, roles/review.ts, roles/director.ts
      Failure: intake (opus, 1101 jobs, $442), a size classifier (303 `routed` events), reviewer (630, $158) and director (about 500, $185) each read the same issue text. The classifier is a fourth read. Housekeeper (239 jobs, $92) is a fifth. Principle 6 asks for a recorded reason per run.
  
  15. [medium] [design], evidence: read
      Where: jobs/lib/gates/doc-claims.ts (314), doc-claims-repo.ts (119), hooks/lib/docclaims.ts (139)
      Failure: 572 lines and 3 files for a check that stopped 94 runs. 21 of those 94 were later dropped, so the check also added a drop path. Whether any caught a real fault is not in the record.
  
  16. [low] [detail], evidence: read
      Where: workflow.md:141, worker-verdict.ts, unit.ts
      Failure: `oracleFailure` is defined in two files. One is `oracle-pin` (no edits to Oracle files) and the other runs the commands. The doc table lists "Oracle pin" and "Oracle" as separate checks, and the infographic says 5 checks and the doc says "four checks and the keep-gate".
  
  17. [low] [detail], evidence: read
      Where: events table, ACTIONS in lib/naming.ts:15
      Failure: `ACTIONS` merges STATES, HOLDS, ASKS and 14 other words. Held events are `held` (484) and also `busy` (725), `full`, `red`, `after` in old form. The same hold is two event shapes in one month, so any count of holds needs both.
  
  18. [medium] [design], evidence: read
      Where: lib/naming.ts:7-8, jobs/lib/infra/settings.ts
      Failure: `caps` holds `{live:5}` only, `timeouts` is `{}`, and `paused` is null. About 66 settings and caps exist, and the live data overrides one. Each setting also needs docs, a CLI and a UI control.
  
  19. [low] [design], evidence: read
      Where: jobs/lib/gates/issue-decision.ts:17
      Failure: `NO_COMMIT_LIMIT` (3) and `looping` (38 events) are a second no-commit limit. `no-commit` is also a cause (47 jobs), a rescue case, and an Ask reason. Four mechanisms for one cause that fired 47 times.
  
  20. [low] [detail], evidence: read
      Where: infra/process.ts, rescue.ts `killed`, `lost`
      Failure: killed-by-restart and lost-run are two rescue cases with the same actions. They differ only in the once-per-issue mark. One is infra and one is a process-end case.
  
  I did not open each rescue case in rescue.ts line by line. Cause counts come from `jobs.extra.cause`, so runs that stopped without a cause are not counted.

### Efficiency

  Window: jobs started since 2026-11-04 (15 days) in `~/.aleph/aleph.db`, table `jobs` (role, state, cost, model, extra JSON with cause/round/checks). Total modelled spend ~$1,490: build $704, intake $392, review $171, director $126, housekeeper $92. 1123 issues touched, 863 landed.
  
  1. [high] [premise], evidence: read
     Where: roles/intake.ts, `jobs` role=intake
     Failure: Intake is 29% of spend ($392, 968 Opus runs, $0.41 avg) before any code is written. 758 of 968 route to build with no change of path, 91 close ($21), 59 ask ($16), 16 are `done` ($4.5). 64 issues were intaken 2 to 4 times. Query: group by `extra.route`.
  
  2. [high] [design], evidence: read
     Where: roles/unit.ts:281, gates/checks.ts
     Failure: Verify returns or drops 380 builds on cause `check`. 222 of them are procedural gates, not broken code: keep-gate 132, doc-claims 91 ("no run after the last edit reads the doc"). Only ~85 are tests/oracle. Each costs a whole worker round (~$0.43, ~6 min). Query: `checkName` by state.
  
  3. [high] [design], evidence: read
     Where: gates/worker-verdict.ts, continuation.ts (fix rounds)
     Failure: Fix rounds rescue about half. Round 0 returned 356, then round 1 passed 195 (55%). Round 1 returned 153, then round 2 passed 87 (57%), dropped 61 ($18.9), waiting 27. Round-2 drops are 47 `check`, 14 `review`. A drop reruns from main and throws away three rounds of work.
  
  4. [high] [design], evidence: read
     Where: build state counts
     Failure: First-attempt builds: 53% passed, 30% returned ($258.7), 11% dropped ($26.7). Review-caused returns: 251 builds, $178 spend, 1,601 minutes. Check-caused: 258 builds, $80, 1,441 minutes. 135 of 176 drops were followed by another build.
  
  5. [high] [design], evidence: read
     Where: roles/review.ts, `reviewer`
     Failure: Opus reviews every passing build: ~560 model reviews, $158 (+ $4.2 on 83 merge runs). About 16% hold (118 of ~720 reviewed builds). Nothing records whether a hold was right. 244 of 251 review-returned issues landed later, so a hold mostly costs a round, and 79 of 172 first holds hold again after the fix. Hold precision is unmeasurable from the data.
  
  6. [medium] [detail], evidence: read
     Where: roles/review.ts, ledger
     Failure: 63 review jobs `failed` with no model and 0 s duration (e.g. job.4784). 52 gaps run `review/failed` straight to land. A failed reviewer is not counted in review cost or hold rate.
  
  7. [medium] [design], evidence: read
     Where: land/landing.ts:267 (`same`)
     Failure: Land re-runs tests when main moved. In the last 138 land logs, 74 ran the full chain checks, 40 critical-only, 24 none. `land/tests` ran 837 times, 19,136 s (5.3 h), after verify already ran `build/tests` 1,555 times for 51,291 s (14.2 h). Oracle ran 1,195 more times, 27,105 s.
  
  8. [medium] [design], evidence: read
     Where: land conflict path, rescue.ts
     Failure: Land conflicts: 113 (101 failed, 94 landed later). Each starts a worker merge build (101 runs, $9.6, 4.2 min) plus a reviewer ($4.2) plus another land. The mechanical rebase fell through 113 times first.
  
  9. [medium] [detail], evidence: read
     Where: `jobs` role=land, state=dropped
     Failure: 29 lands dropped, avg 38.5 min, max 259 min. 13 are test failures after verify and review had passed. The land queue sat idle on them.
  
  10. [high] [design], evidence: read
      Where: roles/director.ts:194 (`escalation`), director runs
      Failure: 209 director runs, $126. 54 `held-path` runs end `escalated` ($24.6), an outcome fixed by code (`heldChange`) before the model reads the case. The model only writes case text. Fable director: 87 runs, $99.8 ($1.15 each, 2.5 min) vs Opus $0.23 (0.6 min).
  
  11. [medium] [design], evidence: read
      Where: roles/director.ts, ASK_REASONS
      Failure: `run-cap` Asks: 22 Fable/Opus runs, 16 "decided". A cap of 3 runs/60 min that the director then lifts means the cap fired before fix rounds finished.
  
  12. [medium] [premise], evidence: read
      Where: routing/route.ts, models
      Failure: Size routing does not separate outcomes. First-run pass rate: sonnet/medium 0.51, deepseek/small 0.62, haiku/small 0.61, deepseek/medium 0.40 (46% dropped), opus/large 0.44 at $1.72. A classifier call (303 `routed` events) precedes each start, with no pass-rate lift shown.
  
  13. [high] [design], evidence: read
      Where: dispatch.ts, `busy`/`full` holds
      Failure: Wall time of landed issues: median 11 min, p75 23, p90 60. Total span 820 h, busy 200 h. Idle: `intake/done->build` 231.6 h over 641 issues. 615 `busy` events are file-overlap holds (docs/design.md 216, ui/views/issues.js 161), 438 `full` holds. Serialising on one file idles an issue after intake.
  
  14. [medium] [design], evidence: read
      Where: dispatch, director waits
      Failure: `director/done->land` waits median 18.5 min over 40 issues (42 h). Held-path Asks wait on Chris. 94 builds sit `waiting` ($43.2) with no worker running.
  
  15. [medium] [detail], evidence: read
      Where: records/ledger, timeouts
      Failure: 24 `timeout` builds record cost 0 (null). The real spend of 30-minute timed-out workers is missing. `land` cost is null on every row, so cost per landed issue ($1.58 avg) is understated.
  
  16. [medium] [design], evidence: read
      Where: roles/housekeeper.ts
      Failure: 239 housekeeper runs, $92.2, all Opus (~16/day), reasons like "7 applied, 0 refused". The value per run is not recorded. Inferred: some runs are no-ops.
  
  17. [low] [detail], evidence: read
      Where: `suite_history`, recheck
      Failure: The hourly suite ran 162 times (6 failed, 2 passed on rerun). 31 recheck runs ($4): 16 dropped, 13 passed. The same tree is verified again.
  
  18. [medium] [premise], evidence: inferred
      Where: premise
      Failure: 260 of 1123 issues never land ($182). 217 had zero builds and cost $119 (intake, director, housekeeper). That is spend on issues that close, ask or wait.

### Failure modes

  Review of the issue lifecycle, operational lens. 16 findings. Counts come from ~/.aleph/aleph.db and ~/.aleph/items/issues. "Standing" means an Always rule.
  
  1. [high] [premise], evidence: read
     Where: premise; jobs/lib/gates/issue-decision.ts:20; ~/.aleph/items/projects/*/project.md
     Failure: The exit map covers only `sandbox` repos. Only projects 3 and 8 are sandbox, out of 12. An issue in the other 10 gets no intake, no Ask and no director. It sits as `new` with no hold event. Issue 3134 (project.11) is 3 days old with one event (`filed`). `aleph status` shows 6 such issues (at3134, at3199-3201, co3190, a1156). `pendingCases` also skips them silently. The health lines do not cover them.
  
  2. [high] [design], evidence: read
     Where: asks/timeout.ts; settings row `timeouts`
     Failure: The `timeouts` setting is `{}`. No Ask ever times out, so every escalated Ask waits for Chris indefinitely. The explainer's "director answers, or timeout acts" path is inert. The Ask backlog is empty only because Chris is clearing it by hand: 111 escalated vs 31 director-answered.
  
  3. [high] [design], evidence: read
     Where: lib/store.ts parked; roles/followups.ts; housekeeper.ts
     Failure: Reviewer and worker follow-ups are filed as `parked: true`. Workers filed 295 since 11-10. Only 8 `unpark` events exist. 132 issues sit parked, oldest 11-11. The housekeeper "asks nobody", notes the issue and moves on. Issue 3323 shows a note and no state change. No Ask, stall line or aging view covers them. The explainer draws no parked exit.
  
  4. [high] [design], evidence: read
     Where: roles/intake.ts:366,517
     Failure: A worker-sourced, non-bug issue whose Edit surface is all tests is dropped as "test-only follow-up". Nobody is told. The data shows 24 issues closed this way, for example 3 with a reason of "the worker issue asks only...". A reviewer finding that asks for a missing test disappears. A wrong surface guess from intake drops a real fix.
  
  5. [high] [design], evidence: read
     Where: roles/intake.ts:458 (`byCode` flake); issue 1156
     Failure: A `flake` issue is closed as done with "a flake, noted on" the tracker. The tracker (1156) has 129 notes and has been open 15 days. Nothing raises it to Chris and nothing fixes it. The `flaky` table has 135 rows and `tests` is null. Many flake notes say "passes alone", and the same pile holds real order-dependence bugs. Chris's "picks from these notes" has no trigger. These are swallowed, not resolved.
  
  6. [high] [design], evidence: read
     Where: transitions/baseline.ts:20,70; gates/issue-decision.ts:105
     Failure: A red baseline record stays red until a suite run on a moved main. Main only moves if the red-main issue lands. A flaky red does not rerun on the same commit. Red-main spells: ~25 hours on 11-02/03 (112 `red` hold events in one hour). Every non-red-main issue is blocked. If the red-main fix fails or is dropped, nothing clears the block. The 6 failed suites of 162 include flakes.
  
  7. [medium] [design], evidence: read
     Where: gates/firefighter.ts:160-181
     Failure: An unlanded red-main issue is closed as done when a later green CI run exists. The test is "a green run past its failing commit". A flake-red critical issue closes "done" with no fix. A fix run may already be in flight.
  
  8. [high] [design], evidence: read
     Where: land/rescue.ts:395-415
     Failure: A worker's "already met" claim plus a green main closes the issue as done. Green means the whole suite is green. It does not mean the claim is true. The check is "unchecked baseline waits": a repo with no record or a failed fetch returns silently, logging `waiting` each tick (476 `waiting` events with no detail). Issue 2892 was closed "Met on main". The real cause was missing `sandbox: true` in config, a config change that Chris applied by hand.
  
  9. [high] [design], evidence: read
     Where: settings `always` (rescue, question, blocker-dropped = resolve); rescue.ts:329, intake.ts:395
     Failure: The standing rescue rule drops and reruns the run, so "rescue once per issue" holds only without it. The "same case again" Ask also recommends Rerun, which the rule takes. The run-cap is the only bound. Issues 2955, 3203 and 539 were rerun 7 times each (115 rescue reruns). Standing question-resolve takes the recommended option and leaves the issue unsorted. Intake re-runs on it, one Opus run per round, with no cap.
  
  10. [high] [design], evidence: read
      Where: issues/lib/issues.ts:98-107; gates/issue-decision.ts refDone
      Failure: Standing blocker-dropped=resolve strips the dependency when a blocker is dropped, so the waiter starts without it. 9 non-dropped issues still point `after` at dropped 920. A parked waiter later unparked has no Ask, because the Ask is only set when the blocker is dropped. A dropped ref is not "done", so the `after` gate holds it forever (inferred). An `after` on a nonexistent id counts as done when the list was read (refDone, `listRead && item === undefined`).
  
  11. [medium] [design], evidence: read
      Where: roles/intake.ts:370; apply() "waits" filter
      Failure: Intake silently drops an `after` link to an open issue that has an Ask. The dependency is lost without any note. The waiter then runs before its prerequisite is answered.
  
  12. [medium] [design], evidence: read
      Where: asks/ask.ts:354-368 (part-dropped); transitions/sweep.ts:52-60
      Failure: Any part-dropped answer other than "Keep open" closes the parent as done, with nothing built. `finished()` also closes a parent as done when some parts are dropped and one is done, with no Ask. The Ask fires only when the last open part is dropped. Seen in 2 of 96 parents. The reasons given were duplicates.
  
  13. [medium] [design], evidence: read
      Where: roles/director.ts:56,203,692,706; gates/factory-status.ts:237
      Failure: The director gets one run per Ask. A failure ("the director timed out", 8; "did not decide", 11) writes a fallback case with no recommendation and sends it to Chris. A credit outage or backend hold therefore escalates every new Ask. `no-commit` is not in ONCE_PER_ISSUE, so continue can repeat, bounded only by run-cap. After a run-cap continue, `capMarked` clears on the next `started`. The hour count still applies and a new run-cap Ask follows. Issue 3054 (parked) names this loop.
  
  14. [medium] [detail], evidence: read
      Where: roles/intake.ts:543-548; gates/intake-decision.ts:24
      Failure: Intake checks only `full` and `paused`. It ignores the backend credit hold and red main for "take-in". A credit-cause run is not counted as "unanswered", so it never reaches intake-failed. It retries every tick. 46 intake skips on 11-17/18 read "5 agent runs are live". Intake shares the cap with workers and starves behind them.
  
  15. [low] [detail], evidence: read
      Where: ledger `jobs`
      Failure: job.9126 (review, 11-15) and job.10073 (land, 11-17) are still `running`, but their issues 1685 and 3266 are closed done. The 30-minute land-stall alert did not clean these up. 109 `waiting` runs since 11-01 all belong to closed issues. Stale rows add noise to counts.
  
  16. [medium] [detail], evidence: read
      Where: spec questions (rescue.ts:343); explainer
      Failure: "Run asked, no commit" waits for a spec edit. The director is refused, the standing rule is skipped and timeouts are `{}`, so only Chris can clear it. Vocabulary is large: 12 Ask reasons, 12 causes, 9 rescue paths (7 cases plus killed and lost), 10 stages, and 3 of the 12 reasons are never timed. The card offers unlike verbs: continue/discontinue, approve/disapprove, resolve/dismiss, with `Rerun` hiding inside `resolve`. A human cannot tell what "resolve" does without opening the card.
  
  Not checked: whether the 2 ghost `running` rows count toward the live cap; spec edits during a run beyond reading `worker-verdict.ts:324` (the Oracle appears to read a per-run snapshot, unverified).

### Reliability

  Reliability review. All code cites are under /home/crsmi/aleph. Data comes from a read-only query of ~/.aleph/aleph.db (events 2026-09-26 to 2026-11-19, 10333 jobs).
  
  1. [high] [premise], evidence: read
     Where: events on issue.3203, 2026-11-18
     Failure: The premise fails for an Ask answer. Chris answered at 19:34:51 and the next start came from a `missed` event at 19:36:23. Again: answered 21:20:30, missed 21:22:29, then started. Of 43 `missed` events, 35 are `ingest:`. The sweep is a main path for these steps, not a net. The issue sits 1.5 to 2 minutes each time.
  
  2. [high] [premise], evidence: read
     Where: jobs/lib/transitions/stall.ts:21-22, tick.ts:177-179
     Failure: The sweep flags `issue:` keys only when no build run is live. It flags `land:` keys only when no land is live in any repo. A dropped start is invisible while any other work runs. A key that stays stalled is dispatched once: `missed` leaves `s.missed` only when the key clears, so a persistent stall gets one dispatch.
  
  3. [high] [design], evidence: read
     Where: jobs/lib/transitions/tick.ts:229-231, 262
     Failure: The sweep is one step of the tick. A tick that finds the `tick` lock busy runs nothing. The maintainer (model calls) runs in the same tick, so a long maintain pass can leave the net idle. I did not measure tick length.
  
  4. [high] [detail], evidence: read
     Where: job.10073 (land, issue.3266), `~/.aleph/jobs/10073`
     Failure: The land row is `running` with no `pid`, no `exit` and no `ended`, more than a day old. The folder holds only `log.txt`. Issue 3266 was held by "job: job.10073" from 23:30 to 00:05, 44 minutes. No `missed` event was logged. `processState` calls this `lost` after 120 s, and the rescue should have marked it, but it never did. The cause is unknown.
  
  5. [medium] [detail], evidence: read
     Where: jobs/lib/land/rescue.ts:376-379, transitions.ts:344, job.9126
     Failure: A lost or killed run is set to failed, but its `review` row is not closed. `drop` closes review rows. job.9126 has been `running` since 2026-11-15, after its build job.9123 was rescued as lost.
  
  6. [high] [design], evidence: read
     Where: jobs/lib/land/rescue.ts:345-351
     Failure: An Always "Rerun" drops the run and does not call `markRescued`. It bypasses the once-per-issue rule. issue.3203 had 7 Always reruns and issue.2955 had 6. In the 3203 run, 3 reruns came in 12 minutes (18:47 to 18:59) before the run-cap Ask fired.
  
  7. [medium] [detail], evidence: read
     Where: jobs/lib/transitions/transitions.ts:366
     Failure: `startIssue` logs the `started` event before `startJob`. A refused start (full, waiting, job busy) still logs it. A `started` event clears the rerun note (continuation.ts:143-146) and clears `capMarked` (factory-status.ts:237-240). The note is lost and the run-cap Ask can fire again.
  
  8. [medium] [detail], evidence: read
     Where: jobs/lib/roles/director.ts:576-580
     Failure: The director writes the rerun note after `ports.drop` returns. Rescue writes it before the drop. A dispatch between the two steps starts the issue with no note. If `verbs.edit(after)` fails after the drop, the issue reruns at once with no `after`.
  
  9. [medium] [detail], evidence: read
     Where: jobs/lib/transitions/transitions.ts:322-324, 228
     Failure: `drop` reads `runs` and `last` before it takes the job lock. A run started in between is neither stopped nor dropped. `land` does `openJob(name)?.at(-1)!` before its lock, so a missing job throws a TypeError, not a refusal.
  
  10. [high] [design], evidence: read
      Where: jobs/lib/land/landing.ts:322-343, 125
      Failure: The land holds the job lock and the per-repo `land-<repo>` lock across `writeTitle` (a model call), the checks and the push. `landTurn` waits with `Infinity` and a land has no time box. Lands run long: 19 lands exceeded 1800 s, and job.7488 ran 4476 s. One hung check blocks every land in the repo.
  
  11. [medium] [design], evidence: read
      Where: jobs/lib/roles/unit.ts:142, jobs/lib/records/ledger.ts:312-327
      Failure: `admit` has no timeout and no failure path. A run waiting for load keeps its `pid`, so it counts as live and holds a cap slot. The 1800 s time box does not apply to it. Nothing here shows a stuck case in the data.
  
  12. [medium] [detail], evidence: inferred
      Where: jobs/lib/land/landing.ts:398-407, 346-351
      Failure: A fetch failure after a push error returns `fail("infra")`, though the push may have landed. Only a rescue "land again", once, and the Job-trailer check recover it. If `settled()` throws after the push, the rest of the batch is skipped, with no `batch.json` for members. A failed `closeAndFile` leaves a manual check with no filed issue, and no one is told.
  
  13. [medium] [detail], evidence: inferred
      Where: lib/store.ts:259-300
      Failure: `writeList` retries on a refused push and re-runs `change`. If the push reached the remote but the client saw an error, a filing is written twice.
  
  14. [low] [design], evidence: read
      Where: lib/store.ts:290-296
      Failure: The git store and the SQLite state are written separately. A crash between them leaves a closed issue with a live Ask row. `clearDeadAsks` (tick.ts:153) repairs it later.
  
  15. [medium] [design], evidence: inferred
      Where: lib/locks.ts:17-33
      Failure: A lock is stale only when its pid is dead. The check does not read the command line, as `processState` does. A recycled pid keeps a dead holder's lock alive for as long as that process lives, and for ownerless locks 60 s. A reboot clears the tmpfs.
  
  16. [medium] [design], evidence: read
      Where: jobs/lib/transitions/dispatch.ts:60-74, 109, 121
      Failure: Each dispatch runs the rescue loop (60 s lock wait per job, then `land` waits up to 120 s on the `dispatch` lock) and then the land batch, before any issue starts. `route()` is a model call made under the issue lock, whose wait is 20 s. Logs show "another dispatch is starting it" skips (6 hits in dispatch logs). Those skips wait for the tick, and see finding 2.
  
  17. [medium] [detail], evidence: read
      Where: jobs/lib/transitions/kept.ts:37-38, 82-85
      Failure: `startKept` removes the `paused-next` file before it starts the step. A crash after the removal loses the step. The run still holds `next`, so it is not an error, and `stalled()` never reports a pending `worker` step. When `start` throws, the catch clears `next`, and the cause appears only in `dispatch.log`.
  
  18. [low] [detail], evidence: read
      Where: jobs/lib/gates/holds.ts:80-96
      Failure: `holdIssue` and `holdBackend` read, then write, with no transaction. A concurrent `probeHold` that clears the hold can be undone. This also allows a double alert.
  
  19. [low] [detail], evidence: read
      Where: jobs/lib/transitions/tick.ts:180, lib/naming.ts:169-172
      Failure: 42 of 43 `missed` events carry the whole key (`ingest:issue.3282`) as the object and a null detail. `missedOf` splits the key. These events are absent from the issue's own timeline.
  
  20. [medium] [detail], evidence: inferred
      Where: jobs/lib/roles/unit.ts:302
      Failure: `fileFollowups` runs before the verdict. If the run fails and is rerun, the followups may be filed again. I did not read `followups.ts` for deduplication.
  
  21. [medium] [design], evidence: read
      Where: jobs/lib/roles/unit.ts:140-171, jobs/lib/infra/settings.ts:90-104
      Failure: The 1800 s limit covers only the worker call. Setup (up to 300 s on the lock), `admit`, each 1200 s check and the 600 s review sit outside it. 92 build runs lasted more than 1800 s and 5 lasted more than 4 h. Those I inspected were mostly dropped late.
  
  22. [medium] [design], evidence: read
      Where: ~/.aleph/aleph.db, jobs/lib/asks/timeout.ts:30
      Failure: 216 jobs are `waiting`. 215 of them have no row in `issue_state`, and 125 are older than 14 days. The timeout, the director and `clearDeadAsks` read only Ask rows. Many of these are old non-factory jobs. A held-path or core-change Ask has no timeout by design.
  
  23. [medium] [detail], evidence: read
      Where: ~/.aleph/aleph.db, job.7329
      Failure: The job stayed open for 59856 s after its issue was dropped (reason: "the job stayed open"). No sweep closes an open job whose issue is already closed.
  
  24. [low] [detail], evidence: read
      Where: jobs/lib/roles/unit.ts:168-171
      Failure: The next step starts only after the trace post and the news (10 s timeout each). A kill in that window loses the direct start, and finding 1 shows what the sweep does then.
  
  Not verified: the cause of finding 4, the `ledger.ts` body beyond `admit` and `realTell`, `followups.ts`, and tick duration. Nothing was written.

## The plan: a3324 to a3330

Issue text as filed, before the drop.

### a3324. Delete the mechanical rebase from the land
dropped   source agent   priority medium   updated 2026-11-19T09:54:00.203Z
after -   refs -   areas ci, jobs, issues
ask -

#### Request

The land tries a mechanical rebase before a merge run on a conflict (jobs/lib/land/landing.ts:171, :222, :305). Every retained job log shows '## mechanical rebase: conflicts' (123 times) and none shows 'ok' (grep over ~/.aleph/jobs/*/log.txt, 2026-11-19). The step never saved a merge run, so a conflict goes straight to the merge run. Source: red-team of the issue workflow, 2026-11-19.


### a3325. Delete the no-answer timeout setting and its controls
dropped   source agent   priority medium   updated 2026-11-19T09:53:31.343Z
after -   refs -   areas cleanup, asks
ask -

#### Request

The timeouts setting is {} in ~/.aleph/aleph.db (read 2026-11-19), so jobs/lib/asks/timeout.ts, 'aleph always timeout', the Gates page control and their tests have no user. PRINCIPLES.md 7 also rules out waiting on a timer. Remove the setting and every path that reads or writes it; an escalated Ask waits for Chris as it does today. Parked a2997 and a3315 touch this code and become moot. Source: red-team of the issue workflow, 2026-11-19.


### a3326. Send held-path Asks to Chris without a director run
dropped   source agent   priority medium   updated 2026-11-19T09:53:35.292Z
after -   refs -   areas speed, efficiency, asks, jobs, improve
ask -

#### Request

Code decides a held-path Ask's outcome before the director reads it: a security path or bun.lock must wait for Chris (jobs/lib/roles/director.ts escalation, heldChange). 78 director runs ended 'escalated' for $37.4 (jobs table, role=director). Where code already fixes the outcome, skip the director run and give Chris the code-written case text at once, as a 'user' Always rule does today. The director still runs for a held glob it may land. Source: red-team of the issue workflow, 2026-11-19.


### a3327. Count an Always rerun toward the once-per-issue rescue
dropped   source agent   priority medium   updated 2026-11-19T09:53:39.113Z
after -   refs -   areas ci, jobs
ask -

#### Request

An Always 'resolve' on rescue drops the run and reruns the issue without the once-per-issue mark (jobs/lib/land/rescue.ts:345-351). The rule stands since 2026-10-29. Issue 3203 reran 7 times and 2955 6 times; only the run-cap stopped them. A second rescue on the same issue must set a rescue Ask even with the Always rule. Source: red-team of the issue workflow, 2026-11-19.


### a3328. Give each land run a time box
dropped   source agent   priority medium   updated 2026-11-19T09:53:43.197Z
after -   refs -   areas perf, ci, issues, improve
ask -

#### Request

A land holds the job lock and the per-repo land lock with no time limit (jobs/lib/land/landing.ts:322-343; landTurn waits with Infinity). 19 lands ran over 1800 s and job.7488 ran 4476 s, and one hung check blocks every land of the repo. A land past its limit stops as a failed land like any other. Source: red-team of the issue workflow, 2026-11-19.


### a3329. Write land check titles before taking the land lock
dropped   source agent   priority medium   updated 2026-11-19T09:53:47.086Z
after -   refs -   areas speed, efficiency, perf, ci, jobs, improve
ask -

#### Request

The land calls writeTitle, a model call, inside the per-repo land lock (jobs/lib/land/landing.ts:343, checkTitles). Every land of the repo waits on that call. Write the titles before the lock is taken. Source: red-team of the issue workflow, 2026-11-19.


### a3330. Skip the intake run when the request holds a valid spec
dropped   source agent   priority medium   updated 2026-11-19T09:53:50.872Z
after -   refs -   areas speed, efficiency, perf, jobs, routing, improve
ask -

#### Request

Intake spent $392 in 15 days (29% of factory spend); 758 of 968 runs only routed to build (jobs table, role=intake). When an issue already carries a spec that the spec check (problems() in jobs/lib/roles/intake.ts:227) accepts, take it in by code with no model run. Source: red-team of the issue workflow, 2026-11-19.

## Round 2 synthesis

Three of the four second-round reviewers sent reports. The claims-and-measurement reviewer was stopped before it reported. The full text is under Round 2 reports. Below are their findings, grouped by issue. The reviewers are marked **C** (correctness), **O** (operational) and **Y** (YAGNI and givens). Severity is shown as `[f]` fatal, `[h]` high, `[m]` medium and `[l]` low.

### a3329: write titles before the land lock
- [f] C: `writeTitle` is `fit("", source)`, a plain string cut, not a model call (`jobs/lib/roles/title.ts:6`). The change gains nothing.
- [h] C, O: the batch members are known only after the lock, in `queuedLands` (`jobs/lib/land/landing.ts:340`). A title written before the lock covers only the leader.
- [m] O, Y: a title written early is wasted when the land fails. Y also notes that the issue gives no count of the lands it affects.

### a3328: put a time box on lands
- [h] C, Y: this goes against PRINCIPLES.md 7, "Load never causes a failure". The plan also cites rule 7 to delete a timer in a3325, so it contradicts itself.
- [h] C: `rescueCase` excludes land timeouts (`jobs/lib/land/rescue.ts:196`), so every timed-out land would become an Ask.
- [h] C: each check already has a 1200 s limit. The 4476 s land is likely re-runs of the check split, not a hang.
- [h] O: if the box kills the land in the middle of `git push`, `closeItems` never runs. A SIGKILL also skips the `finally` that releases the locks, and child test processes stay behind.
- [m] C, O: the box must not count the time a land waits in the queue at `landTurn` (`Infinity`), and the issue does not say so. The 30-minute `askSlowLands` rule also overlaps the new box.
- [h] Y: the real cause is one lock held across every check. a3328 and a3329 share that cause.

### a3326: send held-path Asks to Chris by code
- [h] all three: the premise is wrong. `escalation()` already escalates every `heldChange` hit, held globs included (`jobs/lib/roles/director.ts:200`).
- [h] all three: the 78 runs and $37.4 are the director's own escalations across every Ask reason. They do not measure held-path Asks.
- [h] C, O: Chris loses the director's case text and gets only the code fallback text instead.
- [h] C: a skip outside `direct()` bypasses the `director-<on>` lock, `record()` and the `ONCE_PER_ISSUE` bookkeeping.
- [m] O: an Ask can be left with no text and no buttons on the Status page.
- [m] C: the split for a branch that cannot be read is lost (`jobs/lib/roles/director.ts:203`).
- [m] Y: a smaller option is a `user` Always rule for `held-path`, which needs no code.

### a3330: skip intake when the spec is valid
- [h] all three: `problems()` takes a structured `Spec` or a `Route`, not issue text. No parser exists, and parsing prose goes against rule 9.
- [h] C, O, Y: the change skips the duplicate check, the done-on-main check (`mainSince`), the removal Ask, the split into parts and the `plan` check (`planSet`).
- [h] C: in a repo without `author`, an issue with a spec already skips intake (`isSorted`). The 758 runs are not shown to have started from a valid spec.
- [m] O, Y: the $392 is not split by whether a spec was present. Two cheaper options are a cheaper intake model, or a spec check when the issue is filed.
- [m] C: the file check reads `origin/<main>`, not the fresh clone.

### a3327: limit Always reruns to once per issue
- [h] O: if the change only sets the mark, the Always rule matches again on the second rescue and reruns forever.
- [m] C: the fix must skip the Always rule when `earlier` is true. `chris()` does not receive that flag.
- [m] C: a second site exists. The stored `rescue: resolve` rule fires at `jobs/lib/roles/director.ts:679` too.
- [h] Y: a smaller fix deletes the Always `resolve` branch at `jobs/lib/land/rescue.ts:345`, because the run cap and `ONCE_PER_ISSUE` already exist.
- [m] C, O: the 7 and 6 reruns are not traced to the rule. Two issues are the only evidence.
- [m] O: every issue that fails twice would then reach Chris as an Ask, which is the outcome his rule exists to stop.
- [m] O: the new mark key can double-count with the `lost` and `killed` keys.

### a3325: remove the Ask timeout
- [m] C, O: `{}` means no timeout is set, not that none is wanted. Removal also deletes the `takeOnTimeout` lander path.
- [m] C: rule 7 is a weak ground for the removal.
- [h] O, [m] C: the reach is wide. It covers the `timeout` tick step, `dueAt`, the gates API, the CLI, the tests and 4 to 5 docs. A partial delete breaks the import of `ui/state.ts`.
- [l] C, O: a3315 is a real hole, a timeout that lands a held path. Closing it as "moot" hides that if the removal is dropped.
- [l] Y: the change itself is sound. Check for other readers of the `timeouts` setting first.

### a3324: delete the mechanical rebase
- [m] all three: the count of 123 conflicts and 0 successes comes only from the logs that remain. Deleting the rebase saves one `git` replay per conflict, not merge runs or money.
- [m] C, Y: `jobs/lib/land/landing.merge.test.ts:18`, `docs/workflow.md:186` and the doc comment in `jobs/lib/land/landing.ts` must change too.
- [m] O: `tips.set` feeds the later `fork` and `subjects` lines, so check that the squash subjects stay the same.
- [l] C: no invariant breaks. This is sound cleanup.

### Whole plan
- [h] Y: the plan takes the easiest findings, not the biggest. It leaves out:
  - the parked pile (132 issues) and the flake pile (129 notes);
  - the ghost `running` rows;
  - the sweep as the main ingest path;
  - the tests that run three times;
  - the size router.
- [m] Y: four of the seven issues add code, and only a3324 and a3325 delete it. Rule 5 is "remove before you add".
- [m] O: a3325, a3326 and a3327 all touch the Ask path, and a3324, a3328 and a3329 all edit `jobs/lib/land/landing.ts`. With no landing order, they conflict.
- [l] O, Y: no issue names a check that shows its change worked.

This session has compacted, and the handoff is saved at `/home/crsmi/.aleph/handoffs/projects/aleph.md`. Run `/clear` to continue in a fresh session.

## Round 2 reports

### Correctness and concurrency

1. [fatal] [premise], evidence: read
Where: a3329, jobs/lib/roles/title.ts:6, :56, :60
Failure: The issue says writeTitle is a model call. It is not. `writeTitle` is `fit("", source)`, a pure string cut (`cutTitle`), and the file header says "no model call". The lock holds no model wait, so the change buys nothing.

2. [high] [design], evidence: read
Where: a3329, jobs/lib/land/landing.ts:336-343
Failure: Even if the call were slow, the batch members are chosen by `queuedLands` after `landTurn` takes the lock. A pre-lock title can cover only the leader's own run. Queued members' titles would need a persisted handoff, which the issue does not state.

3. [high] [premise], evidence: read
Where: a3328, jobs/lib/gates/checks.ts:92, :178, :241; jobs/lib/infra/settings.ts:94
Failure: Each check already has a `checkSeconds()` limit (1200 s). "One hung check blocks every land" is overstated. The 4476 s land is likely the sum of split-in-half re-runs (landing.ts:299-303), not a hang. The issue shows no trace of a hang.

4. [high] [design], evidence: read
Where: a3328, PRINCIPLES.md:46-47
Failure: "Load never causes a failure: work waits in a queue." A fixed land limit turns a loaded host into a failed land. The 19 lands over 1800 s may be valid slow passes, and they would now fail. No limit value is given.

5. [high] [design], evidence: read
Where: a3328, jobs/lib/land/rescue.ts:196
Failure: `rescueCase` excludes a land with cause `timeout` (`cause === "timeout" && r.role !== "land"`), so the result is no case. Rescue then sends an Ask to Chris on every time-boxed land. The issue says "like any other" and names no cause. `infra` reruns forever instead. `check` fails under a wrong label.

6. [high] [design], evidence: inferred
Where: a3328, landing.ts:322-343, :386
Failure: `git push` and the checks are synchronous, so an in-process timer cannot fire between them. A kill from outside can fire after the push and before `settled()` closes the issue. The "already on main" path (landing.ts:367) recovers that. A timer that only flips the verdict leaves the check children running and a later push possible.

7. [medium] [design], evidence: read
Where: a3328, landing.ts:122-131, :327
Failure: If the box wraps the whole `land()` call, it includes `landTurn`, which waits with `Infinity` and `phase("queued")`. Queued lands would time out while they wait. Queue wait must be outside the box, and the issue does not say so.

8. [high] [premise], evidence: read
Where: a3326, jobs/lib/roles/director.ts:200-210
Failure: `escalation()` calls `heldChange(b.repo, b.branch)` with the default `repo.held`, so a held glob is already on the list. The issue's "the director still runs for a held glob it may land" is wrong for any Ask with an `approve` action. Only the held-path Always rule (director.ts:683) lets a glob through. Code-forced and glob-held cases are the same set.

9. [high] [premise], evidence: read
Where: a3326, director.ts:720-724
Failure: A run ends with the bare string "escalated" only when the model chose `escalate`. A code-listed Ask ends "escalated: the Ask is on the escalation list". The 78 runs / $37.4 count is the model's own escalations, across all reasons. It does not measure held-path runs.

10. [high] [design], evidence: read
Where: a3326, director.ts:208 (`fallback` text), :677
Failure: The director writes the case text Chris reads (situation, effects). The code fallback has no diff analysis. The `user` Always rule is a standing choice by Chris. This change takes that choice away for every held Ask, with no opt-in.

11. [high] [design], evidence: read
Where: a3326, director.ts:667-679, :723
Failure: A held-path skip outside `direct()` bypasses the `director-<on>` lock (`lock(lockName(...), 0)`). It races a run that is already open on the same Ask. It also skips `record()` (the `protected` sub with `file`) and the `escalatedBefore` and `ONCE_PER_ISSUE` bookkeeping. The held state is read when the Ask is raised. Branch changes after a worker rerun make the text stale.

12. [medium] [detail], evidence: read
Where: a3326, director.ts:203-206
Failure: A branch that cannot be read (`unknown`) escalates only for `held-path`. Other reasons go to the director. A by-code route must keep that split or it sends Asks to Chris that now go to a run.

13. [high] [premise], evidence: read
Where: a3330, lib/store.ts:366-372 (`isSorted`); jobs/lib/gates/intake-decision.ts:23
Failure: In a repo without `author`, an issue with a spec is already sorted, so intake skips it. Intake runs on a spec only in an `author` repo, where the spec is an authored claim and the prompt tells the run to "Keep what is right in it, and fix what the rules below find wrong". The 758 route-only runs are not shown to have started from a valid spec.

14. [high] [design], evidence: read
Where: a3330, jobs/lib/roles/intake.ts:227-249, :378-411
Failure: `problems()` checks the format of the spec, not whether the issue is done, a duplicate, stale or too big for one run. It cannot check `close`, `done` or the undo-a-removal Ask (intake.ts:323). A by-code build skips all of these and skips splitting into parts. `byCode` and `apply` do not carry `testOnly`, `stillRed`, or the Ask on a `build` with a `removal`.

15. [high] [design], evidence: read
Where: a3330, intake.ts:124, :227
Failure: `problems()` takes a structured `Spec`, and an issue holds spec text. No parser from text to `Spec` exists in `issue-spec.ts`. The `after` refs, which the model supplies, would come only from `afterOf(item)`. The model's `left_out` note would be lost.

16. [medium] [detail], evidence: read
Where: a3330, intake.ts:195, :205, :218; intake.ts:497
Failure: `onMainTree` reads `origin/<main>` in the repo, but the run reads a fresh clone. A spec older than the last main move can pass the file check and still be wrong. It is accepted with no read of the code. The `intake-<name>` lock stays held by `byCode`, so it does not race, but the repeat is not defined: nothing marks an issue taken in by code when `setIntake` fails.

17. [medium] [premise], evidence: read
Where: a3325, ~/.aleph/aleph.db settings
Failure: `timeouts` is `{}` (read). That shows no timeout is set today, not that none is wanted. `takeOnTimeout` (tick.ts:200) is the only caller that lands with `lander: "timeout"`. Removal drops that capability by decision, with no one else deciding.

18. [medium] [premise], evidence: read
Where: a3325, PRINCIPLES.md:46-47
Failure: The cited rule says work never waits for a timer, and the timeout acts after an Ask waits. It is a weak ground for removal.

19. [medium] [detail], evidence: read
Where: a3325, ui/state.ts:29, :297; ui/asks.ts:36; ui/api/gates.ts:7-11, :64, :82; cli/commands.ts:30, :457; ui/gates.test.ts:184-199; jobs/lib/asks/timeout.test.ts; docs/workflow.md:263-278; docs/observability.md:43, :70; docs/data-model.md:209
Failure: The change reaches `dueAt`, the awaiting `due` fields, the gates API, the CLI, the tests and 4 docs. The stored `timeouts` row stays in the db unless a migration drops it. `ACTED` events in history lose their meaning. The `Waiting` type is shared with `issueAsks`.

20. [low] [detail], evidence: read
Where: a3325, a3315 (read)
Failure: a3315 describes a real hole: a timeout approve lands a security path with no held check. Removal closes it only because the whole path goes. If the removal is dropped, the hole stays, and "moot" hides that.

21. [medium] [design], evidence: read
Where: a3327, jobs/lib/land/rescue.ts:335-345, :399, :429
Failure: `chris()` is called for the "again" cases (`earlier` true, lines 410, 419, 432), where the first rescue already set `markRescued`. The Always rule at :345 then drops and reruns before the Ask is written, so the mark is never the gap. The gap is that `chris()` takes Always for every Ask it builds. The change must make the Always rule skip when `earlier`, which `chris()` does not receive. The issue's wording ("without the once-per-issue mark") points at the wrong place.

22. [medium] [design], evidence: read
Where: a3327, jobs/lib/roles/director.ts:56, :200-201
Failure: A second `rescue` Ask on an issue already goes to Chris when the director decided the first (`ONCE_PER_ISSUE`). With a stored `rescue: resolve` rule (db, set 2026-10-29), the director's first-verb path (director.ts:679) also takes `resolve` with no run. The rescue Ask can be resolved by rule at a second site, so fixing :345 alone leaves a second rerun path.

23. [medium] [detail], evidence: read
Where: a3327, rescue.ts:345-351 (`always("rescue", repo.key)`); a3327 request
Failure: "7 reruns" for 3203 and "6" for 2955 are not traced to the rule. Reruns also come from `killed`, `lost` and `land-checks` steps that never reach `chris()`. A run cap that stopped them says nothing about the rule being the cause.

24. [medium] [premise], evidence: read
Where: a3324, jobs/lib/land/landing.ts:171-186, :222; landing.merge.test.ts:18-24
Failure: The log shows 0 `ok` in 123 `conflicts` (re-grepped: 123, all conflicts). That counts only logs that remain. A merge run's branch holds a merge commit, so `rebased` returns null at once. The test at landing.merge.test.ts:18 asserts "mechanical rebase: ok" and must go. docs/workflow.md:186 and the `land` doc comment (landing.ts:287) say the worker wakes only when the rebase conflicts. The code is cheap, so removal is cleanup, not a speed gain.

25. [low] [detail], evidence: read
Where: a3324, landing.ts:222-228, continuation.ts:153-188
Failure: The replay changes only the in-memory tip, not the branch, so no review is invalidated. `BOUNCES` counts runs with `conflicts`, which are unchanged. No invariant breaks. The issue's claim that it "never saved a merge run" holds for the logs kept, and says nothing about earlier runs.

### Failure modes

Findings (read-only; I read the issues and the code under jobs/lib, ran nothing). Not checked: git history, the job logs behind the quoted counts, lock.ts stale-lock handling.

1. [high] [premise], evidence: read
   Where: issue a3326, jobs/lib/roles/director.ts:199-211, :727
   Failure: The issue says the director "still runs for a held glob it may land". `escalation()` puts every `heldChange` hit, including repo `held` globs and bun.lock, on the escalation list. The director run for such an Ask already cannot land it. The issue's split between "fixed outcome" and "director may land" does not match the code. The 78 'escalated' runs are all outcomes, not only held-path Asks, so the $37.4 saving is unattributed.

2. [high] [design], evidence: read
   Where: issue a3326, director.ts:224-226, :703-705
   Failure: The 'user' Always path calls `escalate(..., undefined, ...)`, which writes a code fallback text. The director's case text (situation, recommendation, diff reading) is what Chris decides from today. Chris loses it on every held land. The issue calls the fallback equal to a director case but names no check for that.

3. [medium] [detail], evidence: read
   Where: issue a3326, director.ts:660-666, `pendingCases`
   Failure: A code-written escalation must write case text and a `record()` decision with `outcome: escalated`. The Status page shows buttons only after that record exists. A new path that skips `direct()` can leave an Ask with no text and no buttons. Nobody is told, because `writeCaseText` failure only logs.

4. [high] [design], evidence: read
   Where: issue a3327, rescue.ts:345-351, :381, :399
   Failure: The Always check runs first in `chris()`, before `askFromRun`. If the Always rerun only sets the mark, the second rescue calls `chris()` again and matches the Always rule again. It reruns forever. The change must bypass the rule for a marked issue, and the issue does not say so.

5. [medium] [premise], evidence: inferred
   Where: issue a3327
   Failure: Chris set the rule so as not to be asked. After the change, every issue that fails twice gets a rescue Ask. The cost (Asks Chris did not want) is not set against 7 reruns on 3203 and 6 on 2955, which the run-cap already stops. Two issues are the whole evidence.

6. [medium] [detail], evidence: read
   Where: issue a3327, rescue.ts:381, :399, `rescued()`
   Failure: Lost and killed runs already count once per issue, by key `lost`. The Always rerun is a third key. A run that is lost after an Always rerun may count twice, or never, depending on how the mark key is chosen. The issue does not say which.

7. [high] [design], evidence: read
   Where: issue a3328, landing.ts:322-343, :432-434
   Failure: A land killed by the time box in the middle of `git push` leaves the remote either pushed or not. If pushed, `closeItems` and `removeBranch` never run, so the issue stays open. The rescue's "land again" then finds "item landed" or "no net change" (`landing.ts:380-390`). That works only when the checked-in lookup `hit` still matches. This is the double-push case and nothing tests it.

8. [high] [design], evidence: read
   Where: issue a3328, landing.ts:122-133, :432-434
   Failure: The locks release in a `finally` in-process. A time box that kills the process (SIGKILL) skips the `finally`. The repo land lock then depends on lock-file staleness, which I did not read. A hung check also leaves child test processes behind. A land killed mid-batch leaves queued members with no `batch.json` and no verdict. They take over after the next `landTurn`, but the issue does not say whether they are failed or retried.

9. [medium] [premise], evidence: inferred
   Where: issue a3328, `landTurn` Infinity wait
   Failure: 19 lands over 1800 s and one at 4476 s may be queue wait, not run time, since `landTurn` waits with no limit. A box that counts wall time from `made` fails innocent lands behind a slow one. A box that counts only after the lock leaves the queue unbounded. The issue picks neither.

10. [medium] [detail], evidence: read
    Where: issue a3328, landing.ts:171-205, rescue.ts:13
    Failure: A land that fails by time box becomes a failed land, so rescue handles it as an "infra" or "other" land and reruns it "once". A hung check will hang again. The second time reaches Chris's Ask. The 30-minute `askSlowLands` rule in rescue.ts already exists and overlaps the new limit. Which of the two wins is unstated.

11. [medium] [design], evidence: read
    Where: issue a3329, landing.ts:340-343, :346-350
    Failure: `members` is only known after the lock, since `queuedLands` runs inside it. Titles written before the lock cover the leader only. Batch members' titles are still written inside the lock, or are missing. The change cannot do what it says without a new pre-lock scan, which races with the batch.

12. [low] [detail], evidence: read
    Where: issue a3329, landing.ts:343
    Failure: Titles are written for every `check === "open"` run, including runs that then fail the land (conflict, checks). Those are wasted model calls. The call also happens once, before the attempt loop, so the retry loop does not repeat it. Moving it earlier adds waste only when the land fails.

13. [high] [premise], evidence: read
    Where: issue a3330, intake.ts:227-248
    Failure: `problems()` takes a `Route` the model returned, not an issue. A spec in an issue body is text with no route, no `after` list and no parts. The issue does not say how a request spec becomes a `Route` by code. Intake also does the split decision, the duplicate and "already done on main" check (`openIssues`, `mainSince`), red-main questions and the title rule. A by-code path skips all of them. A valid spec for an issue that main already did gets built, and that costs more than the intake run.

14. [medium] [premise], evidence: inferred
    Where: issue a3330
    Failure: 758 of 968 intake runs "only routed to build". These are probably runs on issues with no spec, where intake wrote the spec (`aleph issue add` without `--spec`). Skipping intake only when a valid spec exists may match few of the 758. The $392 is not split by spec present or absent. Nobody says how many issues have a valid spec today.

15. [medium] [design], evidence: read
    Where: issue a3330, intake.ts:241
    Failure: Specs written by the director, split parts and followups carry `plan` or "time box" flags. `planSet(item)` makes `problems()` refuse a single spec. A by-code path must replicate that check and the parts rules (`after` lists, 1 to 6 parts). Otherwise it builds the over-large issue that was meant to be split.

16. [high] [design], evidence: read
    Where: issues a3325, a3315, a2997, tick.ts:42, :196-213, :281; ui/state.ts:29, :113; ui/api/gates.ts; cli/commands.ts; docs/workflow.md, factory.md, data-model.md, observability.md
    Failure: The timeout touches the tick step `timeout`, `takeOnTimeout` and its `lander: "timeout"` trailer, the UI `dueAt` field, the Gates API, `aleph always timeout`, the Ask card text and five docs. The issue lists only three. A partial deletion breaks `ui/state.ts` or tick at import. Old `Held-by: timeout` trailers on main stay unexplained.

17. [medium] [premise], evidence: inferred
    Where: issue a3325
    Failure: `timeouts` is `{}` today, but it means "no rule set", not "no use". Chris set Always rules because he does not want to wait on asks. Removing the only path that lets an Ask stop waiting leaves Chris as the only exit. With the 'user' Always rule kept, it only sends an Ask to Chris sooner, so it stays useful. The real loss is the lander path for approve, which is untested for use.

18. [low] [detail], evidence: inferred
    Where: issue a3325, a2997, a3315
    Failure: Calling them "moot" without reading them risks closing an issue about more than the timeout. I did not read a2997 and a3315. If either also covers the Always-rule or Ask path, it stays live and a3327 may collide with it.

19. [medium] [premise], evidence: read
    Where: issue a3324, landing.ts:171-205, :222
    Failure: 123 "conflicts" logs and 0 "ok" show that the step has not helped. It also shows that every conflict hits a case rebase could not solve, so deleting it changes nothing in merge-run count. The issue's claim of fewer or faster merge runs has no measurable result. The merge-commit range case returns null at once, so it behaves as today. The real gain is one `git` replay saved per conflict, in minutes, not dollars. The remaining risk is logs older than the retained set.

20. [medium] [design], evidence: read
    Where: issues a3324, a3328, landing.ts:171-243
    Failure: The mechanical rebase writes `tips.set(m, tip)`, and the later `fork` and `subjects` lines use the replayed tip. Deleting it by hand without checking that `fork` and `subjects` read the original tip may change commit subjects in the squash message. Low but unchecked.

21. [medium] [design], evidence: inferred
    Where: issues a3325, a3326, a3327
    Failure: Three changes touch the Ask path: the timeout (`tick`, `takeOnTimeout`), the held-path skip (`direct`) and the rescue Always check (`chris`). Landing a3326 first removes `held` ones from the timeout path, which a3325 then deletes. Landing a3325 first makes a3326's "as a 'user' Always rule does today" the only no-run path. Without order, each branch conflicts in `director.ts` and `tick.ts` with the other.

22. [medium] [design], evidence: inferred
    Where: issues a3324, a3328, a3329, landing.ts
    Failure: Three changes edit `landing.ts` (a3324 at :171-222, a3328 at :322-343, a3329 at :343). a3328 and a3329 touch the same lines and need one author. a3324 should go first, as it is the smallest and removes the `build()` code a3328 does not need. Any order that lets a3329 land before a3328 produces a conflict in the lock section and a wasted rescue.

23. [low] [detail], evidence: inferred
    Where: all seven issues
    Failure: Each issue cites its figures from jobs, logs or the db on one date. None names a before/after number or a test that would show the change worked. Nobody notices a regression, because no check watches land duration, intake spend or rescue count after it ships.

### YAGNI and givens

1. [high] [premise], evidence: read
Where: issues a3324 to a3330 vs the first review
Failure: Most of the seven are the easiest changes, not the largest findings. Only a3330 touches a big cost (intake is 29% of spend). Nothing hits the parked pile (132), the flake pile (129 notes), ghost `running` rows, the sweep as main path (35 of 43 missed events), the triple test run, the red-main lock or the size router. The top risks stay open for Chris.

2. [high] [premise], evidence: inferred
Where: the plan as a whole
Failure: Value per line, best first: a3324 (pure deletion, 123 of 123 conflicts), a3325 (deletion of dead setting), a3326, a3330 (large spend but needs new parsing), a3329, a3327, a3328 (new timer, worst ratio and a principle conflict). Two deletions lead the ranking, but they save the least money.

3. [high] [premise], evidence: read
Where: the "try again" finding (five mechanisms) vs a3327
Failure: a3327 patches the rescue rerun with a counter. That keeps five retry paths and adds a rule to one. A smaller change deletes the Always `resolve` branch at `jobs/lib/land/rescue.ts:345` so the Ask goes to Chris. The run-cap and `ONCE_PER_ISSUE` (`jobs/lib/roles/director.ts:56`) already exist.

4. [high] [design], evidence: read
Where: a3328; PRINCIPLES.md 7
Failure: A land time box is a timer that turns load into a fail. Rule 7 says "Load never causes a failure" and "Work never waits for a timer". a3325 cites this same rule to delete a timer, so the plan contradicts itself. A slow land on a busy machine fails and reruns, and that adds spend.

5. [high] [design], evidence: read
Where: a3328 vs a3329
Failure: The land lock is held across the checks (`jobs/lib/land/landing.ts:125` waits with `Infinity`). A hung check blocks the repo, and a3328 treats the symptom with a timer. The real given is one lock for every land. The two issues share one cause and should be one change, or the lock should not span the checks. Evidence for the 19 lands over 1800 s is not tied to the title call, so a3329 may fix a small part.

6. [medium] [design], evidence: read
Where: a3329; PRINCIPLES.md 6
Failure: `checkTitles` runs a model call (`writeTitle`) only for members with `run.check === "open"`, which is rare. Writing it earlier wastes the call when the land fails or batches away. Rule 6 says code does the work when it can: the title can come from `run.say` in code. Moving the call keeps a model run for a decision code can make.

7. [medium] [design], evidence: inferred
Where: a3329
Failure: The issue gives no count of lands that hold the lock for a title call. If few lands have an open check, the issue fixes nothing measurable. It breaks rule 4 (evidence before a mechanism).

8. [high] [design], evidence: read
Where: a3326; `jobs/lib/roles/director.ts:199-211`
Failure: Escalation is already decided in code before the prompt (`escalation()`, `heldChange`). What the director adds is case text. a3326 writes a second case-text generator in code, a new path where one exists (rule 5). The 78 escalated runs include chrisOnly, second run-cap and rescue Asks, not only held-path. The $37.4 is not split by cause, so the saving is unknown. a3326 also says "the director still runs for a held glob it may land", but `escalation()` escalates any `heldChange`, repo held globs too. The two disagree.

9. [medium] [design], evidence: inferred
Where: a3326 vs a "user" Always rule
Failure: The issue calls the 'user' Always rule the model. The smaller change is to grant that rule for `held-path` (in `FIRST_VERB`) and write no new code. The issue does not say why that is not enough.

10. [high] [design], evidence: read
Where: a3330; `jobs/lib/roles/intake.ts:227`
Failure: `problems()` takes a model `Route` (`v.spec` or `v.parts`), not an issue. A code intake must parse the spec out of issue text. That is a new parser and goes against rule 9 (no parsing of prose). Intake also checks duplicates and "already done by main" (`openIssues`, `mainSince`). A code skip loses both checks. The 758 count is "routed to build", not "carried a valid spec", so the saving is unproven.

11. [medium] [premise], evidence: inferred
Where: a3330 vs a cheaper intake model
Failure: The plan has no look at the other 210 runs or at the cost per run. A cheaper model on the same step has the same effect at a fraction of the risk. Intake as a model step for every issue is the given. Moving it (spec check on filing, in `aleph issue`) removes the need for a3330.

12. [medium] [design], evidence: read
Where: a3324; `jobs/lib/land/landing.ts:171,222,305`
Failure: The 123-versus-0 count comes from retained logs only. `rebased()` also returns null for any merge in the range, so "never ok" may reflect log retention, not the idea. The deletion is probably right (low cost, rule 4) but the doc comment at line 305 and tests must go too. This one is sound; the risk is low.

13. [low] [detail], evidence: read
Where: a3325
Failure: Deleting the setting is sound under rules 4 and 7. `asks/timeout.ts` says a held-path Ask has no timeout, so the setting is already irrelevant to the 78 escalations. Closing a2997 and a3315 as "moot" is a claim: check that no other reader of `timeouts` exists.

14. [high] [premise], evidence: inferred
Where: the plan vs the parked pile and flake pile
Failure: 132 parked issues and 129 flake notes grow with no drain. Rule 8 ("Nothing grows without bound") fails today. Seven new parked issues add to the pile. The plan is a work list with no limit on its own size.

15. [medium] [premise], evidence: inferred
Where: the plan vs the triple test run (hourly suite, verify, land checks)
Failure: Test cost is repeated three times and the plan does not mention it. The land's "run once on the last commit" is the main place to cut. a3328 and a3329 only tune that same land.

16. [medium] [premise], evidence: inferred
Where: the plan vs ghost `running` rows and the sweep as main path
Failure: Ghost rows break rule 3 (visible facts) and the sweep doing ingest as routine breaks rule 7 (no waiting for the tick). Both are correctness problems that none of the seven address.

17. [medium] [design], evidence: inferred
Where: a3326, a3327, a3328, a3330
Failure: Four of seven add code or a rule (a counter, a timer, a code text path, a code intake) where the plan is meant to simplify. Only a3324 and a3325 delete. Rule 5 says "remove before you add".

18. [low] [detail], evidence: inferred
Where: all seven; PRINCIPLES.md 13
Failure: None names a success check or a way to measure the gain after landing (spend, lock hold time, rerun counts). The red-team evidence was read once on 2026-11-19, so the plan cannot show later whether it worked.

Not verified: DB counts (78, 758 of 968, $392); I read code and issue text only.
