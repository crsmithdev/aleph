# Seams lens

A design helper is the seam of a component: `ui/views/lib/html.js` builds the markup and `ui/app.css` styles it. A view
that restyles a design class or writes the markup by hand reaches past that seam, so a fix to the helper misses that
view. This is the [refit-code](../refit-code/SEAMS.md) lens applied to the UI.

## Signals

**Code view.** Search the views of `ui/views` and the files they import for:

- a rule in a view's own style block, or an inline `style`, that sets a property of a class a design helper builds;
- an element written with a design class name (`class="card"`, `.chip`, `.tscroll`) when the helper exists;
- a selector in `ui/app.css` that is scoped to one view and overrides the base rule of a design class;
- an import from `aleph-tools` internals instead of the helper that wraps the widget;
- a sibling class that copies the declarations of a design class.

The component file in `design/components/` names the helper of its component, and the helper's JSDoc has `@design <id>`. A part with no helper is a row of the
`deviations` rule in `design/rules.md`: do not report it.

**Drawn view.** Compare the view's component with its specimen on `#/design`. A difference in padding, radius,
colour or type that the helper does not take as an option shows an override.

## Proof

A finding has all of:

- the design class or helper, and its component file in `design/components/`;
- `file:line` of the override or of the hand-built markup;
- the helper call that gives the same result, or the option the helper lacks.

A hand-built component whose pieces are all literal values is also an apply finding: report it here only. Two
builds of one component, neither using the helper, are the variants lens.

## Fix

Call the helper. Where the view needs a difference, add an option to the helper and use it from the view.
Delete the override rule.

## Guard

Rule (write-design RULES.md): stop a plan that styles a design class in a view, or writes design markup by hand. No tool guard yet.

