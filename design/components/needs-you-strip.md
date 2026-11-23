# Needs-you strip

The Needs-you strip lists what in the memory waits for Chris. An item shows only while its number is over its act-threshold.

- Use: under the tabs of each Memory tab.
- Not for: an Ask; use an ask card.

## Helper

| Helper | Reference |
|---|---|
| `needs(m)` in `ui/views/lib/memory-health.js` | `ui/views/memory.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The items |  | `--surface`, shadow `--card-lift`, radius `--r-card`, `--fs-sm`; wraps |
| Label | `Needs you` |  | `--fw-strong` |
| Item | A badge, then the number and what it counts, linked to where Chris acts |  | `--ink`, no underline until hover; the rule in its `title` |

## Rules

- Draw nothing when no item is over its threshold.
- Give each item its threshold in the `title`.

## Do and don't

| Do | Don't |
|---|---|
| `start 2 core lines cut` | an item at 0 |
