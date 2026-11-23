# Ask card

An ask card asks the user a question. It shows the question, the choices and the buttons that answer it.

- Use: for each Ask that waits for the user.
- Not for: a note with no answer; use an attention row.

## Helper

| Helper | Reference |
|---|---|
| `askCard(i)` in `ui/views/lib/ask-cards.js` | `renderIssue()` in `ui/views/issues.js` |
| `alertCard({ card, kind, title, detail, tag, side, acts })`, `askAlert(i, now)` in `ui/views/lib/ask-cards.js` | `renderProblems()` in `ui/views/now.js` |

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
| Alert | The head on one line: the dot, the kind, the title, the detail, the tag and the wait, then small buttons | yes | `--fs-sm` on the `-bg` of the kind, no shadow; the title ends in an ellipsis; detail `--muted` |

## Rules

- Make each choice with `actButton()`. Mark the recommended choice.
- When a choice needs a reason, use the reason box of the two-click confirm.
- Put the technical details last, in a closed fold.
- In a rail, show an Ask as an alert with `askAlert()`: only the buttons that need no reason, and the Always button second. Show a factory alert or an errored job with `alertCard()`. The full card is on the page of the item.

## Do and don't

| Do | Don't |
|---|---|
| the recommended choice marked | two choices marked |
| technical details in a closed fold at the end | logs in the question |
