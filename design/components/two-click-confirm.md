# Two-click confirm

The two-click confirm asks for a second click before an action that is hard to undo.

- Use: for Land, Drop and Pause, and for an answer that needs a reason.
- Not for: an action that is easy to undo.

## Helper

| Helper | Reference |
|---|---|
| `confirm` in the `data` of `actButton()`; `ui/views/lib/router.js`. For a handler of your own, `arm(btn, text)` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Asking button | `<label> <name>? Click again` |  | `--need` on `--need-bg`, border `--need` |
| Reason box | The reason | yes | the full width of the row |

## Rules

- Give `label` in `data` too, and `name` when the action has an object. The first click changes the text to `<label> <name>? Click again`, or `<label>? Click again` with no `name`, for 5 seconds.
- For an answer that needs a reason, put the button in a `.choice` with an `input.reason`. The first click opens the box, and the label changes to `Confirm`.
- In a handler of your own, call `arm(btn, text)` on each click. It returns `true` when it armed the button, so stop; it returns `false` on the second click, so go on. Do not keep the armed state in a `data-` attribute or a timer of your own.

## Do and don't

| Do | Don't |
|---|---|
| `actButton("Drop", { act: "drop", path, name: "a1700", confirm: "1", label: "Drop" })` | `confirm()` from the browser |
| `if (arm(btn, "Drop a1700? Click again")) return;` | a second hand-written armed state |
