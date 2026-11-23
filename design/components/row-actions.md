# Row actions

Row actions are the buttons of one row or one card.

- Use: under the text of a row or a card.
- Not for: the actions of a page; put them in the page head.

## Helper

| Helper | Reference |
|---|---|
| `.actions` after the text of the row; `rowAct(label, data)` in a table | `ui/views/issues.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Row | The buttons and the form message |  | `--sp-8` apart, `--sp-14` above; wraps |

## Rules

- In a table, a row action sits in a last `td.acts` column, as a small button (`kind: "small"`): draw it with `rowAct()`. A data cell never holds a button.
- A setting that has a Save button goes in a settings list.
- Show the result with `say()`.

## Do and don't

| Do | Don't |
|---|---|
| actions under the text of a row; a small button in `td.acts` | a button in a data cell |
