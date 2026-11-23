# Tab card

A tab card is a card whose head is its tabs. The segmented control takes the place of the title.

- Use: for a card of two to five panes, where the card's name adds nothing to its tab names.
- Not for: a card with one body; use a card with a title.

## Helper

| Helper | Reference |
|---|---|
| `card("", tabs(label, items, panes, on, { aside, top }), { id, cls, label })` | `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Head | The tab bar from `seg()`, then the aside |  | as the card head; the aside at the right |
| Top | HTML that shows on every tab, such as alerts | yes | between the head and the panes, outside each pane |
| Pane | The HTML of one tab, in a `section[data-pane]` |  | as in tabs |

## Rules

- Give the card an empty title and its name as `label`. The card has no heading, so the label names it for assistive tech.
- Give the group of buttons the card's name as `label` too.
- Put what must show on every tab in `top`, not in each pane.

## Do and don't

| Do | Don't |
|---|---|
| `card("", tabs("Herald", items, panes, tab, { aside: chip, top: alerts }), { label: "Herald" })` | a title over the tab bar that repeats the card's name |
