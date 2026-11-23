# Status light

A status light shows whether one thing is up: a dot and a word.

- Use: for the state of a service or a backend, inside a metric card or a row.
- Not for: the state of a job or an issue; use a badge.
- Not for: a log row; use a table row.

## Helper

| Helper | Reference |
|---|---|
| `statusLight(state, label)` | `ui/views/factory-agents.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Dot | The state: `fine` is `--done`, `alert` is `--error`, anything else is unknown and `--muted` |  | `--dot-s` round |
| Label | The name and the state in words: `Local server: up` |  | the text of the parent |

## Rules

- Give the state in words too. A colour alone is not enough.
- When the state is not known, pass `unknown` and write `–` in the label: `OpenRouter: –`. Do not show it as `down`.

## Do and don't

| Do | Don't |
|---|---|
| `statusLight("alert", "OpenRouter: down")` | `<span class="event-dot alert">` written by hand |
| `statusLight("unknown", "Monitor: –")` | a green dot for a state that nobody read |
