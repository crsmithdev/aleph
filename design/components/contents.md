# Contents

The contents are a list of links to the sections of a long page, in a rail that stays in view while the page scrolls.

- Use: on a page of more than five sections, or one that scrolls more than about three screens.
- Not for: two to five panes that a reader needs one at a time; use tabs.
- Not for: links to other pages; use the sidebar.

## Helper

| Helper | Reference |
|---|---|
| `toc(items, body)`; `wireToc(root)` | `ui/views/gates.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Rail | The word "Contents" and the list, in a `nav` |  | 220px at the right of the body, `--sp-28` apart; sticky `--sp-16` from the top; it ends above the dock and scrolls when taller |
| Entry | An `<a href="#id">` to one section |  | `--fs-sm`, `--muted`, on a `--rule` hairline at the left; a `sub` entry is indented `--sp-24` |
| Current entry | The entry of the section at the top of the view |  | `aria-current="location"`; `--ink`, `--fw-strong`, an inset thin `--ink` bar at the left |

## Rules

- `items` is `[[id, label, sub]]`. Each `id` is the `id` of a section in `body`, such as the `id` of a `card()`. A `sub` entry sits under the entry before it.
- Label each entry with the title of its section, in the same words.
- List the sections in page order. Leave out a section with no heading, such as the metric cards at the top.
- A link scrolls the page in place: the router handles an `#id` link and leaves the address as it is.
- `wireToc()` marks the current entry: the first section that crosses the band from 10% to 40% down the view. It scrolls the rail, not the page, to keep that entry in view. At the end of the page the last entry is current. When no section is in the band and the page is not at its end, no entry is current. A clicked entry stays current until the next scroll by hand (wheel, touch or a key) or a click outside the rail.
- Under 1100px the contents are a fold above the body, closed by `wireToc()`. They do not stay in view.

## Do and don't

| Do | Don't |
|---|---|
| `toc([["gates-log", "Log"]], body)` and `card("Log", …, { id: "gates-log" })` | a list of links written by hand at the top of the page |
| `<a href="#gates-log">` | `<a href="#/automation#gates-log">`, which the router reads as a route |
