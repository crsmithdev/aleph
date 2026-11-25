# Events log options

Request: the Events card on Status leaves Issue empty on most job rows and Took empty on starts. Find a layout that uses the space better.

`build.ts` draws each option with the real helpers of `ui/views/lib/html.js` from `data.json`, 50 live events of 2026-11-25. In those, 43 of 75 events have an issue, 60 a job and 30 a duration.

- **A, one Ref column.** Issue and Job merge: the issue, else the job. The job of an issue event stays one click away on the issue. Keeps `table.md`: id, then title, numbers at the right.
- **B, ids lead the title.** Four columns. By, the job of an issue event and Took share one muted cell at the right (`td.tail`). Took stays at the right edge, as `table.md` puts numbers.
- **C, B with day rows.** `tr.day` marks each day, so a clock time reads in its day. `table.md` puts the time first in an event log; the day row keeps that.

New classes in `mock.css`: `.ref`, `td.tail`, `tr.day`. Each needs a home in `ui/app.css` and `design/components/table.md` if it is chosen.
