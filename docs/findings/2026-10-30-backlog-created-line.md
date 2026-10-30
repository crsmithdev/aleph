# Backlog.md blank Created line, 2026-10-30

Job aleph-635, issue 635: `backlog task view` shows `Created:` blank for files in the shape `renderItem` writes (todo/lib/todo.ts:137), and filled for a file `backlog task create` wrote.

## Result

Cause: Backlog.md 1.55.3 reads the creation date from the frontmatter key `created_date` and ignores `created`, so aleph's `created:` key never reaches the `Created:` line, whether the value is date-only or has a time.

The date-only value is not the cause: `created_date: 2026-10-30` fills the line, and `created: 2026-10-30 19:53` leaves it blank.

## Commands and output

Run in `/tmp/bl-probe/proj` (a scratch git repo outside the aleph checkout). `config.yml` was written by `config("aleph")` from todo/lib/store.ts:38. The renderItem-shaped files were written by `renderItem` (todo/lib/todo.ts:137) with one line changed each. The `backlog task create` file is what the CLI wrote.

```
$ bun -e 'import { config } from "./todo/lib/store.ts"; await Bun.write(process.argv[1], config("aleph"));' proj/backlog/config.yml
$ bunx backlog.md@1.55.3 task create "Probe created create"
Created task ALEPH-1
File: /tmp/bl-probe/proj/backlog/tasks/aleph-1 - Probe-created-create.md
$ bunx backlog.md@1.55.3 task view ALEPH-1 --plain   # the CLI-created file
```

Frontmatter of each file, one difference per file (all other lines identical to the `renderItem` output, title `Probe renderItem`):

| file | frontmatter line changed | `task view` `Created:` |
|---|---|---|
| aleph-2 | `created: 2026-10-30` | blank |
| aleph-3 | `created: 2026-10-30 19:53` | blank |
| aleph-4 | `created_date: 2026-10-30` | `2026-10-30 (UTC)` |
| aleph-5 | `created_date: 2026-10-30 19:53` | `2026-10-30 19:53 (UTC)` |
| ALEPH-1 (CLI) | `created_date: '2026-10-30T19:59:00Z'` | `2026-10-30 19:59 (UTC)` |

Output of each `bunx backlog.md@1.55.3 task view <id> --plain` (exit 0 for all):

```
$ bunx backlog.md@1.55.3 task view aleph-2 --plain
File: /tmp/bl-probe/proj/backlog/tasks/aleph-2 - Probe-variant.md

Task ALEPH-2 - Probe renderItem
==================================================

Status: ○ open
Priority: Medium
Created: 

Description:
--------------------------------------------------
No description provided

Acceptance Criteria:
--------------------------------------------------
No acceptance criteria defined

Definition of Done:
--------------------------------------------------
No Definition of Done items defined

$ bunx backlog.md@1.55.3 task view aleph-3 --plain
File: /tmp/bl-probe/proj/backlog/tasks/aleph-3 - Probe-variant.md

Task ALEPH-3 - Probe renderItem
==================================================

Status: ○ open
Priority: Medium
Created: 

Description:
--------------------------------------------------
No description provided

Acceptance Criteria:
--------------------------------------------------
No acceptance criteria defined

Definition of Done:
--------------------------------------------------
No Definition of Done items defined

$ bunx backlog.md@1.55.3 task view aleph-4 --plain
File: /tmp/bl-probe/proj/backlog/tasks/aleph-4 - Probe-variant.md

Task ALEPH-4 - Probe renderItem
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

$ bunx backlog.md@1.55.3 task view aleph-5 --plain
File: /tmp/bl-probe/proj/backlog/tasks/aleph-5 - Probe-variant.md

Task ALEPH-5 - Probe renderItem
==================================================

Status: ○ open
Priority: Medium
Created: 2026-10-30 19:53 (UTC)

Description:
--------------------------------------------------
No description provided

Acceptance Criteria:
--------------------------------------------------
No acceptance criteria defined

Definition of Done:
--------------------------------------------------
No Definition of Done items defined

$ bunx backlog.md@1.55.3 task view ALEPH-1 --plain
File: /tmp/bl-probe/proj/backlog/tasks/aleph-1 - Probe-created-create.md

Task ALEPH-1 - Probe created create
==================================================

Status: ○ open
Ordinal: 1000
Created: 2026-10-30 19:59 (UTC)

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

## Package code that confirms it

The package is `backlog.md@1.55.3`, installed by bunx to `~/.bun/install/cache/backlog.md-linux-x64@1.55.3@@@1/backlog` (a bun-compiled binary; the JavaScript wrapper `cli.js` in the sibling cache folder does not contain the parser). Searching the binary's embedded source for the task reader:

```
function xr(e){let{frontmatter:t,content:r}=Ic(e,["created_date","updated_date"]),n=String(t.id||""),...
  return{id:n,title:String(t.title||""),status:String(t.status||""),...,
    createdDate:ah(t.created_date),updatedDate:t.updated_date?ah(t.updated_date):void 0, ...}
```

The reader takes `created_date` only. Nothing in the task reader falls back to `created`. The second argument to `Ic` (the frontmatter helper) names `created_date` and `updated_date` as the keys it treats as dates.

## The change that would fill the line

Write the key as `created_date` where aleph writes `created`. In `renderItem` (todo/lib/todo.ts:137-139) the key comes from `item.fm.created`, set in `todo/lib/todo.ts:184` and `:230-235`, checked in `:15` and `:265`, and filled in `:304`. Renaming it in the reader and the store is a schema change to aleph's work store, which this investigation does not make. The alternative is to write `created_date` next to `created`, which keeps the existing reader working. Either way the change is out of scope here.

## Not investigated

- `updated_date` has the same mismatch with `updated:` (aleph writes `updated`), so the `Updated:` line is probably blank too. This was not tested.
- The board itself (the UI) was not run; only the CLI view.
