# Field and form

A field is a label over a control. A form stacks fields under one submit button.

- Use: to file or create something with many values.
- Not for: one setting on a settings page; use a settings list.

## Helper

| Helper | Reference |
|---|---|
| `field(label, control, { hint, check })`; `inputBox(name, value, { id, type, attrs })`; `form(ui, fields, submit)` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Label | The name of the value |  | `--fs-xs`, `--muted`, over the control |
| Control | An input, a select, a textarea, a file input |  | `--sans` `--fs-sm`, border `--rule`; the full width, to 640px |
| Hint | The format or the effect, in one line | yes | `--fs-xs`, `--muted` |
| Submit | The button, `primary`, and the form message beside it |  | as a button |

## Rules

- `field(label, control)` wraps the control in its label, so the label names it. A checkbox goes first: `field(text, input, { check: true })`.
- Name the submit button with the verb and the object: `File issue`, not `Submit`.
- Wire `submit` on the `data-ui` key of the form. Show a failure in the `.act-msg` with `say()`. A success reloads or redraws.
- Put a fold around a form that is not the point of the page.

## Do and don't

| Do | Don't |
|---|---|
| `form("issue-form", [field("Title", inputBox("title"))], "File issue")` | a form built from `div` and `label` tags by hand |
| `File issue` | `Submit` |
