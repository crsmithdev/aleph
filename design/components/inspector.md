# Inspector

The inspector is the detail of the selected row of a list surface.

- Use: inside a list surface.
- Not for: a page of its own; the detail pages stay behind Open page.

## Helper

| Helper | Reference |
|---|---|
| `inspector({ id, title, status, rows, body, href })` in `ui/views/lib/browse.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Head | The id and Open page |  | `.inspect-head` |
| Title | The item's title |  | `h3` |
| Status | The state, the priority and the labels | yes | `statusRow()` |
| Facts | The item's facts |  | `facts()`; an empty value leaves its fact out |
| Body | A strip, a table or a form, under a `subHead()` | yes |  |

## Rules

- A table in the inspector keeps its height: its scroll box does not shrink in the card.
- Put a setting in the inspector as a `setting()` row; its Save shows after a change.
- The inspector has no card inside it.
