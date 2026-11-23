# List and group

A list stacks rows or cards. A group is a named part of a page or a card.

- Use: a list for the rows or cards of one section; a group for a part that a link goes to.
- Not for: items with the same columns; use a table.
- Not for: two cards side by side; use the pair.

## Helper

| Helper | Reference |
|---|---|
| `list(html)`; `group(id, html)` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| List | The rows or cards |  | `.list`: one column, `--sp-12` apart |
| Group | A part, with an `id` |  | `.grp`; `--sp-16` between groups |

## Rules

- Give each group an `id` that is unique on the page, so that a link can go to it.
- Do not put a group in a group.

## Do and don't

| Do | Don't |
|---|---|
| `list(rows.map(card).join(""))` | a `<div>` with a grid written by hand |
