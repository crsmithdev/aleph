# Table

A table shows items that have the same columns.

- Use: for a list of items.
- Not for: the properties of one item; use a fact list.

## Helper

| Helper | Reference |
|---|---|
| `dataTable(head, rows, { fit })`; `heads(labels, num)`, `sortHead()`, `iconHead(icon, label)`; `dayRow(text, cols)`; `pagedTable()`; `badCount(n)` | `ui/views/jobs.js`; `renderLog()` in `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Header | The name of each column |  | `--sans` `--fs-xs` `--fw-strong`, `--muted`; the sorted column `--ink` |
| Cell | One value |  | `--fs-sm`, `--ink`; padding `--sp-6` `--sp-12` `--sp-6` 0; rule `--rule-2` below; one line |
| Title cell `td.wide` | The title of the item |  | takes the spare width, 16ch minimum; ends in an ellipsis |
| Number cell `td.num` | A number |  | `--num` `--fw-mid` tabular; at the right |
| Icon head | A clock over the time of an event, a stopwatch over a duration | yes | `wa-icon`, `--muted`; its name in `title` and `aria-label` |
| Sort arrow | `▲` or `▼` | yes | `--fs-xs` |
| Row | One item |  | `--sunk` on hover |
| Day row `tr.day` | The day of the event rows under it, as `day()` writes it | yes | a header cell across the row; `--sp-12` above |
| Row action | One small button in the last column, `td.acts` | yes | right-aligned, one line |

## Rules

- Put the columns in this order: the row's fold button, id or name, title, state, priority, project, labels, numbers, then time.
- Give the fold column no name: its header cell is empty. A row with no parts keeps an empty cell there, so the ids line up.
- In an event log, put the time first. An event log is a table where each row is an event, read in time order.
- In an event log, start each day with `dayRow(day(t), cols)`, and the first row of each page too.
- In a narrow table, head the time column with `iconHead("clock", label)` and the duration column with `iconHead("stopwatch", "Took")`. A stopwatch column is a number column.
- Put each number at the right of the row. Align a number to the right.
- Name the time column for the time it shows. Format it with `when()`.
- Make an id with `idLink()` or `repoIdLink()`, a state with `badge()`, and labels with `chips()`.
- Put the title in `td.wide`. Do not let other cells wrap.
- Put each number in `td.num`. For `heads()`, list the column's label in `num`. For `sortHead()`, pass `{ num: true }`.
- Make a count of bad things, such as errors or failures, with `badCount()`. It turns `--error` above 0.
- Put the time in `td.time`. It aligns to the right. For `heads()`, list its label in `num`. For `sortHead()`, pass `{ num: true }`. A time that comes first goes in `td.time.lead`, which aligns to the left.
- When a row goes to a page, make it `tr.rowlink` and put the link in `td.wide`.
- To sort, use `sortHead()` and `sortRows()`. Keep the sort in the address as `sort` and `dir`.
- When there are more than 50 rows, use `pagedTable()`, or `pager()` with `pageOf()` and `pageRows()`.
- For a short table of names and numbers, set `fit: true`.
- Make a row with `row(cells)` and a cell of text with `cell(v, { num, wide, title })` (`row-and-cell`).
- A row action goes in a last `td.acts` column, as a small button (`row-actions`). A data cell never holds a button.
- On a phone, the table scrolls sideways in `.tscroll`.

## Do and don't

| Do | Don't |
|---|---|
| `Started`, `Updated`, `Committed` | `Time`, `Date` |
| `Last Turn`, `Last Run` for the newest of many | `Latest` |
| `Took` for a duration | `Duration`, `Elapsed` |
| numbers in `td.num` | numbers at the left |
