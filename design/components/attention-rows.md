# Attention rows

An attention row is one problem of a page: its tone, one line and the action that removes it.

- Use: under the page head, one row for each problem.
- Not for: an Ask that waits for the user; use an ask card.
- Not for: a number to watch; use the facts line or a metric card.

## Helper

| Helper | Reference |
|---|---|
| `attention(rows)` and `rowsOf(path)` in `ui/views/lib/page.js` and `ui/views/lib/attention.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Bar | The tone |  | `--error` or `--need`, a thick bar at the left, on `--surface` with `--card-lift` |
| Dot | The tone again |  | `event-dot` |
| Line | What is wrong, with its number |  | `--ink`; wraps |
| Action | The link that removes the problem | yes | `linkButton()`, at the right |

## Rules

- Each page's rows come from `GET /api/attention`, by the page's route: `{ "/hooks": [{ tone, text, act }] }`. The sidebar dot reads the same answer, so the dot and the rows never differ. Do not compute a row in a view.
- A row exists only while its problem does. Draw nothing for none.
- `tone` is `error` for a fault and `need` for something that waits. An `error` row has `role="alert"`; a `need` row has `role="status"`.
- Write the line in at most 12 words: the thing, then its number. Name the action in one word.
- The server builds each source from a fact it already holds. A source never calls `/api/issues`, `/api/jobs` or `/api/sessions`.

## Do and don't

| Do | Don't |
|---|---|
| `151 hook errors, 72 from a moved hook file` | `Some errors happened` |
| one row for each problem | one row that joins two problems |
