# Canon mock

Request (Chris, 2026-11-20): select a UI component, have an agent pick out its salient features and generalize them,
approve or deny each, apply the result to similar controls on other pages, and browse the design guide.
Second round: do it all in the annotation flow, not on extra pages, and name features by the site's tokens.

`gen.ts` draws the pages with the real UI helpers and `ui/app.css`. Rerun with `bun docs/mocks/canon/gen.ts`. The
annotate card is drawn by hand after `~/aleph-tools/annotate.js`. The state bar at the top is the mock's only frame.

## Pages

- `index.html`: Status. States 1 to 5 run on the Herald card's Show toggle (`ui/views/now.js:212`). In state 1, press C.
- `automation.html`: another page, with the agent's pin on the rule form's control.

## States

1. **Pick.** Hover a control, then press D for the quick actions. Canon (C) is a fifth action after Delete, Move, Refit and Explain.
2. **Read.** The note saves with kind `canon`. The agent replies in the same card while it reads the style, DOM and source.
3. **Decide.** The card widens to show the class, its helper, and one row per feature. Each row has its tokens, its class against
   `design.md` (Doc, New, Conflict) and Keep, Drop or Edit. Approve and Deny are the card's own buttons. The doc
   change folds under the rows.
4. **Pinned.** The note resolves and docks in the annotate panel. Each control off the canon gets an agent pin
   where it lives, with Fix or Not one (Yes or No for a similar match). The panel can also fix all of them.
5. **Browse.** In annotate mode, hover a control to see its canon and tokens. The panel gets a Canon list with an
   off-canon count for each component.

## Decisions

- **One flow.** Request, reading, decision and fixes are all one annotation: a note, its replies, its resolve and agent
  pins. No shelf item and no review page.
- **Tokens only.** A feature names tokens (`--ctl-h`, `--fs-sm`, `--rule-2`), never px or a font name. A raw value with no
  token would be its own class, No token, so the canon cannot set a one-off value.
- **Doc stays the source.** Approve writes the `design.md` section and the `#/design` specimen on a branch.
- **Canon names one helper.** Fixes move look-alikes onto `seg()` and `wireSeg()`.
- **Similar needs a yes.** A match found by shape (the KPI tiles) asks Yes or No on its pin.

## Open

- How the agent finds similar controls: a crawl of every page, or only the page in view.
- Whether a canon of a widget in `~/aleph-tools` writes to this repo's doc.
- Where the off-canon counts live, so the panel can show them without a crawl.
