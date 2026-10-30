# aleph-643: Backlog.md Created check

Folder: a temporary directory with `backlog/config.yml` from `config("proj")` in `todo/lib/store.ts`, and `backlog/tasks/proj-1.md` from `renderItem("proj", item)` in `todo/lib/todo.ts` with `created: 2026-10-30`.

The file the store wrote:

```yaml
---
id: proj-1
title: Check created
created_date: 2026-10-30
updated: 2026-10-30
priority: medium
kind: issue
status: open
repo: proj
---

## Request

Check the Created line.
```

Command: `bunx backlog.md@1.55.3 task view 1 --plain`

Output (exit 0):

```
Resolving dependencies
Resolved, downloaded and extracted [17]
Saved lockfile
File: /tmp/aleph652-task.1chT/backlog/tasks/proj-1.md

Task PROJ-1 - Check created
==================================================

Status: ○ open
Priority: Medium
Created: 2026-10-30 (UTC)

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

Control: the same folder with a task file that has only `created: 2026-10-30` (no `created_date`) prints `Created: ` with no date. The `created_date` key is what makes Backlog.md fill the line.
