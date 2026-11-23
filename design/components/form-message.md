# Form message

A form message shows the result of an action, next to its button.

- Use: after an action fails, and only then. A success shows by the reload.
- Not for: a page that did not load; use `error()`.

## Helper

| Helper | Reference |
|---|---|
| the router, for `actButton()`; `say(el, text)` for a handler the view wires itself | `ui/views/lib/router.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Message | What failed and why, in one line |  | `--fs-sm`, `--error` |

## Rules

- For an `actButton()` button, the router writes `<act> failed: <reason>`. Do not write it yourself.
- In a handler of your own, call `say()` with what failed, then why. `say()` writes into the `.act-msg` of the button's parent, else adds one after the button.
- Do not use `say()` for a success.

## Do and don't

| Do | Don't |
|---|---|
| `land failed: the branch has conflicts` | `say(btn, "Saved.")` |
