# Badge

A badge shows a state. It has square corners.

- Use: for a state or a priority.
- Not for: a label; use a chip.

## Helper

| Helper | Reference |
|---|---|
| `badge(state)`, `priorityBadge(p)`, `tag(text, tone, title)` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Badge | The state |  | `--fs-xs` `--fw-strong`; radius `--r-tag`; one line |
| Tone | The colour of the state |  | run, done, need or error: the tone on its `-bg`; quiet: `--muted` on `--sunk`; parked: a `--muted` outline |

## Rules

- For other short status text, use `tag()`.
- When you add a state, add it to the tone map of `tone()`. Do not add a class by hand. A tone comes only from `tone(state)`.

## Do and don't

| Do | Don't |
|---|---|
| `badge("failed")` | `tag("failed", "error")` |
| `badge("failed")` | a chip for a state |
