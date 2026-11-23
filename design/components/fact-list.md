# Fact list

A fact list shows the keys and values of one item.

- Use: for the properties of one item, or for the meta line of a row.
- Not for: many items; use a table.

## Helper

| Helper | Reference |
|---|---|
| `facts([[key, html]])` | `ui/views/session.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Key | The name of the fact, in one or two words |  | `--fs-sm`, `--muted` |
| Value | The fact |  | `--num` tabular, `--ink-2` |

## Rules

- The value is HTML: escape text with `esc()`.
- When a value is empty, `facts()` drops its row. Do not write a placeholder.

## Do and don't

| Do | Don't |
|---|---|
| `facts([["Started", when(t)], ["Took", dur(s)]])` | a two-column table of keys and values |
| `["Model", esc(name)]` | `["Model", name]` with text that is not escaped |
