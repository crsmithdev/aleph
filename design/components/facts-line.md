# Facts line

The facts line is the figures of a list view in one line of text.

- Use: under the attention rows of a list view.
- Not for: an analysis view; use the figure band.

## Helper

| Helper | Reference |
|---|---|
| `factsLine([[figure, words]])` in `ui/views/lib/page.js` | `ui/views/design.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Figure | A number or amount, in `--fw-strong` and `--ink` |  | `--num` |
| Words | What it counts |  | `--ink-2` |

## Rules

- Give at most 4 figures. The helper throws on a fifth.
- Split the figures with a dot. A figure and its words stay on one line.
- Put the word after the figure: `3 running`, not `running: 3`.

## Do and don't

| Do | Don't |
|---|---|
| `3 running · 12 runs today · $4.10 today` | a row of metric cards above a list |
