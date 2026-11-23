# Settings list

A settings list is a group of rows. Each row holds one setting: its label, its control and, when it needs one, a Save button.

- Use: for the settings of a page, such as the interval of a schedule or the model of a role.
- Not for: the fields of a new item; use a form.
- Not for: values to read; use a fact list or a table.

## Helper

| Helper | Reference |
|---|---|
| `settings(label, rows)`; `setting(label, control, { id, hint, save, attrs })` | `ui/views/gates.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| List | The rows, in one group with a name |  | at most 720px wide; rows split by a `--rule-2` line |
| Label | The name of the setting, in a `<label for>` |  | `--fs-sm`, `--ink`; 8 to 14rem wide |
| Control | An `inputBox()` or a `selectBox()`, and the Save button |  | `--sp-6` apart; `--ctl-h` high |
| Hint | The format or the effect | yes | `--fs-xs`, `--muted`, under the control |

## Rules

- Give the setting that needs a Save button `save: "Save"`. The row is then a form of its own, and the view wires `submit` on the attributes it gives in `attrs`, for example `' data-schedule="suite"'`. A row with no `save` is a `div`: the control applies on `change`.
- The Save button shows only after the control changes (`markDirty()` in `ui/views/lib/html.js`). The router runs it after each draw. A setting that is saved shows no button.
- Pass the same `id` to `setting()` and to the control, so the label names the control.
- Write a hint in at most four words, counting a number as a word. Put the rest in a `title` on the row, through `attrs`.
- Put the settings of one page in one list, or one list per card. Do not put a control or a Save button in a table cell. The one exception is a role row of the Roles list on the Agents page: its on/off box and its model `selectBox()` apply on `change`, with no Save.
- Show a setting that is read-only as text in the control place. Do not show a disabled control.
- Under 720px the label goes over the control, and the hint under it.
- Show a failure in the row with `say()`, from the Save button.

## Do and don't

| Do | Don't |
|---|---|
| `setting("Suite every", inputBox("every", v, { id }), { id, save: "Save" })` | an input and a Save button in a table cell |
| one row per setting, the hint under the control | one Save button for many settings that each apply at once |
