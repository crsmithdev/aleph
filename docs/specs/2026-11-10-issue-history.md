# Issue history without a new store

Status: proposed 2026-11-10, not approved. Source: the Beads and Dolt survey of 2026-11-10 (vault note "Beads And Dolt Survey 2026-11-10"). Related issues: aleph-1679, 1680, 1681, 1683, 1684, all parked.

## Decisions

1. **The issue store stays markdown in git.** Dolt gives one large gain, history as SQL, and that gain does not need a new store. Beads moved to Dolt because it had two systems of record (a SQLite database and a JSONL export in git) and many agents that overwrote each other's writes. Aleph has one system of record, and `writeList` (`issues/lib/store.ts`) applies each change again on a fresh `main` when a push is refused. Beads users reported lost tasks and hung Dolt servers after the move (beads #2573), and Beads still shipped data-loss fixes in v1.3.3 on 2026-11-03.
2. **History is a derived SQLite table, not a second store.** It is built from the store's git log and can be rebuilt from it at any time. Nothing writes to it except the build.
3. **The actor goes in each store commit first.** All 7,263 store commits have the author Chris Smith, and the actor is only implied by the message text. History written before the actor trailer exists has no actor, so this step comes first.

## Fixed

- The store format: one markdown file per issue, frontmatter fields, notes in the body.
- `writeList` and every reader of the store.
- The push-and-retry write path to `origin/main`.

## Measurements

- The store has 986 issue files and 7,264 commits, 61 MB of git.
- `git log -p -U0` over the whole store is 16 MB and takes 1.6 s. A frontmatter change comes out as a `-key: old` / `+key: new` line pair.
- `aleph issue lint aleph` reports 2,914 problems. The ones seen are timestamps that are not yet ISO (aleph-1654, 1655).

## Steps

| Step | Change | Issue |
|---|---|---|
| 1 | Each store commit gets an `Actor:` trailer: `chris`, a factory role such as `triage` or `intake`, a job, or an interactive session. | aleph-1684 |
| 2 | A SQLite table of field changes (issue, field, old value, new value, commit, time, actor), built from `git log -p` and updated from the last commit it read. | aleph-1683 |
| 3 | The first readers of the table: Ask wait time, time in each state, triage reversals, and dropped against landed issues by source. Status Performance reads intake times from the table, not from its own `git log` parse in `ui/api/speed.ts`. | aleph-1683 |
| 4 | Checks on each write: refuse an `after` that names no issue, and refuse a commit that changes many issues unless the caller says so. | not filed |
| 5 | Graph fields: a link to the issue whose work found an issue, a date before which an issue does not start, and a Prospective count of all open issues. | aleph-1680, 1681, 1679 |

Step 4 waits until `aleph issue lint` is clean, because a check on each write is of no use while the existing data fails lint.

## Out of scope

- **Concurrent writers.** Push and retry already serialise them.
- **Merge per field.** `writeList` does not merge.
- **Data branches.** No use for them.
- **Faster writes.** A write pushes to GitHub, about 1 s. A local remote would make writes faster if that becomes necessary; it needs no new store.

## Uses of the table

- **Flow:** time in each state, Ask wait time, the delay before an issue with an `after` starts once its blocker lands, and the backlog on any past date.
- **Quality:** dropped against landed issues by source, triage closes that Chris reopened, priority changes after triage, spec edits and spec-check holds before a failed build, and title edits after filing.
- **Decisions:** lead time and failure rate before and after a factory change, the state of all issues on a given date, and lead-time forecasts by kind.
- **Safety:** a commit that changes many issues, or a field that disappears.
