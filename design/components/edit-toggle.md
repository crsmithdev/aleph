# Edit toggle

An edit toggle turns a value into its editor in the same place. The reader clicks Edit, then Save or Cancel.

- Use: on a detail page, when most visits only read.
- Not for: a new item; use a form.
- Not for: a setting; use a settings list.

## Helper

| Helper | Reference |
|---|---|
| `editable(shown, editor)`; `wireEdit(root)`; `.editable` | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Container | `.editable`; it gets `.editing` while the reader edits |  |  |
| Value | What the value shows, in `.view-only` |  | hidden while editing |
| Editor | The control for the value, in `.edit-only` |  | hidden until editing |
| Buttons | Edit (`data-editor="start"`, `.view-only`); Cancel (`data-editor="cancel"`) and Save (`primary`, a submit button), both `.edit-only` |  | as a button |

## Rules

- `wireEdit(root)` toggles `.editing` on a click of a button with `data-editor`. Cancel resets the forms inside the container. Wiring a root again adds no listener.
- A control in `.edit-only` that sits apart from its form joins it with `form="id"`.
- Save posts the form. Show a failure with `say()` and leave edit mode open. A success reloads the page, which drops edit mode.

## Do and don't

| Do | Don't |
|---|---|
| `editable(esc(title), inputBox("title", title))` | the value and the editor as two blocks that the view hides |
| Cancel puts back the old value | Cancel that keeps the typed text |
