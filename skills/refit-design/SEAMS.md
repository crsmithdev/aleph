# Seams lens

A kit helper is the seam of a component: `ui/views/lib/html.js` builds the markup and `ui/app.css` styles it. A view that
restyles a kit class or writes the markup by hand reaches past that seam, so a fix to the helper no longer reaches
that view. It is the [refit-code](../refit-code/SEAMS.md) lens applied to the UI.

## Signals

**Code view.** Search the views of `ui/views` and the files they import for:

- a rule in a view's own style block, or an inline `style`, that sets a property of a class a kit helper builds;
- an element written with a kit class name (`class="card"`, `.chip`, `.tscroll`) when the helper exists;
- a selector in `ui/app.css` that is scoped to one view and overrides the base rule of a kit class;
- an import from `aleph-tools` internals instead of the helper that wraps the widget;
- a sibling class that copies the declarations of a kit class.

`docs/design.md` names the helper of each component in its section. A part that has no helper is a row of the
Deviations table: mark it so, and do not report it again.

**Drawn view.** Compare the view's component with its specimen on `#/kit`. A difference in padding, radius,
colour or type that the helper does not take as an option shows an override.

## Proof

A finding has all of:

- the kit class or helper, and its section of `docs/design.md`;
- `file:line` of the override or of the hand-built markup;
- the helper call that gives the same result, or the option the helper lacks.

A hand-built component whose pieces are all literal values is also an apply finding: report it under this lens
only. A view that restyles a kit class is this lens. Two builds of one component, neither using the helper, are
the variants lens.

## Fix

Call the helper. Where the view needs a difference, add an option to the helper and use it from the view.
Delete the override rule.

## Guard

A model guard in `check`: a plan that styles a kit class in a view, or writes kit markup by hand, is stopped before
the build. No tool guard yet.

## Check

Does each new view call the kit helper for each component it draws? Does it set a property of a kit class?
