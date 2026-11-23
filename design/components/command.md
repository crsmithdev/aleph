# Command

A command box shows a command for the reader to run. A click copies it.

- Use: for a command that the reader runs in a shell.
- Not for: code in prose; use Markdown and code.

## Helper

| Helper | Reference |
|---|---|
| `cmd(text, { primary, hint })` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The command |  | `--mono` `--fs-sm` `--fw-mid`, `--ink` on `--sunk`, border `--rule`, radius `--r-ctl`; wraps |
| Hint | A note on the command | yes | `--sans` `--fs-xs` |
| Copy | The word `Copy` |  | `--sans` `--fs-xs`; a rule before it |
| Primary | The command that the page asks for | yes | `--surface` on `--ink` |

## Rules

- Use one `primary` command on a page, or none.

## Do and don't

| Do | Don't |
|---|---|
| `cmd("aleph issue list aleph")` | a `<pre>` that the reader must select to copy |
