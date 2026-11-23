# KPI strip

The KPI strip shows the headline facts of a detail page.

- Use: once on a detail page.
- Not for: a list page; use metric cards.

## Helper

| Helper | Reference |
|---|---|
| `renderKpis([{ k, v, sub, text }])` in `ui/views/lib/timeline.js` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Strip | The cells |  | the detail panel box; cells 150px minimum, auto-fit |
| Key | The name of the fact |  | `--fs-xs`, `--muted` |
| Value | The fact |  | `--metric` `--fs-2xl` tabular; words: `--sans` `--fs-lg` |
| Sub | One line about the value | yes | `--fs-xs`, `--muted` |

## Rules

- `v` and `sub` are HTML: escape text with `esc()`.
- Set `text: true` when the value is words, not a number.
- Give at most 6 cells. The cells wrap at every width, 150px minimum each.
- A detail page opens with `statusRow()` and a KPI strip. The issue that builds a page chooses its KPIs with `aleph:datavis`.

## Do and don't

| Do | Don't |
|---|---|
| `{ k: "Took", v: dur(245) }` | `{ k: "Took", v: "245s" }` |
| `{ k: "Model", v: "opus", text: true }` | words in the number font |
