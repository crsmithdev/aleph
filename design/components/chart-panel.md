# Chart panel

A chart panel is a card that draws a chart from a frame (`ui/views/lib/chart.js`).

- Use: for a value over time, or for values by category.
- Not for: a share of one whole; use a meter. A single value; use a metric card.

## Helper

| Helper | Reference |
|---|---|
| `panelOf(key, frame)` in `ui/views/lib/chart.js` | `ui/views/factory-agents.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The chart |  | the card box |
| Title | `<measure> by <dimension>`, from the frame |  | the card title |
| Form menu | The forms of the chart, in one menu |  | a `selectBox()` in the aside |
| Legend | One item for each series | yes | `--fs-xs`; at the top |
| Plot | The series |  | labels `--chart`, `--fs-xs` times `--chart-scale`, `--chart-weight`, `--ink`; lines `--rule`; 200px high minimum |

## Rules

- Call `panelOf()` in `render`. Set the `frame` of the element in `mount`.
  - except: ui/views/session.js: the session waterfall draws a chart outside the chart panel.
- Give each chart its own `key`, as `<view>/<chart>`.
- Do not write the title. The frame gives it.
- Set `measure.unit` to `count`, `usd` or `seconds`. The unit sets the format of the axis and the tooltip.
- Set `measure.agg` to `sum` for a flow, and to `max` for a level. A flow opens as Columns. A level opens as Area.
- Show one measure on one value axis. For two measures, use two panels.
- A key in `by` with no `color` takes the next of `series-1` to `series-5`, `chart-6`, `chart-7`, by its place among the keys with a value. For a state, set `color` to the colour of `tone(state)`: `run`, `done`, `need` or `error`. Two states can share a colour, such as Failed and Error, which are both `error` in the Design page's outcome chart; the legend tells them apart. Other allowed values: `hot`, `muted`, `series-1` to `series-5`, `chart-6`, `chart-7`. `quiet` and `parked` are not chart colours.
- Keep the colour of a key the same in all windows. If a key can have no value in a window, set `color` on each key, because the keys after it move up one colour.
- Show at most seven keys. Fold the rest into one key, `Other`.
- Show a legend. When the frame has one key and the title names it, set `legend: false`.
- When there is no data, the panel shows `empty()`. A frame has no empty line, hint or note of its own.
- A linked row is also a link in a list under the chart, for the keyboard. The list shows when a link has focus.
- When the data did not rebuild, give `error` and `since`. The panel tells how old the data is.
- Pick the form with the one menu in the aside. Do not draw a button for each form.
- Put two or three panels side by side in `.trio`, which has three columns. With two panels, give one the class `wide`: `panelOf(key, frame, "wide")`. Under 1100px, they stack.
- Put four panels of equal width in one row in `.quad`. In `.quad`, each panel's form control sits under its title. Under 1100px, they stack.
- For a chart that is one part of a card, such as a side of a split card, call `panelOf(key, frame, "", { bare: true })`. A bare chart has no card, no title and no form control: it opens in the frame's `form`, and its plot is 160px high minimum. Put its title in `subHead()` above it, unless the card's title names it.
- Set `cap` on a columns frame when one bucket can flatten the rest, in the measure's unit. A column past the cap is cut there and labelled with its total in `--need`. Prefer a median to a cap for a slow tail: the cap is for a whole bucket that is slow.

## Do and don't

| Do | Don't |
|---|---|
| `color: "done"` in a frame's `by` | a hex colour in a series |
| a legend on a stacked chart | a stacked chart with no legend |
| `panelOf("agents/cost", frame)` | an ECharts instance made by the view |
| `cap: 1800` on a frame of medians in seconds | a log axis, or an axis max set by the view |
