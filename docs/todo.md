# To do

Things to build or look at in aleph. `aleph todo` owns this file.
Item numbers never change: commits, the spec and the vault quote them.

## 1. Landing detection: find work that reached main without the ledger
---
id: 1
status: done
created: 2026-09-28
updated: 2026-09-30
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: Red team 29 Sep: the ladder as designed cannot resolve the four stuck jobs. Their branches are gone and they carry no Job: trailer, so tiers 2-4 have nothing to read. Landing detection depends on item 5 being built first.
- 2026-09-29 07:51: Verified on git 2.43: git cherry marks both commits of a squashed branch as unlanded, so per-commit patch-id is the wrong comparison; the branch's net diff patch-id matches the squash exactly. Tree equality fails once main moves on; use git merge-tree --write-tree.
- 2026-09-29 18:41: 2026-09-29 measurement: all 73 agent runs in states passed/failed/needs-you point at a branch and a worktree that no longer exist. git branch --list 'job/*' returns nothing in aleph, sidetone or cloudchamber. 58 of the 73 read as 'passed' with nothing left to land. The ledger is 100% drifted for anything not closed through aleph land or aleph drop.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 2. aleph jobs shows each job's fate, not its run state
---
id: 2
status: done
created: 2026-09-28
updated: 2026-09-30
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: Fate is a second field beside state, not a replacement: a run can be failed with its work already on main. Show the tier that decided, so a patch match reads weaker than a trailer match.
- 2026-09-29 15:24: 2026-09-29 evidence: aleph jobs lists sidetone voice-eval, prefer-background, audio-static and tool-batching as failed, and they are still listed after their work reached main by hand. Chris asked 'anything unlanded?' and the list gave the wrong answer until a manual git log check. A landed job should not read as failed.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 3. Record the branch tip, merge-base and net patch-id when a run passes
---
id: 3
status: done
created: 2026-09-29
updated: 2026-09-30
priority: high
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: Step 0 of the ladder. The only change that stops evidence being lost; every day without it is another job that can never be resolved. unit.ts, ledger.ts.
- 2026-09-30 08:15: Superseded in e0c6fe8: the squash and each worker commit carry a Job: trailer, and a live branch is matched by git merge-tree, so no patch-id needs recording.

## 4. Capture the conflicted paths before the rebase abort
---
id: 4
status: done
created: 2026-09-29
updated: 2026-09-30
priority: high
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: land() runs rebase --abort before anything reads the conflicted paths (unit.ts:133). git diff --name-only --diff-filter=U and git ls-files -u both work and neither needs rerere. Seven land runs have been lost this way.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 5. Guard the missing worktree in land()
---
id: 5
status: done
created: 2026-09-29
updated: 2026-09-30
priority: high
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: unit.ts:109 passes run.worktree to git() with no existsSync guard, so a removed worktree reads as posix_spawn git ENOENT. Line 228 in the same file already guards it.
- 2026-09-29 15:24: 2026-09-29 evidence: the sidetone jobs voice-eval, prefer-background, audio-static and tool-batching each failed land twice (runs 20260928-163706 and 20260929-111540) with 'posix_spawn git ENOENT'. git is at /usr/bin/git; the cause is the missing worktree used as cwd, as above. Chris had already ported all four to main by hand, and the job branches were deleted: voice-eval as 1704917, prefer-background as e1cb4d7 (item 64), tool-batching as 7ae9476 and 94bbe0a (item 62), audio-static as the finding ~/.sidetone/findings/audio-transport-56.md plus 309d2fe. So aleph jobs still lists four failed jobs that did land. The error text says git is missing, which misled the diagnosis.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 6. Flaky test: a check past its limit is stopped and fails as timed out
---
id: 6
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [test, flaky]
---

### Notes

- 2026-09-29 08:11: Failed once on main at 4c8ea4e on 29 September 2026 and passed on the next run. Not investigated.
- 2026-09-30 08:55: caafe40 measures the limit on performance.now() instead of Date.now(). The cause is not proven: the failure was not reproduced, and 8 of 8 targeted runs pass. Open a new item if it fails again.

