# Row bars

A row bar is the evidence of a row in one cell: a bar of shares, a rate against its baseline, a strip of runs or a span on a log scale.

- Use: in a cell of a list row, where a row's own numbers would repeat the bar.
- Not for: a share of one whole beside its number; use a meter.

## Helper

| Helper | Reference |
|---|---|
| `rowBar(parts, label)`, `rateBar(rate, baseline)`, `runStrip(runs, most, { full, label })`, `logMeter(p50, p90, { lo, hi, label })` in `ui/views/lib/bars.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Bar | The shares, the rate or the runs |  | `--bar-h` high on `--sunk`; 120px for a row bar, 64px for a rate bar, 14em for a strip |
| Mark | The baseline of a rate, or the p90 of a span | yes | `--ink`, a thin bar |
| Rate | The rate, after its bar | yes; a rate bar only | `--num` |

## Rules

- Put the figures in the tooltip (`label`), not beside the bar.
- A rate under its baseline takes the `--need` tone.
- A segment of a strip is one run: its width is its seconds, its tone is `tone(state)`. A running run draws in `--run`. Under a strip at full width, put a `legendHtml()` of its tones.
- Use a log scale (`logMeter`) when the values run from seconds to days: a linear bar would show only the longest.
- Draw no bar for a row with nothing to show.

## Do and don't

| Do | Don't |
|---|---|
| `rateBar(0.62, 0.8)` | a rate in a cell with no baseline |
