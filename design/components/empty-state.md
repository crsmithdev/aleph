# Empty state

An empty state shows that there is nothing, that data loads, or that the data did not load.

- Use: in place of a table, a chart or a list that has nothing to show.
- Not for: the result of an action; use the form message.

## Helper

| Helper | Reference |
|---|---|
| `empty(line)`, `loadingLine(what)`, `error(line, { detail })`, `notice(line, bad, id)`; `loading(title)` in the router only | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Line | `No data`; an error line is one sentence |  | `--fs-sm`, `--muted`; an error `--error` |
| Loading | the spinner, then `Loading <what>…` |  | `--muted`; the spinner is `--dot-l` wide, a `--rule` ring with one `--muted` arc |

## Rules

- The router shows `loading()` while a page loads, and `error()` when the first load fails. A view does not call them for its own data.
- For a section that loads after the page, use `loadingLine(what)`: `Loading the diff…`. It is the only helper that draws the spinner; `loading(title)` and the metric card use the same mark.
- Every component that shows data draws `loadingLine` until its first fetch returns: a chart panel, a table, a panel. After the fetch, no data is `empty()` and a failed fetch is `error()`. The spinner never stands for either.
- A metric card whose figure waits for a fetch takes `loading: true` in `statCard`: the spinner sits in the trend slot, the value row stays blank at its height, and the card keeps its key and its link.
- A metric card whose fetch failed takes `failed: line` in `statCard`: a still `--error` ring with `!` sits in the trend slot, with the error line as its title. The spinner never stays after a fetch fails.
- Under `prefers-reduced-motion` the spinner does not turn; the ring stays as a static marker.
- Use `error(line, { detail })` for a second fetch inside a card that failed. The line is `Could not load X.`, in `--error` in a card too. The upstream message goes in `detail`, in a Technical details fold.
- Use `notice(line, bad)` for a note above data that still shows: a stale reload (`bad`, `role="alert"`) or a partial count. Do not write a `<p>` for it by hand.
- `empty()` and `error()` take no hint.

## Do and don't

| Do | Don't |
|---|---|
| `empty()` | `<p class="quiet">No data</p>` by hand, or a sentence and a hint |
| `error("Could not load the agents.", { detail })` | `Error: fetch failed`, or a hint line |
