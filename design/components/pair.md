# Pair

A pair puts two cards side by side.

- Use: for two cards that a reader compares or reads together.
- Not for: three or four charts; use `.trio` or `.quad`. Metric cards go in `.tiles`.

## Helper

| Helper | Reference |
|---|---|
| `.pair` around two `card()` calls | `ui/views/gates.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Pair | Two cards |  | a grid of `auto-fit` columns, each at least 320px (or the width, if less), `--gap-in` apart |

## Rules

- Put exactly two cards in a pair. The columns stack when the width is under two cards.
- Give each card its own title and count. Do not share a title.
- Do not set a width on a card in a pair.

## Do and don't

| Do | Don't |
|---|---|
| `<div class="pair">${card(a)}${card(b)}</div>` | two cards with a width of 50% each |
