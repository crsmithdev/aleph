# Page head

The page head is the first part of a page. It shows the title, the view tabs, a count and the controls of the page.

- Use: once at the top of each page.
- Not for: a section title; use the card.

## Helper

| Helper | Reference |
|---|---|
| `pageViews({ title, path, query, views })` in `ui/views/lib/page.js`; `pageHead(title, { count, aside, after })`; `crumb(back, parts)`; `scope().bar({ after })` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Crumb | The path to the page | yes; detail pages only | `--mono` `--fs-sm`, `--muted`; a link is `--ink` on hover |
| Title | The name of the page |  | `--display` `--fs-xl`, `--ink` |
| View tabs | One button for each view of the page, in a segmented control, after the title | yes; a page of one view has none | a `seg()`; the current view has `aria-pressed` |
| Count | The number of items on the page | yes | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| Controls | The Project select and the window, then the controls of the page | yes; only on a view that the window or project changes | `--fs-xs`, `--muted`; at the right; wraps |

## Rules

- On a detail page, put `crumb()` above the head.
- On a page of views, call `pageViews()` in `render`. Each view is `{ id, label, scope, draw }`; `draw()` gives its HTML. The page shows the head, its attention rows, then the current view.
- The current view is the `view` of the address (`#/issues?view=flow`). The first view is the default and leaves no `view` in the address. A tab click sets it and draws the page again, with no reload.
- Order the views as: the things the page lists, then their analysis, then the log or the settings. At most three. The first tab names the things (`Roles`, `Notes`); where that is the page's own name, it reads `List`.
- The controls of the head are `scope().bar()`: the Project select and the window first, then `after` for the controls of the page. `pageViews()` draws it.
- Set `scope: true` on a view that the window or the project changes. The head shows the control on that view only.
- A detail page has no Project select.
- Keep the project and the window in the address: call `scope().wire(root)` in `mount`.
- The Status page head has no title and no count. It reads `<time> <status sentence>`, both in the tone of `verdict()`, with the window and Pause or Resume at the right. The time is muted (`--muted`) and never takes the status tone; only the sentence does. Keep it: the Status head is the factory's status at a glance, and a title would push that sentence down.

## Do and don't

| Do | Don't |
|---|---|
| `pageViews({ title: "Issues", path: "/issues", query, views })` | a tab row that a view builds itself |
| the window control on the view it changes | a window control that does nothing |
