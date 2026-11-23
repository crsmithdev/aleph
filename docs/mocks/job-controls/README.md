# Job lifecycle control mocks

Request (the user, 2026-11-14): give the Job page controls for the job's lifecycle. Cancel at least, maybe
pause and resume in place of the `parked` status, and maybe a force run that starts a job ahead of its priority or
queue place unless a dependency blocks it.

Serve this directory and open `index.html`. The bar at the top switches the layout, the job state and what Pause
means. `page.html` is the real Job page of job.8747 (issue a2852), rendered by `renderJob` on 2026-11-14, with its
header actions and status row taken out. `app.css` is a copy of `ui/app.css` from the same day.

## Layouts

| Layout | What it does |
|---|---|
| A · header buttons | The lifecycle buttons replace the copy-command chips in the header. Each state shows only the buttons that apply. |
| B · lifecycle strip | A strip under the title shows queued, running, waiting, landed, the reason, and the actions on one line. |
| C · one action + menu | The header shows the one next action. The rest sit in a ⋯ menu, with Cancel last. |

## Decisions in the mock

- Buttons per state: queued has Run now, Pause, Cancel. Running has Pause, Cancel. Paused has Resume, Cancel.
  Waiting has Land, Recheck, Pause, Cancel. Landed has none.
- Run now is disabled, with the reason, when the issue waits on an unfinished `after` dependency.
- Cancel opens one dialog with three outcomes: park the issue (default), restart (`aleph drop` today), drop the issue.
  `aleph drop` leaves the issue open, so the dispatch starts it again.
- The paused badge uses the existing `.badge.parked` style.

## Open

- Pause vs `parked`: one state or two, and its name. `paused` is already the hold word of the factory-wide pause.
- What Pause does to a live run: finish and not land (aleph-1964), or stop now and keep the branch.
- Which gates Run now skips: the priority order and the live cap only, or also a busy file or a red baseline.
- Run now for an issue with no job yet belongs on the issue page.
