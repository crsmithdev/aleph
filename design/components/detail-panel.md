# Detail panel

A detail panel is one section of a detail page. It has a head and a body.

- Use: for each section of an issue page or a job page.
- Not for: a section of a list page; use the card.

## Helper

| Helper | Reference |
|---|---|
| `panel(id, title, body, aside, cls)` and `detailPanel(title, aside, body)` in `ui/views/lib/timeline.js` | `ui/views/jobs.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The section |  | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card` |
| Head | The title of the section |  | `--sans` `--fs-lg` `--fw-strong`, `--ink`; padding `--sp-14` `--sp-18` |
| Aside | A note; in `detailPanel()`, text, a badge or a legend | yes | `--fs-sm`, `--muted` |
| Body | The content |  | `detailPanel()`: padding `--sp-10` `--sp-18` `--sp-14`; `panel()`: the padding of its `.md` |
| Code block | Logs or output | yes | `--mono` `--fs-xs`, `--ink-2` on `--sunk`, radius `--r-tag`; scrolls at 70% of the screen height |
| Mark | An agent's findings for Chris: the Investigation | yes | a thick left border in `--focus`, from `cls` `dp-marked` |

## Rules

- For prose (Spec, Result, Description), use `panel()`. Wrap the prose in `<div class="md">`: that wrapper gives the padding and the `--measure` (76ch) width.
- For a section that the reader can close, use `detailPanel()`. It is open at first. Its aside is inside the summary, so a click there opens or closes the panel: put controls in the body.
- When a section has no content, leave the panel out.
- Mark a panel only when it holds an agent's findings that Chris acts on. Give `panel()` the `cls` `dp-marked`. A page has at most one marked panel.
- For a panel body that is not prose, such as tables, wrap it in `<div class="dp-body">`.

## Do and don't

| Do | Don't |
|---|---|
| `panel("spec", "Spec", `<div class="md">${md(text)}</div>`)` | `card("Spec", …)` on a job page |
| `detailPanel("Review", "2 notes", body)` | a `<details>` written by hand for a section |