## 7. A job's aleph todo note writes to the main checkout and leaves it dirty
---
id: 7
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [jobs, todo]
---

### Notes

- 2026-09-29 13:09: Job todo-link: aleph land now marks a linked item done in the main checkout after the fast-forward, so every land of a linked job leaves docs/todo.md changed there, and the next land does not fast-forward that checkout.
- 2026-09-30 07:08: 2026-09-30 root cause of the drift: aleph todo writes every add, note and done to the main checkout (todoPath(repo.path)), never to a branch. So docs/todo.md in main stays dirty, and land.ts:157 then skips the fast-forward. 23 of the 26 lands since 29 Sep 10:08 say 'main checkout not updated'. Now: aleph +56 lines, sidetone +101/-8 uncommitted in docs/todo.md. Fix: write the done note into the squash tree before commit-tree, so it lands in the same commit.
- 2026-09-30 07:08: Correction to the note above: the fast-forward guard is jobs/lib/unit.ts:157, not land.ts:157.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 8. aleph todo add fails with ENOENT in a repo that has no docs directory
---
id: 8
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [todo]
---

### Notes

- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 9. git-guard bypass through the symlink: an Edit or Write on ~/.claude/CLAUDE.md is allowed, because ~/.claude is not a git repo and hooks/git-guard.ts:24-25 exits before it checks the branch. The path writes to aleph's main checkout (identity/CLAUDE.md). Resolve the symlink before the repo check.
---
id: 9
status: done
created: 2026-09-29
updated: 2026-09-30
priority: high
labels: [hooks, bug]
---

### Notes

- 2026-09-30 08:55: Landed in caafe40: git-guard follows links before the repo check; a test edits main through a link and is denied.

## 10. identity/CLAUDE.md allows trivial edits to main when Chris asks, but hooks/git-guard.ts:37-45 denies every Edit and Write on main outside .worktrees/. Either add an exception to the hook or delete the rule from the Git section.
---
id: 10
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [hooks, docs]
---

### Notes

- 2026-09-30 08:55: Landed in caafe40: the exception is deleted from identity/CLAUDE.md.

## 11. Land says 'main checkout not updated' when the main checkout has uncommitted changes, and reports the job as landed
---
id: 11
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-29 15:24: 2026-09-29 evidence: sidetone job test-audit (run 20260929-111251) ran fetch, rebase, commit-tree and push all ok, and pushed 18ad700. Then land.log says 'main checkout not updated' and the state is landed with that as its reason. The sidetone main checkout had an uncommitted change to docs/todo.md at the time, which is the likely cause but is not verified. Same run as the item 5 failures. Chris cannot tell from the landed state that the local main is behind origin. Check what the land step does when the checkout is dirty, and say so in the news line.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 12. Queue lands: two lands at once let one succeed and the others fail
---
id: 12
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-30 07:08: 2026-09-30 lands are already serial: land() holds lock land-<repo> from fetch to push (unit.ts:125). The 'others fail' are rebase conflicts on shared files (docs/spec.md, src/conversation.ts, test/fixtures/messages.jsonl), then a hand-run agent follow-up and a second land (project-switch, retract-join, fade-skip, garbled-edges, fade-inverse). The queue to build: on a rebase conflict, capture the paths (item 4), dispatch the follow-up agent run itself, and land again when it passes. Survey 30 Sep: GitHub merge queue needs an org repo; Mergify, Trunk, Graphite and Aviator need a PR per branch; bors-ng and Bulldozer are archived; no agent orchestrator (Claude Squad, container-use, Vibe Kanban) ships a land queue. Keep it local.
- 2026-09-30 08:14: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 13. Review land permissions: let a repo land its jobs without asking, set in a per-repo config
---
id: 13
status: done
created: 2026-09-29
updated: 2026-09-30
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-29 15:48: 2026-09-29 policy from Chris: a manual check is a smell. A job should land on its automated tests. Many checks, like the car, can only happen after the change lands, so a gate before landing makes them impossible. The land gate should not block on a manual check; a rare case that cannot be tested automatically should need approval, not every job. Today aleph land refuses without --checked or --unchecked, and sidetone CLAUDE.md tells the agent to ask 'Did you check it?'. Change both: land on green tests by default, and keep the manual check as an open item on the to-do, not a gate.
- 2026-09-29 15:49: 2026-09-29 done on the sidetone side: CLAUDE.md (33e637b) now tells the agent to land a passed job, add --unchecked when aleph land refuses for a manual check, and note the check on the to-do item. The aleph side is not changed: aleph land still refuses without --checked or --unchecked, and the news line still says 'needs-you manual'. Make a manual check a to-do note, not a refusal.
- 2026-09-30 08:15: e0c6fe8 adds aleph job --land, which lands a run when it passes; the bounce after a conflict uses it. aleph land still refuses a manual check without --checked or --unchecked, and a plain aleph job does not land by itself.
- 2026-09-30 08:55: Landed in caafe40: a passed job lands by itself unless the repo sets autoland false; a manual check becomes the item 'Check <name>: <say>', closed by aleph checked. Sidetone CLAUDE.md updated in ee4aec7.

