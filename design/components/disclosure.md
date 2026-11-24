# Disclosure

A disclosure is a fold. It hides detail until the reader opens it.

- Use: for detail that most readers do not need.
- Not for: a section of a detail page; use `detailPanel()`.

## Helper

| Helper | Reference |
|---|---|
| `fold(summary, body, { open, keep, cls, head })`; `moreFold(items, row)`; `clamp(html)`; `wireFolds()`, `restoreFolds()` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Fold | The detail |  | rule `--rule-2` above; `--sp-10` above |
| Summary | What the fold holds |  | `--fs-sm`, `--ink-2` |
| Marker | `+` when closed, `−` when open |  | `--mono`, `--muted` |

## Rules

- Keep the fold closed, unless the reader came to the page for its content.
- The router keeps open folds across a refresh. To keep a fold's state across page loads too, pass `keep`.
- For a long list, use `moreFold()`: 10 items, then a fold.
- For long text, use `clamp()`: 3 lines, then Show more.
- At the end of a card, put technical details in `fold("Technical details", body, { cls: "more" })`.
- In a table row, keep the count on the title's line: ``fold(`<span>${title}</span>${n} more`, body, { cls: "line" })``.

## Do and don't

| Do | Don't |
|---|---|
| `<summary>12 more</summary>` | `<summary>More</summary>` |
| a closed fold | an open fold of logs |
