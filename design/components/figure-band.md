# Figure band

The figure band is the headline figures of an analysis view, each with what it compares with.

- Use: at the top of an analysis view.
- Not for: a list view; use the facts line.

## Helper

| Helper | Reference |
|---|---|
| `figureBand([{ k, v, cmp, trend, title }])` in `ui/views/lib/page.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Key | What the figure is |  | `--fs-xs`, `--muted` |
| Value | The figure |  | `--metric` `--fs-2xl`, `--ink` |
| Comparison | What it compares with: the baseline, the last week or the limit |  | `--fs-xs`, `--muted`; `good` is `--good`, `warn` is `--need` |

## Rules

- Give at most 4 figures. A figure has a comparison: a figure with none is not a headline.
- One surface holds the band; hairlines split the figures.
- Set `title` to the definition, as a metric card does.

## Do and don't

| Do | Don't |
|---|---|
| `Cost $41` with `$38 last week` | a figure with no comparison |