## 14. aleph todo rewrites the whole file with no lock and no atomic rename
---
id: 14
status: done
created: 2026-09-29
updated: 2026-09-30
priority: high
labels: [todo, jobs]
---

### Notes

- 2026-09-29 18:41: todo/lib/todo.ts:104-108 read-parse-render-writeFileSync, no lock, no temp+rename; jobs/cli.ts uses lock() for dispatch and per-job. Append-only notes stop semantic erasure between two writers, not a concurrent read-modify-write: the second render overwrites the first. Survey 29 Sep: this exact shape is claude-task-master's corruption tail (#1567 race between Claude Code windows, #854 bulk-update data loss, #1708 schema corruption on set-status) and Backlog.md #843 'task edit loses concurrent writes silently'. One writer today; a seat model makes it routine.
- 2026-09-30 08:15: Landed in e0c6fe8: the fate of a job comes from git, a to-do write is a commit on origin/main, and a conflict goes back to the worker.

## 15. Build agent seats per docs/specs/2026-09-30-agent-seats.md
---
id: 15
status: open
created: 2026-09-30
updated: 2026-09-30
priority: high
labels: [seats]
---

## 16. The worker prompt's 'never push' stops workers from using aleph todo
---
id: 16
status: done
created: 2026-09-30
updated: 2026-09-30
priority: high
labels: [jobs, todo]
---

Measured 30 Sep 2026 with 18 throwaway worker runs (six to-do tasks, three runs each). 14 of 18 did not do the task: the fixed worker text in jobs/lib/unit.ts says "Never merge, never push", and `aleph todo` pushes a commit to origin/main, so the worker stopped and offered choices. Its result has no QUESTION: line and no commits, so a real job ends `done` "no commits" with the work not done. The same 18 tasks as plain sessions: 18 of 18 used `aleph todo`.

Done when the fixed text says that `aleph todo` writes the list on main by itself and is not the worker's push, and a rerun of the six worker tasks completes them through `aleph todo`.

### Notes

- 2026-09-30 11:18: Landed in d24d220. Eval in Langfuse, dataset aleph-todo-worker, runs main-caafe40 and worker-todo-fix: task done 13/18 -> 18/18, questions 5 -> 0, hand edits on main 1 -> 0.

## 17. Land refuses a branch that changes docs/todo.md and sends it back to the worker
---
id: 17
status: done
created: 2026-09-30
updated: 2026-10-01
priority: medium
labels: [jobs, todo]
---

The eval of 30 Sep 2026 (Langfuse dataset aleph-todo-worker, run main-caafe40, title-2) found one worker that edited the list with a script that imports todo/lib/todo.ts, committed it as "todo: ...", and the job landed it (dcd0fad). git-guard sees only Edit and Write. The land is the one place that sees every branch, whatever tool made the change, and it is inside aleph, so no repo needs a hook.

With the fixed worker text (d24d220) the eval had 0 hand edits in 24 runs, so this is a backstop. Done when a land of a branch that changes docs/todo.md fails with a reason that names aleph todo, sends the job back to the worker, and a test holds it.

### Notes

