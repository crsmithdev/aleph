# Select

A select is an inline choice from a list that the data gives.

- Use: for one choice from many options, inside a field, a setting or a filter bar.
- Not for: a fixed set of two to five options; use a segmented control.

## Helper

| Helper | Reference |
|---|---|
| `selectBox(label, name, options, value, { id, attrs })` | `ui/views/factory-agents.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Select | The options, with the value selected |  | `--sans` `--fs-sm` on `--surface`, border `--rule`, radius `--r-ctl`; `--ctl-h` high |
| Option | A value and its label; `disabled` for one that cannot be chosen |  |  |

## Rules

- `label` is the accessible name. Always give it, even when a visible label stands beside the select.
- `options` are strings, or `{ value, label, disabled }`. Disable an option that is down. Do not leave it out, so the reader sees why.
- Wire the change in the view: a select with no Save button applies on `change`.

## Do and don't

| Do | Don't |
|---|---|
| `selectBox("Reviewer model", "model", offers, current)` | a `<select>` written by hand in a table cell |
| a disabled option for a backend that is down | no option for a backend that is down |
