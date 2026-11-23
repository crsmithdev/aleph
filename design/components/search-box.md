# Search box

A search box is one text field over a table. It filters the rows by the text.

- Use: over a table that has more rows than a reader scans.
- Not for: a choice from a fixed set; use a filter in the filter bar.

## Helper

| Helper | Reference |
|---|---|
| `searchBox(ui, value, placeholder, action)` | `ui/views/factory-jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Field | The text to search for |  | `input[type="search"]` on `--sunk`; `--ctl-h` high; at least 240px wide, fills the row |
| Action | A `button.hint` that acts on the text, such as filing it | yes | inside the field's right end, `--fs-xs`, `--muted`; shows only while the field has text |

## Rules

- Name what it searches in the placeholder: `Search ids and titles`. The placeholder is the accessible name too.
- Put it above the filter bar, outside the part that redraws, so it keeps the focus.
- Send the text to the address with `setQuery({ q })` and draw the table again. Wait about 200 ms after a key. Do not fetch on each key.
- Use one size on every page. The wide field of the Memory page is a deviation.
- Give the action a key with a modifier, such as Ctrl+Enter, and name the key in its label. Plain Enter stays with the search.

## Do and don't

| Do | Don't |
|---|---|
| `searchBox("jobs-search", f.q, "Search ids and titles")` | `<input type="search">` written by hand |
| a placeholder that names the columns | `Search` |
