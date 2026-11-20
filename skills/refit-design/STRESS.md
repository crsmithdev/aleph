# Stress lens

A page built on three tidy fixture rows shows its faults only on real data: clipped text, a table that pushes the
page wider, a column of `0` for a gap.

## Signals

**Code view.** For each value a view shows, find the guard against the extreme:

- text with no `overflow`, `text-overflow` or wrap rule, and no `title` with the full text;
- a list or table with no limit, no `Show more` and no scroll;
- a field that can be `null` sent to a helper with no missing form, such as `bytes()`, which shows `nullB`, where
  the doc wants `miss(reason)`;
- a flex or grid child that cannot shrink (`min-width` unset).

**Drawn view.** Follow [verify-ui](../verify-ui/SKILL.md). Put the page on a fixture with the extremes: a title
of 200 characters, an id with no break point, 500 rows, a field that is `null`, an empty list. Screenshot at
desktop (1440 px) and phone (390 px) width, light and dark. Look for clipping, overflow, a horizontal scrollbar on
the page and a shifted layout.

## Proof

A finding has all of:

- the extreme: the input and its size;
- the screenshot where the page breaks, or the `file:line` that has no guard;
- the rule it breaks: the ellipsis rule with `title`, `miss(reason)`, `empty()`, or the phone rule of the component.

A missing empty line is the states lens. An empty line that breaks at 200 characters is this lens. A fault that
shows on the ordinary fixture is a local defect of the apply lens.

## Fix

Add the guard the doc names: a clamp with the full text in `title`, `miss(reason)` for the missing value, a
`.tscroll` around a wide table, `min-width: 0` on a child that must shrink.

## Guard

Rule (write-design RULES.md): a new list, table or text field in a plan names its limit for long text and many rows. No tool
guard yet.

