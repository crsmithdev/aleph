# List surface

The list surface is one card that holds a search, the filters and the rows of a list, with the inspector of the selected row at its right.

- Use: for the things a page lists, when a row has more to tell than its columns.
- Not for: a table of numbers to compare; use `dataTable()`.

## Helper

| Helper | Reference |
|---|---|
| `browse({ id, label, search, hint, filters, groups, cap })` in `ui/views/lib/browse.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Search | A search box |  | `searchBox()` |
| Filters | Segmented controls, each led by All; a select past 3 options | yes | `filterBar()` |
| Group head | The group name and its count, then its column names |  | `sub-head`, `--num` `--muted` |
| Row | A lead (an id), a main cell (the title and its chips), then the cells |  | `--fs-sm`; a `--rule-2` line above |
| Selected row | The row the inspector shows |  | `--sunk`, a `--run` bar at the left |
| More line | How many of how many matches draw | yes | `--fs-xs`, `--muted` |
| Inspector | The selected row's detail (`inspector`) |  | a card at the right |

## Rules

- Every group's rows share one grid, so the columns line up across groups. `heads` names the cell columns; a group with fewer columns leaves its last ones empty.
- A row is `{ key, lead, main, cells, text, data, inspect }`. `text` is what the search matches. `data` holds the values the filters match. `inspect` is HTML, or a function that gives it: a row that is not drawn builds its inspector when a search brings it up.
- A group holds every row. The search and the filters match them all, and the group draws the first `cap` matches, with an "N of M" line counted against the matches. `browse({ cap })` limits all groups together, as the log of days needs. A `more` line is a note after the rows.
- A filter with more than 3 options is a select: its segments would run past a phone's width.
- A click or Enter or Space on a row selects it. A link, a button or a control in the row does not.
- The inspector stays in view as the page scrolls. Under 1100px it goes below the list. Under 720px a row wraps: the main cell first, the cells after it at the right.
- Start a filter on an option with `value` (`{ name: "who", options: ["yours", "factory"], value: "yours" }`). The reader's own pick wins after it.
- The search, the filters and the selected row stay through a redraw: `browse()` holds them. The filters and the selected row stay through a reload, kept under `browse.<id>`.
- When a search or a filter leaves no row, the list shows `empty("No match")`. A group with no rows shows `empty()` while no search or filter is on. A list with no rows shows one `empty()`.
- Show a row's defaults as nothing: no `medium`, no `aleph`, no zero.
- Group the rows by what the reader scans for (state, kind, day). Put the groups the reader needs first.

## Do and don't

| Do | Don't |
|---|---|
| one grid for every group | a table for each group |
| `inspect` holds the detail | a detail page for a glance |
