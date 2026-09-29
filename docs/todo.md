# To do

Things to build or look at in aleph. `aleph todo` owns this file.
Item numbers never change: commits, the spec and the vault quote them.

## 1. Landing detection: find work that reached main without the ledger
---
id: 1
status: open
created: 2026-09-28
updated: 2026-09-29
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: Red team 29 Sep: the ladder as designed cannot resolve the four stuck jobs. Their branches are gone and they carry no Job: trailer, so tiers 2-4 have nothing to read. Landing detection depends on item 5 being built first.
- 2026-09-29 07:51: Verified on git 2.43: git cherry marks both commits of a squashed branch as unlanded, so per-commit patch-id is the wrong comparison; the branch's net diff patch-id matches the squash exactly. Tree equality fails once main moves on; use git merge-tree --write-tree.

## 2. aleph jobs shows each job's fate, not its run state
---
id: 2
status: open
created: 2026-09-28
updated: 2026-09-29
priority: medium
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: Fate is a second field beside state, not a replacement: a run can be failed with its work already on main. Show the tier that decided, so a patch match reads weaker than a trailer match.

## 3. Record the branch tip, merge-base and net patch-id when a run passes
---
id: 3
status: open
created: 2026-09-29
updated: 2026-09-29
priority: high
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: Step 0 of the ladder. The only change that stops evidence being lost; every day without it is another job that can never be resolved. unit.ts, ledger.ts.

## 4. Capture the conflicted paths before the rebase abort
---
id: 4
status: open
created: 2026-09-29
updated: 2026-09-29
priority: high
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: land() runs rebase --abort before anything reads the conflicted paths (unit.ts:133). git diff --name-only --diff-filter=U and git ls-files -u both work and neither needs rerere. Seven land runs have been lost this way.

## 5. Guard the missing worktree in land()
---
id: 5
status: open
created: 2026-09-29
updated: 2026-09-29
priority: high
labels: [jobs]
---

### Notes

- 2026-09-29 07:51: unit.ts:109 passes run.worktree to git() with no existsSync guard, so a removed worktree reads as posix_spawn git ENOENT. Line 228 in the same file already guards it.
