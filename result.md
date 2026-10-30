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
