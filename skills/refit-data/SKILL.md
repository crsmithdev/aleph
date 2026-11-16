---
name: refit-data
description: >
  Refit a UI's data: recompute the numbers a page shows from their raw
  sources; find wrong, empty, stale or leaked values, broken joins, and
  migration losses. Use when asked to audit or verify a page's data or
  metrics, or before you add a metric (check). NOT for: choosing numbers
  (use datavis); building the pipeline (use write-data).
---

# Refit data

A number on a page is right when an independent recompute from its raw source gives the same value at the same
moment. Tests run on fixtures. They do not see a migrated store, a key that changed form, or a writer that
stopped writing a field. This skill reads the live sources.

## Lenses

| Lens | Asks | Signal |
|---|---|---|
| **recompute** | Does the shown value equal a recompute from the raw rows? | The API value and your query differ |
| **join** | Do both sides of a join name the entity the same way? | A column that is 0 or empty on every row |
| **orphan** | Does a writer fill each field that the view reads? | A field that a view reads and no writer sets; a null share of 100% |
| **migration** | Did a store change rewrite or drop what old rows held? | A null share or a value that steps at a migration commit |
| **scope** | Does the definition match the label? | A total that leaves out a role, a project or a state that the label implies |
| **window** | Do the edges, the time zone and the partial day match? | Counts that differ by the rows near one edge |
| **validity** | Are the rows real? | A future time, a fixture key, an impossible value, a duplicate |
| **fresh** | Is the source current and whole? | The age of the last row; a day with no rows |
| **stale** | Does state outlive its entity? | A state row for a closed or deleted entity |

Where they meet: a 0 on every row is **join** when the rows exist on the other side, and **orphan** when no writer
writes them. A wrong value whose cause is one store change is **migration**. A value that matches its code but not
its label is **scope**. Report a candidate under one lens only.

## Modes

| Mode | Runs | Reach for it |
|---|---|---|
| `retro` (default) | Inventory, profile, recompute, reconcile, prove, report | Find what is wrong |
| `check` | Each new metric, field, event, key or migration in a plan, spec or diff | Before or during a build |

## Retro

1. **Inventory.** List each number the UI shows: page, label, API route and field. Pick at least one per kind of
   source: each event action, each record table, each external service. Done when each kind has a number, or a
   reason why the UI shows none.
2. **Profile the sources.** For each table or file, record the row count, the first and last time, the rows per
   day, the null share of each column per day, the rows with a time after now, and the rows whose keys look like
   fixtures. Done when each source has its profile in a scratch file.
3. **Recompute.** For each number, write its definition from the label and the docs, not from the code. Query the
   raw source in a scratch script, and read the API value at the same moment. If they differ, read the code for
   its definition, then decide which one is wrong. Done when each number is a match, a mismatch with a cause, or
   a difference of definition that you state.
4. **Reconcile.** Count the same events in two sources: commits on main against land records, runs against
   traces, item files against the issue list. Join on a stable key such as a commit SHA. Done when each pair
   matches, or the difference is listed by row.
5. **Prove, hold and report.** Follow refit-code's [PROVE.md](../refit-code/PROVE.md) with this skill's lenses.
   A mismatch is a finding only with both values, the query and the moment of the read. The report goes to
   `<tmpdir>/refit-data-retro-<timestamp>/`, and its unit is a shown number. Its Overview opens with a table of each number: the shown value, the
   recomputed value and the verdict.

Rules:

- Read the live API, not a fixture. Keep each recompute script in the scratchpad, never in the repo.
- Name the time zone and the window edges of each query.
- Join on a value that both sides store in the same form. If a store changed its ID form, join through a commit
  SHA or the migration's own map.
- Record the moment of each read. A live source moves between two reads, so bound the query to before both.

## Check

1. **List the new things.** From the plan, spec or diff: each new number on a page, record field, event action,
   key form, join and store migration.
2. **Ask each item its questions.** Record each answer.
   - Which writer sets this, and in which commit? (orphan)
   - Do the reader and the writer use the same key form? (join)
   - What does the label promise, and which rows does the definition leave out? (scope)
   - What are the window edges and the time zone? (window)
   - For a migration: which fields of old rows does each reader need, and does the migration carry each one?
     (migration)
   - Which query on the raw source gives the same value? (recompute)
3. **Judge.** Each item gets one verdict: **keep**, **fix** (name the lens and the change), or **cut**. Done when
   every item has a verdict.

## Holds

| Lens | Hold | Kind |
|---|---|---|
| recompute | A test that runs the recompute query and the route on one fixture store and compares them | tool |
| join | A test that a route gives a nonzero value for a fixture entity that has records | tool |
| orphan | A lint that each field a view reads has a writer | unchecked |
| migration | A test that runs each reader on the migrated fixture store | tool |
| validity | A test that the test suite leaves the live data directory unchanged | tool |
| scope, window | A judgment | model |

## Red flags

- **You recomputed with the app's own query.** That tests the query against itself. Write it from the label.
- **You trusted a 0.** A zero on every row is a broken join more often than a real zero.
- **You compared two reads minutes apart.** Read both at one moment, or bound the window to before both reads.
