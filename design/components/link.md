# Link

A link goes to another page, or does a small action in place.

- Use: for navigation in text, ids and rows.
- Not for: a link that must look like a button; use the link button.

## Helper

| Helper | Reference |
|---|---|
| `idLink(id, href)`, `repoIdLink()`; `crumb()`; `tr.rowlink`; `button.link` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Prose link | A link in `.md` text | yes | the text colour; underlined |
| Id link | The short id of an item | yes | `--mono` `--fs-xs` `--fw-mid`, `--muted`; `--ink` and underlined on hover |
| Row link | A table row that goes to its item | yes | the whole row is the target; the `<a>` is in `td.wide` |
| Text button | A small action in place, such as Show more | yes | `--run`; underlined on hover |

## Rules

- Make an id with `idLink()` or `repoIdLink()`, never with a plain `<a>`. With no `href`, `idLink()` draws a `span.idp`.
- Make a row that goes to a page with `tr.rowlink`, and put its one link in `td.wide`.
- Use `button.link` for an action that stays on the page. Use `<a>` only to go to another address.

## Do and don't

| Do | Don't |
|---|---|
| `idLink("a1700", "#/issues/1700")` | `<a href="#/issues/1700">a1700</a>` |
| `<button class="link">Show more</button>` | `<a href="#">Show more</a>` |
