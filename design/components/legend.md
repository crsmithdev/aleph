# Legend

A legend gives the colour of each series in a chart that is not a chart panel.

- Use: with a chart that you draw yourself from the timeline classes.
- Not for: a chart panel or the timeline; each has its own legend.

## Helper

| Helper | Reference |
|---|---|
| `legendHtml([[label, cls]])` | `ui/views/lib/timeline.js`; `renderEfficiency()` in `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Item | The name of one series |  | `--fs-xs`, `--muted`; one row that wraps |
| Swatch | The colour of the series | yes | its `t-*` class; a small block, radius `--r-hair`; a mark (`t-made`, `t-done`) is a narrow, tall bar |

## Rules

- Set `cls` to a timeline class: `t-build`, `t-bad`, `t-land`, `t-aux`, `t-wait`, `t-chris`, `t-made` or `t-done`; to an outcome class, `seg-landed` to `seg-dropped`; or, under a bare chart with no legend of its own, to the `c-*` class of each key's colour. With no `cls`, the item has no swatch.
- Put the legend in the aside of the panel that holds the chart, or under a bare chart.

## Do and don't

| Do | Don't |
|---|---|
| `legendHtml([["build", "t-build"], ["land", "t-land"]])` | a legend with colours set inline |
