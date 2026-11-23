# Chip

A chip shows a label. It has round ends.

- Use: for the labels of an item.
- Not for: a state; use a badge.

## Helper

| Helper | Reference |
|---|---|
| `chips(labels)` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Chip | One label |  | `--fs-xs`, `--ink-2` on `--sunk`; radius `--r-pill`; one line; 16ch maximum in a table |

## Rules

- When there are no labels, `chips()` shows nothing. Do not write a placeholder.
- A name that is not a state, such as an actor, is a `chip()`, not a badge.

## Do and don't

| Do | Don't |
|---|---|
| `chips(["ui", "css"])` | a badge for a label |
| nothing for no labels | `–` for no labels |
