# Row and cell

A row and a cell build the body of a `dataTable()`.

- Use: for each row of a table of text and numbers.
- Not for: a cell with markup, such as a badge or a link; write its `<td>` and pass it to `row()`.

## Helper

| Helper | Reference |
|---|---|
| `row(cells)`; `cell(v, { num, wide, title })` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Row | The cells of one item |  | a `<tr>` |
| Cell | One text value, escaped |  | a `<td>`; `num` adds `td.num`, `wide` adds `td.wide` |
| Title | The full text of a cell that can end in an ellipsis |  | the `title` of the cell |

## Rules

- `cell()` escapes `v`. Give it text, not HTML.
- A `wide` cell gets its text as its `title`. Give `title` to set another.
- Show a missing value with `miss(reason)` in a `<td>` of your own, not with an empty `cell()`.

## Do and don't

| Do | Don't |
|---|---|
| `row([cell(id), cell(title, { wide: true }), cell(count(n), { num: true })])` | a `<tr>` string written by hand for text cells |
