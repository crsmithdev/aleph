# Card

A card is one section of a list page. It has a head and a body.

- Use: for each section of a list page.
- Not for: a section of a detail page; use the detail panel.

## Helper

| Helper | Reference |
|---|---|
| `card(title, body, { count, aside, id, lede })` | `ui/views/factory-agents.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The section |  | `--surface`, shadow `--card-lift`, no visible border, radius `--r-card`, padding `--gap-in` |
| Title | What the section holds |  | `--sans` `--fs-lg` `--fw-strong`, `--ink` |
| Count | The number of items | yes | `--num` `--fs-sm` `--fw-mid`, `--muted` |
| Aside | Controls, or one note | yes | `--fs-xs`, `--muted`; at the right |
| Lede | One sentence that sums up the card | yes | `--fs-sm`, `--muted`; under the head |
| Body | The content |  | `--fs-sm`, `--ink-2` |

## Rules

- Do not put a card in a card.
- Give `lede` as one sentence that sums up the card. A failure goes to `notice()`, not to the lede.
- A heading inside a card is `subHead()`.
- Give an empty title to draw no head, when the body is a tab card.
- Give an `id` when a link goes to the section.

## Do and don't

| Do | Don't |
|---|---|
| `card("Recent Jobs", dataTable(…), { count: 12 })` | a section head with no box (`sectionHead()` alone) |
| `card("Recent Jobs", empty())` | no card when the section is empty |
