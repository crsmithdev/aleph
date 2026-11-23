# Diff

A diff shows the lines that a change adds and deletes.

- Use: for the change of a job.
- Not for: other code; use a code block.

## Helper

| Helper | Reference |
|---|---|
| `diffHtml(text)` into `.diff-panel` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Panel | The diff |  | `--mono` `--fs-xs` on `--sunk`, border `--rule`, radius `--r-ctl`; 480px high maximum, then scrolls |
| Added line | A line that the change adds |  | `--add` |
| Deleted line | A line that the change deletes |  | `--del` |
| Hunk | The place of the change |  | `--muted` |

## Rules

- Do not colour a diff line by hand. `diffHtml()` reads the first character of each line.

## Do and don't

| Do | Don't |
|---|---|
| `diffHtml(patch)` | `--done` and `--error` on diff lines |
