# Split card

A split card puts a main part and a side part in one card, split 3 : 1 by a rule.

- Use: for a card whose main part is a table or a chart, with a few related figures or a second small chart beside it.
- Not for: two sections of equal weight; use a pair of cards.

## Helper

| Helper | Reference |
|---|---|
| `splitCard(title, main, side, { aside, id, label })`; `sideStats([{ k, v, note, state, title }])` | `renderPipeline()` in `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Box | The card |  | the card box, a grid of 3fr and 1fr |
| Main | The head (title and aside) and the main part |  | `--sp-20` to the rule |
| Rule | The split |  | a `--rule` line, `--sp-20` to the side |
| Side | Side stats, or a bare chart under a `subHead()` |  | centred in the card's height |
| Side stat key `k` | The measure |  | `--sans` `--fs-2xs` `--fw-strong`, capitals, `--muted` |
| Side stat value `v` | The number |  | `--metric` `--fs-2xl` `--fw-strong`, tabular, `--ink`; `state` colours it by `tone(state)` |
| Side stat note | One or two words, such as `now` | yes | `--fs-2xs`, `--muted`; one line |

## Rules

- Give the side at most six stats. They sit in two columns.
- Put the title on the main part. The side has no title of its own.
- Set `state` only on a stat that is a state, such as `landed` or `failed`, so the value takes that state's tone.
- Put a definition in the stat's `title`, not in its note.
- In a container under 560px, the side goes under the main, behind a rule, and the stats sit in three columns.

## Do and don't

| Do | Don't |
|---|---|
| `{ k: "Errored", v: "1", note: "now", state: "failed" }` | `{ k: "Errored", v: "1", note: "jobs errored right now" }` |
| `{ k: "Open", v: "12", note: "+6", title: "12 open issues, 6 parked issues" }` | `{ k: "Open", v: "12", note: "+6 parked" }` that overflows its column |
