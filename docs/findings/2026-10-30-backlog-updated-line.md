# Backlog.md `Updated:` line on aleph task files, 2026-10-30

Job aleph-644, issue 644, follow-up to aleph-636 (docs/findings/2026-10-30-backlog-created-line.md).

## Result

Cause: Backlog.md 1.55.3 reads the update date from the frontmatter key `updated_date` and ignores `updated`, so for aleph's files the `Updated:` line is **missing, not blank**: the CLI prints `Updated:` only when the task has an `updatedDate`, and `updated:` never sets one.

The value shape is not the cause: `updated_date: 2026-10-30` and `updated_date: 2026-10-30 19:53` both fill the line; `updated: ...` in either shape prints no line. The line is also absent for a fresh `backlog task create` file (no `updated_date` until the first edit), and appears after `backlog task edit`.

So the `Updated:` line is not blank the way `Created:` is (`Created:` is always printed, with an empty value when `created_date` is missing). The same change as for `created_date` is needed for `updated_date`: aleph-643 must include it, or `Updated:` stays absent.

## Commands and output

Run in `/tmp/up/proj` (a scratch git repo outside the checkout). `config.yml` was written by `config("aleph")` (todo/lib/store.ts:38). The four probe files use the `renderItem` shape (todo/lib/todo.ts:137) with `created_date: 2026-10-30` (so `Created:` fills) and one `updated` line each. ALEPH-6 was written by `backlog task create` and then changed with `backlog task edit`. ALEPH-7 has no updated key at all.

```
$ bunx backlog.md@1.55.3 task create "Probe created create"
Created task ALEPH-6
$ bunx backlog.md@1.55.3 task view ALEPH-6 --plain        # after create
Task ALEPH-6 - Probe created create
Status: ○ open
Created: 2026-10-30 20:09 (UTC)
                                                           # no Updated: line; file has created_date only
$ bunx backlog.md@1.55.3 task edit ALEPH-6 -s done
Updated task ALEPH-6
$ bunx backlog.md@1.55.3 task view ALEPH-6 --plain        # after edit
Status: ✔ done
Created: 2026-10-30 20:09 (UTC)
Updated: 2026-10-30 20:09 (UTC)                            # file now has updated_date: '2026-10-30T20:09:00Z'

$ grep updated "aleph-2 - Probe-variant.md"; bunx backlog.md@1.55.3 task view aleph-2 --plain
updated: 2026-10-30
Status: ○ open
Created: 2026-10-30 (UTC)                                  # no Updated: line

$ grep updated "aleph-3 - Probe-variant.md"; bunx backlog.md@1.55.3 task view aleph-3 --plain
updated: 2026-10-30 19:53
Status: ○ open
Created: 2026-10-30 (UTC)                                  # no Updated: line

$ grep updated "aleph-4 - Probe-variant.md"; bunx backlog.md@1.55.3 task view aleph-4 --plain
updated_date: 2026-10-30
Status: ○ open
Created: 2026-10-30 (UTC)
Updated: 2026-10-30 (UTC)

$ grep updated "aleph-5 - Probe-variant.md"; bunx backlog.md@1.55.3 task view aleph-5 --plain
updated_date: 2026-10-30 19:53
Status: ○ open
Created: 2026-10-30 (UTC)
Updated: 2026-10-30 19:53 (UTC)

$ bunx backlog.md@1.55.3 task view aleph-7 --plain         # no updated key at all
Status: ○ open
Created: 2026-10-30 (UTC)                                  # no Updated: line
```

Lines after `Created:`/`Updated:` (Description, Acceptance Criteria, Definition of Done) were identical for every file and are cut. All commands exit 0.

| file | frontmatter line | `Updated:` line |
|---|---|---|
| aleph-2 | `updated: 2026-10-30` | absent |
| aleph-3 | `updated: 2026-10-30 19:53` | absent |
| aleph-4 | `updated_date: 2026-10-30` | `2026-10-30 (UTC)` |
| aleph-5 | `updated_date: 2026-10-30 19:53` | `2026-10-30 19:53 (UTC)` |
| aleph-6 after create | `created_date` only | absent |
| aleph-6 after edit | `updated_date: '2026-10-30T20:09:00Z'` | `2026-10-30 20:09 (UTC)` |
| aleph-7 | none | absent |

## Package code that confirms it

Package `backlog.md@1.55.3`, a bun-compiled binary at `~/.bun/install/cache/backlog.md-linux-x64@1.55.3@@@1/backlog`; the source is embedded and was searched with `grep -a`. The task reader:

```
createdDate:ah(t.created_date),updatedDate:t.updated_date?ah(t.updated_date):void 0
```

The plain task view:

```
r.push(`Created: ${qs(e.createdDate,WC)}`),e.updatedDate)r.push(`Updated: ${qs(e.updatedDate,WC)}`)
```

`Created:` is pushed unconditionally (hence blank in aleph-636); `Updated:` is pushed only `if(e.updatedDate)`. The reader never looks at `updated`. The writer sets `updatedDate` on `task edit` (`e.updatedDate=Ln()`), which is why the line appears after an edit.

## The change that would fill the line

Write `updated_date` where aleph writes `updated` (todo/lib/todo.ts:137-139 renders `item.fm`; the key is set at :184, :207, :220, :226, :236, checked at :15, :260, :265, and filled at :305), or write `updated_date` next to `updated`. Both keys use the same date-only or `YYYY-MM-DD HH:MM` values, which fill the line. This is the same change as `created_date`, so it belongs in aleph-643. Not made here (investigation only).

## Not investigated

- The board UI; only the CLI `task view --plain`. The UI code in the same binary also guards on `updatedDate` (`e.updatedDate&&...`), so it would likely omit the line too.
