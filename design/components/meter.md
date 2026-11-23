# Meter

A meter shows one share of a whole, or the segments of a whole.

- Use: for a share of a known whole.
- Not for: a value over time; use a chart panel.

## Helper

| Helper | Reference |
|---|---|
| `meter(parts, label, { mark })`; `barRow(label, pct, value, { top, key, on })` in `barList(rows)` | `ui/views/memory.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Track | The whole |  | `--sunk`, `--bar-h` high, radius `--r-hair` |
| Fill | The share, or one segment |  | `--muted`; the largest row `--hot`; a segment its class |
| Mark | A target, or the time gone | yes | `--ink`, a thin bar |
| Bar list label | The name of the row | bar list only | `--fs-sm`, `--ink`; 80px to 200px |
| Bar list value | The value of the row | bar list only | tabular, `--ink-2`; at the right |
| Selected row | The row that `key` selects | yes | `--sunk`; label `--fw-strong` |

## Rules

- Give one percent, or segments as `{ pct, cls }`.
- Give a `label` as the text alternative. Leave it out only when the value shows next to the meter.
- The meter has no width of its own. Its container gives it one.
- For rows of a label, a meter and a value, use `barRow()` in `barList()`. Set `top` on the largest row.

## Do and don't

| Do | Don't |
|---|---|
| `meter(42, "42% used")` | a meter with no label and no value next to it |
| `barRow(…, { top: true })` on the largest row | `--hot` set by hand |
