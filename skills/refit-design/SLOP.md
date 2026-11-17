# Slop lens

Is a piece of the page bigger than its job? Slop is UI that draws correctly and carries more than it needs: a card
in a card, a border on a border, a shadow, an icon, a label that explains the title. The page reads as busy, and
the reader looks for what matters. Principle 6 of `docs/design.md` is the rule: be terse. This is the
[refit-code](../refit-code/SLOP.md) lens applied to the UI.

## Signals

**Code view.** Search the views and `ui/app.css` for:

- a card or panel inside a card or panel;
- a border, a rule or a shadow on a part whose container already has one;
- an icon next to a label that already says the same;
- a note, qualifier or caption of more than two words, or one that repeats the title, the axis or a tooltip;
- a wrapper element with no style and no script;
- a hint on `empty()`, which takes none.

**Drawn view.** Follow [verify-ui](../verify-ui/SKILL.md). Screenshot the page at desktop width in light and dark.
Cover each part in turn: if the page reads the same, the part is a candidate. Count the lines of border, the
shadows and the icons per screen.

## Proof

A finding has all of:

- the part, with `file:line` or a screenshot;
- what it repeats: the title, the container's border, the neighbour's icon, the tooltip;
- the rule: Principle 6, the Words rules of Content, or the Structure rules of the component.

Keep a part when the doc names it, such as a card around `empty()` on a list page, or when it holds meaning that
no neighbour holds, such as a tone. A value that breaks a rule is the apply lens. A part that is unused is the
dead lens.

## Fix

Delete the part. Put a definition the reader needs in a `title` tooltip. Cut a label to one or two words.
Leave a part that the doc names.

## Guard

A model guard in `check`: a new note, label or caption in a plan is at most two words. No tool guard yet: a count
of words in UI text waits for a retro finding.

## Check

Is each new card, border, shadow, icon and label needed for its job? Is each label of one or two words?
