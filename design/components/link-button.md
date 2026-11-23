# Link button

A link button goes to another page. It looks like a button.

- Use: for navigation only: Issue, Next sub-issue, Trace. A link to another page or tool in a head or an aside is a link button.
- Not for: an action; use the button.

## Helper

| Helper | Reference |
|---|---|
| `linkButton(label, href)` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Link | The name of the page |  | the button style; no underline |

## Rules

- Write the name of the page that the link opens.

## Do and don't

| Do | Don't |
|---|---|
| `linkButton("Issue", "#/issues/1700")` | a `<button>` that sets `location` |