- 2026-10-01 07:37: 85de789: land refuses a branch that changes docs/todo.md (reason names aleph todo) and sends the job back with a restore note; test in jobs/cli.test.ts. The squash no longer takes the branch's copy of the list.

## 18. pickup archives handoffs under a name compile never reads
---
id: 18
status: open
created: 2026-10-01
updated: 2026-10-01
priority: high
labels: [skills, bug]
---

skills/pickup/SKILL.md:13 archives to `<name>-<date>.md` (current-2026-...). vault/lib/compile.ts:80 `handoffsFor` reads only files that start with the date. A picked-up handoff never reaches `vault compile`.
Fix: archive to `$(date +%Y-%m-%d-%H%M%S)-<name>.md`. Done when compile shows a picked-up handoff for its date.
Found by the 2026-10-01 agent-instructions audit.

## 19. Fix contradictions and stale references in skills
---
id: 19
status: open
created: 2026-10-01
updated: 2026-10-01
priority: medium
labels: [skills]
---

From the 2026-10-01 writing-for-agents audit. Each is a case where the agent gets two answers or a dead pointer:
- tidy/SKILL.md:2 description is invalid YAML (unquoted `: `); agnix fails to parse it.
- red-team/SKILL.md:16,45 points at `/debug`; the skill is aleph:diagnosing-bugs. :141 says "four lenses", default is five (:57).
- red-team:93, prior-art:111 say subagents run "in the foreground"; they run in the background.
- improve-codebase-architecture SKILL.md:43-50 and HTML-REPORT.md:44-53 give two card specs that disagree. :35 restates the deletion test wrongly.
- domain-modeling: SKILL.md shows per-context src/*/docs/adr/, ADR-FORMAT.md says docs/adr/.
- grill-with-docs: grill-me says do not act until confirmed; domain-modeling says write CONTEXT.md inline. No tie-break.
- grill-with-docs is user-invoked but carries model-facing triggers.
- vault/SKILL.md:126 says Home routes only decisions and projects; step 3 and live Home.md route concepts and entities.
- to-spec:11 "Do NOT interview" vs step 2 asks a question.
- writing-for-agents SKILL-MECHANICS.md:22 vs :10 on whether user-invoked skills have a description.
- tidy DETECTORS.md:20 "three" lists four; SKILL.md:173 "five" lists six.
- tdd description triggers on red-green-refactor; body says refactor is not in the loop.
Done when each line is fixed and `agnix -t claude-code skills` reports no parse error.

## 20. Trim always-loaded skill descriptions
---
id: 20
status: open
created: 2026-10-01
updated: 2026-10-01
priority: medium
labels: [skills]
---

Descriptions load every turn. Word counts on 2026-10-01: red-team 139, tidy 138, prior-art 133, grill-me 89, grill-with-docs 55, to-spec 53. Each repeats body identity and lists synonym triggers for one branch; red-team, prior-art and tidy do not front-load their leading word. handoff, pickup, docs-writing ("51 rules"), codebase-design (advertises a scan branch it lacks) also have fixes.
Target: ~50 words max, leading word first, one trigger per branch. Audit tables: session 2026-10-01 (Langfuse).

## 21. Add completion criteria and cut duplication in skill bodies
---
id: 21
status: open
created: 2026-10-01
updated: 2026-10-01
priority: medium
labels: [skills]
---

From the 2026-10-01 writing-for-agents audit.
Missing done bars: tdd (run the test and see it go red), diagnosing-bugs phases 3-4, docs-writing audit, domain-modeling, to-spec steps 1 and 3, retro, prior-art step 4, improve-codebase-architecture explore brief, writing-for-agents itself, tidy sweep stop point.
Sprawl to disclose: vault maintenance ops (~80 lines) to MAINTAIN.md; tidy pass 2 (~55 lines) to PROVE.md.
Duplication: codebase-design (SKILL vs DEEPENING, testability no-op section), domain-modeling (3 files), tdd (3 files), red-team/prior-art calibration and when-to-use echo, docs-writing gotchas, vocabulary bans repeated 4x across codebase-design and improve-codebase-architecture.
retro: give the Langfuse API curl, not the UI URL.
