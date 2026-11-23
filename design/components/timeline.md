# Timeline

The timeline shows the runs of an issue or a job over time, with their events.

- Use: once on an issue page or a job page. It makes its own panel.
- Not for: values over time; use a chart panel.

## Helper

| Helper | Reference |
|---|---|
| `renderTimeline(segments)`, `laneRow()` in `ui/views/lib/timeline.js` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Axis | The times |  | `--fs-xs` tabular, `--muted` |
| Head | The name of the run |  | `--fs-sm`; 160px to 220px |
| Lane | The bars, waits and marks of the run |  | `--bg`, 22px high, radius `--r-tag` |
| Bar | One step of the run |  | `--fs-2xs` `--fw-mid`, `--on-fill` on its `--fill-*` token; lower than its lane |
| Wait | A time with no work | yes | stripes of `--rule`; a wait for the user: `--need` on `--need-bg` |
| Mark | A point in time | yes | made `--muted`, done `--ink`; a thin bar |
| Result, time, cost | The end of the run |  | badge; `--fs-sm` tabular |
| Event | One event of the run | yes | `--fs-sm`; time `--fs-xs` tabular `--muted` |

## Rules

- `renderTimeline()` makes the whole panel: its title, its legend and its rows. Do not wrap it, and do not add a legend.
- Give `segments` as `[{ title, aside, rows }]`. Make each row with `laneRow()`. It sets the tones of the bars, the waits, the time and the cost from the runs. Do not set a tone by hand.
- A bar with no link takes focus. Each bar names its state in its text, not only in `title`.
- Put the events of a run under its row. A long event is clamped.
- With no rows, `renderTimeline()` shows nothing.
- Under 740px, the timeline scrolls sideways.

## Do and don't

| Do | Don't |
|---|---|
| `renderTimeline(segments)` on its own | `detailPanel("Timeline", legendHtml(…), renderTimeline(…))` |
