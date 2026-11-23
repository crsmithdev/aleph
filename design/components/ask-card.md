# Ask card

An ask card asks Chris a question. It shows the question, the choices and the buttons that answer it.

- Use: for each Ask that waits for Chris.
- Not for: a note with no answer; use a feed row.

## Helper

| Helper | Reference |
|---|---|
| `askCard(i)` in `ui/views/lib/ask-cards.js` | `ui/views/now.js` |

## Parts

| Part | Holds | Optional | Style |
|---|---|---|---|
| Kind | approve, decide or unstick |  | sets the colour, `-bg` and `-ring` of the card (`--approve`, `--decide`, `--unstick`) |
| Box | The Ask |  | `--surface`, border the ring of the kind, shadow `--lift`, radius `--r-card` |
| Head | A dot, the kind, the title |  | `--fs-lg` on the `-bg` of the kind; kind `--fw-strong` in the colour of the kind |
| Question | The question, when the card is open |  | `--fs-lg` `--fw-strong`; `--measure` maximum |
| Choices | One button for each answer |  | `--sp-8` apart; when open, a 200px column of buttons, then the text |
| Recommended | The mark on the recommended choice | yes | `--fs-xs` `--fw-strong`, the colour of the kind |
| Details | Technical details | yes | a closed fold |

## Rules

- Make each choice with `actButton()`. Mark the recommended choice.
- When a choice needs a reason, use the reason box of the two-click confirm.
- Put the technical details last, in a closed fold.

## Do and don't

| Do | Don't |
|---|---|
| the recommended choice marked | two choices marked |
| technical details in a closed fold at the end | logs in the question |
