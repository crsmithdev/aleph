# Tabs

Tabs show one pane of a page at a time. A segmented control picks the pane.

- Use: for two to five panes of one item, where the reader needs one at a time.
- Not for: a filter of a table; use the filter bar.
- Not for: detail that you can fold; use a disclosure.

## Helper

| Helper | Reference |
|---|---|
| `tabs(label, items, panes, on)`; `wireTabs(root, onTab)` | `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Tab bar | One button per pane, from `seg()` |  | as the segmented control; `--sp-12` above the pane |
| Pane | The HTML of one tab, in a `section[data-pane]` |  | the open pane shows, the others have `hidden` |

## Rules

- `items` is `[[id, label]]`; `panes` maps each id to its HTML. The first item is open unless `on` names another.
- `wireTabs()` switches the panes without a redraw. A view that keeps the pick in `keep()` or in the address gives `onTab` and keeps it there. Wiring a root again adds no listener: the root keeps one, and the last `onTab` is the one it calls.
- Name each tab in one or two words, as the title of its pane.
- Put all the panes in the page, hidden. Do not fetch a pane on a click.
- Give `head` as `{ aside, top }` to make the tab bar a card's head. See `tab-card`.

## Do and don't

| Do | Don't |
|---|---|
| `tabs("Herald", [["events", "Events"], ["active", "Active"], ["inspector", "Inspector"]], panes, tab)` | `seg()` plus `section` tags written by hand |
| three tabs | a tab bar of nine tabs that scrolls |
