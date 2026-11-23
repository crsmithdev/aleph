# Filter bar

A filter bar is a row of filters over a table.

- Use: for the filters of one table.
- Not for: the filters of the whole page; put them in the page head.

## Helper

| Helper | Reference |
|---|---|
| `filterBar(groups)`; `searchBox(ui, value, placeholder, action)` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Label | The name of the filter |  | `--fs-xs`, `--muted` |
| Segmented control | A fixed set of options |  | `--sans` `--fs-sm`, `--muted`, border `--rule`, radius `--r-ctl`; `--ctl-h` high; scrolls inside itself |
| Pressed option | The option in use |  | `--fw-strong`, `--ink` on `--rule-2` |
| Select | Options from the data | yes | `--ctl-h` high |
| Search | Text to search for, from `searchBox()` | yes | on `--sunk`; `--ctl-h` high |

## Rules

- For options from the data, set `data: true` to get a select.
- Make the first option `{ value: "", label: "All" }`. An empty value keeps the filter out of the address.
- When a filter changes the data, use `goQuery()`. When it changes only what shows, use `setQuery()` and draw the table again.
- Put `searchBox()` above the filter bar, outside the part that redraws, so it keeps the focus.

## Do and don't

| Do | Don't |
|---|---|
| `{ value: "", label: "All" }` first | `"All"` as a value, which puts `?state=All` in the address |
