# Metric card

A metric card shows one headline number of a list page, with its key.

- Use: for the headline numbers of a list page.
- Not for: a detail page; use the KPI strip. A number that needs more than these parts goes in a table under the cards.

## Helper

| Helper | Reference |
|---|---|
| `statCard({ k, v, v2, q, note, trend, extra, href, key, on, loading, failed })` in `tiles(label, html)`; `cardTrend()`; `onTile()` | `statusCards()` in `ui/views/lib/flow-parts.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The card |  | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card`, padding `--sp-12` `--sp-14` |
| Key `k` | The measure |  | `--sans` `--fs-xs` `--fw-strong`, capitals, `--muted`; breaks only between words, on up to two lines; the trend stays at the right and the row keeps two lines of height |
| Trend | The change from the baseline; the spinner while a figure waits, the failed ring when its fetch failed | yes | `--fs-sm` `--fw-strong`, a pill (radius `--r-pill`); `--good` on `--done-bg` when good, `--need` on `--need-bg` when bad, else `--muted` on `--sunk` |
| Value `v` | The number |  | `--metric` `--fw-strong`, `-0.025em`, from `--fs-metric-min` up to `--fs-metric`, tabular, `--ink`; one line |
| Later values `v2` | A second number after ` / `, such as the cap; an array gives a third number on, each like the second | yes | `--metric` at .62em, `--fw-strong`, `--ink-2` |
| Bar `extra` | A meter | yes | the meter |
| Qualifier `q` or `note` | The name of each value, or a note |  | `--fs-xs`; one line; first name `--ink`, each later name `--muted` |

## Rules

- Write the key in two or three words. The CSS sets it in capitals.
- When the fetch answered and the value is unknown, write `–`. Give no note to explain it. While the fetch waits or after it failed, leave `v` and `v2` undefined: the value row stays blank at its height.
- With `v2`, give `q` as `[first, second]`, or with three values `[first, second, third]`: one name for each value, in lower case, in one word or a few words.
- With no `v2`, you can give a `note` in place of `q`, in one or two words. Put a definition in a tooltip, not in the note.
- Make the trend only with `cardTrend(value, base, prev, { kind, lowerIsGood, format, basis })`. Set `kind` to `points` for a share, and to `relative` for a time or a count. Set `lowerIsGood` to `null` when no direction is good. With no baseline, `cardTrend()` shows nothing.
- Put only a `meter()` or a column of status lights in `extra`.
- For a link to another page, give `href`. For a card that selects the view under it, give `key`, set `on` on the selected card, and connect the cards with `onTile()`.

## Do and don't

| Do | Don't |
|---|---|
| `statCard({ k: "Worker slots", v: "2", v2: "5", q: ["in use", "cap"] })` | `v2` with no `q` |
| `statCard({ k: "Jobs", v: "3", v2: ["5", "2"], q: ["running", "queued", "error"] })` | `v: "3 / 5 / 2"` in one string |
| `q: ["in use", "cap"]` | `q: ["In Use", "Maximum Capacity"]` |
| `k: "Worker slots"` | `k: "Worker slots in use right now"` |
| `v: "–"` | `v: "0"` for an unknown value |
| `statCard({ k: "Success", q, loading: !d, failed: d?.error ?? "" })` | `v: "–"` while the fetch waits or after it failed |
| `note: "stale"` | `note: "2% off this machine, stale data"` |
