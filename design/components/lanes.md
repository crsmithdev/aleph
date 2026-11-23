# Lanes

Lanes show the runs of the issues that move now, one lane per issue, on one time axis.

- Use: inside a card, for the issues with a live run, as Issues in Motion on the Status page.
- Not for: the runs of one issue or one job; use the timeline.

## Helper

| Helper | Reference |
|---|---|
| `renderLanes(rows, from, to)`, `laneRow()` in `ui/views/lib/timeline.js` | `renderMotion()` in `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Legend | The tone of each bar shown |  | `legend` |
| Axis | Five clock times from `from` to `to`, and a stopwatch head |  | `--fs-xs` tabular, `--muted` |
| Head | The issue's id and title |  | `--fs-sm`; at most 300px; ends in an ellipsis |
| Lane | The issue's runs |  | as the timeline's lane |
| Took | The span from the first start to the last end of the issue's runs |  | `--fs-sm` tabular, at the right |

## Rules

- Make each row with `laneRow()`, as for the timeline.
- Start the axis at the first run of the shown lanes and end it at now, so the lanes take the card's full width.
- The axis is linear. A bar outside it is cut at its edge.
- The card gives the padding. The lanes do not scroll sideways: the head gives up width first, and in a column of 560px or less it takes its own line above the lane.
- With no rows, `renderLanes()` shows nothing. The card shows `empty()`.

## Do and don't

| Do | Don't |
|---|---|
| `card("Issues in Motion", renderLanes(rows, from, to))` | `renderTimeline()` inside a card |
