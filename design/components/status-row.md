# Status row

The status row shows the state of the item on a detail page.

- Use: once on a detail page, under the page head.
- Not for: a list page; a row of a table shows its own state.

## Helper

| Helper | Reference |
|---|---|
| `statusRow()` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| State | The state of the item |  | a badge |
| Priority | The priority of the item |  | a priority badge |
| Labels | The part and the labels | yes | chips |

## Rules

- Put the parts in this order: state, priority, labels.

## Do and don't

| Do | Don't |
|---|---|
| `statusRow(badge("running"), priorityBadge("high"), chips(["ui"]))` | the state as words in a sentence |
