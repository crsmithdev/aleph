# Button

A button starts an action on the server.

- Use: for an action.
- Not for: a link to another page; use the link button.

## Helper

| Helper | Reference |
|---|---|
| `actButton(label, data, { primary, kind, cls })` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Button | A verb |  | `--sans` `--fs-sm` `--fw-mid`, `--ink` on `--surface`, border `--rule`; `--ctl-h` high; radius `--r-ctl`; border `--ink-2` on hover |
| Primary | The main action | yes | `--surface` on `--ink` |
| Warn | An action that stops or drops work | yes | `--need` on `--need-bg`, border `--need` |
| Danger | An action that cannot be undone | yes | `--error` text |
| Small | An action in a row | yes | padding `--sp-6`, `--fs-2xs` |
| Always | An action that a card marks as always allowed | yes | border and text in the colour `--k` of the card, else `--ink-2` |

## Rules

- Write the label as a short verb.
- Give `act`, `path` and `label` in `data`. Give `body` as a JSON string when the request has one, and `name` to keep the message across a refresh. `ui/views/lib/router.js` sends the request. Do not use `diff` or `always` as `act`: the router handles them on their own.
- While the request runs, the router disables every button of the row. On success it removes the card and reloads the page. On failure it enables the buttons again and writes the form message.
- Use one `primary` button in a group, or none.
- Set `kind` to `danger`, `small` or `always`. Each has its own style.
- Set `cls: "warn"` on an action that stops or drops work.
- For Land, Drop and Pause, add `confirm` (`two-click-confirm`).

## Do and don't

| Do | Don't |
|---|---|
| `Retry`, `Land` | `Click to retry this job` |
| one primary button | two primary buttons side by side |
