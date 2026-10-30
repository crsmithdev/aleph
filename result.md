# aleph-663 result

Temp folder: `/tmp/aleph663-bl-5ad8` (outside the repo). `backlog/config.yml` was written from `config("st1")`, and `backlog/tasks/st1-1.md` from `renderItem("st1", item)` with `created` and `updated` set to `2026-10-30`.

Command:

```
bunx backlog.md@1.55.3 task view st1-1 --plain
```

Output (exit 0):

```
Resolving dependencies
Resolved, downloaded and extracted [17]
Saved lockfile
File: /tmp/aleph663-bl-5ad8/backlog/tasks/st1-1.md

Task TASK-ST1-1 - Smoke
==================================================

Status: ○ open
Priority: Medium
Created: 2026-10-30 (UTC)
Updated: 2026-10-30 (UTC)

Description:
--------------------------------------------------
No description provided

Acceptance Criteria:
--------------------------------------------------
No acceptance criteria defined

Definition of Done:
--------------------------------------------------
No Definition of Done items defined
```

Both `Created:` and `Updated:` are filled, so Backlog.md reads `created_date` and `updated_date` from the store file.

# aleph-652 result

Folder: a temporary directory (`/tmp/aleph652-task.zIyz`) with `backlog/config.yml` from `config("proj")` in `todo/lib/store.ts`, and `backlog/tasks/proj-1.md` from `renderItem("proj", item)` in `todo/lib/todo.ts` with `created: 2026-10-30`. The two files were written by a throwaway Bun script outside the repo; no existing store file was rewritten.

```yaml
---
id: proj-1
title: Check created
created_date: 2026-10-30
updated_date: 2026-10-30
priority: medium
kind: issue
status: open
repo: proj
---

## Request

Check the Created line.
```

Command:

```
bunx backlog.md@1.55.3 task view proj-1 --plain
```

Output (exit 0):

```
Resolving dependencies
Resolved, downloaded and extracted [17]
Saved lockfile
File: /tmp/aleph652-task.zIyz/backlog/tasks/proj-1.md

Task TASK-PROJ-1 - Check created
==================================================

Status: ○ open
Priority: Medium
Created: 2026-10-30 (UTC)
Updated: 2026-10-30 (UTC)

Description:
--------------------------------------------------
No description provided

Acceptance Criteria:
--------------------------------------------------
No acceptance criteria defined

Definition of Done:
--------------------------------------------------
No Definition of Done items defined
```

The `Created:` line is filled.

## Run 3 (test flake)

- `jobs/lib/plan.test.ts`: the slow planner now waits on a `release` file instead of `sleep 1`, and the `< 900 ms` wall-clock assertion is gone. afterEach also writes `release`, so a failing test leaves no planner behind to write into a removed folder.
- `bun run test`, default parallelism: full run 1 passed (1130 pass, 0 fail). Full run 2, after the change, failed one test: `guards > six starts at once` (`jobs/cli.basic.test.ts:184`; the first start to return had code 0, not the refusal). Pass rate: 1 of 2 full runs; not reproduced on demand.
- `plan.test.ts` alone: about 1 run in 5 failed on `planned; not closed: ENOENT ... posix_spawn 'git'` in `closePlanned`. I could not catch the cwd in 6 instrumented runs. Cause not found; this is not fixed.
