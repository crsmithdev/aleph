# Markdown and code

Markdown shows prose. A code block shows code or output.

- Use: for prose from a file or a note.
- Not for: a command that the reader runs; use the command.

## Helper

| Helper | Reference |
|---|---|
| `md(src)` into `.md`; `codeText(t)` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Heading | A heading of the prose | yes | `--sans` `--fs-lg` `--fw-strong` |
| Inline code | A name or a value | yes | `--mono` `--fs-xs` |
| Code block | Code or output | yes | `--mono` `--fs-xs` on `--sunk`, radius `--r-tag`; long lines wrap |
| Table | A table in the prose | yes | `--fs-xs`, border `--rule` |

## Rules

- Keep prose at `--measure` (76 characters) wide or less. `.md` sets no width: put it in a `panel()`, or give its box `max-width: var(--measure)`.
- For code in a line of text, use `codeText()`.

## Do and don't

| Do | Don't |
|---|---|
| `md(spec)` | prose set as HTML by the view |
| `codeText("run `bun test`")` | backticks shown as text |
