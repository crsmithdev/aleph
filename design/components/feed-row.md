# Feed row

A feed row shows one event in a feed on one line. The newest event is first.

- Use: in the feed of the Status page, the Herald.
- Not for: the events of one run; use the timeline.

## Helper

| Helper | Reference |
|---|---|
| `feedRow()` draws every row of the Herald: the time, then the body. `heraldRow(row)` draws a row the server built (`ui/herald.ts`) and its fold, `eventRow(row)` its one line and `briefRow(line)` a line of the fold | `ui/views/lib/feed.js` |
| `runNow(s)` draws the Running line | `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Time | The time of the event, from `clock()`, else `when()` |  | `--mono` `--fs-xs` tabular, `--muted`; 44px |
| Chip | What happened, in lower case: `started`, `landed`, `closed`, `ended`, `filed` |  | the tag of its tone |
| Id | The issue, else the run's job, in its shown form (`a1234`, `j6802`), linked |  | `--mono` tabular; one line |
| Title | The issue's title; for a routine run, "N changes"; else what the sentence adds | yes | `--ink`, one line, cut with an ellipsis |
| Count | `+N`, the lines in the row's fold | yes | `--fs-2xs` `--muted` on `--sunk`, `--r-tag` |
| Fold | The older events of the row, one line each | yes | `--rule` guide line on the left; opens from the row |

## Rules

- One row per attempt of an issue: the first job of a job's `prev` chain. Its older events are in the fold, newest first: the time, a label (the run's kind, or the chip word) and a text (the job's link, its mark `✓` or `✗`, then its size, model, commit, time and cost).
- A routine's run is one row, a job like any other: its Id is the run's job (`j6802`), its title says "3 changes", and each change is a line in the fold with the issue's link. A run that ended and changed nothing has no row; one still running, or one that failed, has.
- A status row has the time and the new status text only. It is drawn where the text changes after the page loaded, as the old text gives way to the new; the first render has none.
- A routing event is a quiet system row: the size, the model and the cost in muted text. A routed start's choice is in the fold, not the head.
- The running line holds the jobs and issues in progress above the feed, on its grid. Each row has the start time, the chip (`implement`, or the run's kind), the Id, the title, and a build's size with a breathing dot. A job that ends leaves the line, and its row appears in the feed.

## Do and don't

| Do | Don't |
|---|---|
| `14:05 landed a1700` | `2026-11-10T14:05:00Z Landed` |
| `12:59 started j6802 aleph` | a routine's run by its name and a count, `housekeeper#57` |
