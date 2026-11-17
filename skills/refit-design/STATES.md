# States lens

Does each component draw its empty, loading, error, hover, focus, disabled and phone-width state? A component
that draws only its full state breaks on the first empty list, slow fetch or narrow screen.

## Signals

**Code view.** For each component that shows data or takes input, find the code for each state:

| State | Where the doc gives it |
|---|---|
| empty | `empty()`: `No data`, in the card (Content, Words) |
| loading | `loadingLine(what)` until the first fetch returns |
| error | `error(line, hint, { detail })` for a failed fetch |
| hover, focus, disabled | the States table of `docs/design.md`; focus is `:focus-visible` |
| phone | the component's Rules on a phone; the layout at 720px and narrower |

A state with no branch in the view, and no rule in `ui/app.css` for a control, is a candidate.

**Drawn view.** Follow [verify-ui](../verify-ui/SKILL.md). Force each state: fixture data with no rows, a fetch
that waits, a fetch that fails, the keyboard on each control, and a 390 px window. Screenshot each state beside the
same state on `#/kit`. Read the console too.

## Proof

A finding has all of:

- the component and the state it lacks, or draws wrong;
- the line of `docs/design.md` that gives the state, or the specimen on `#/kit` that draws it;
- `file:line` that has no branch, or the screenshot that shows the fault.

A state the doc leaves out is a proposal to amend the doc. A state that draws but breaks a value rule (a literal
colour on a hover) belongs to the apply lens. An empty line that holds at 20 characters and breaks at 200 belongs
to the stress lens.

## Fix

Add the branch with the helper the doc names: `empty()`, `loadingLine()`, `error()`. Add the rule for a control
state in `ui/app.css` from tokens.

## Guard

A model guard in `check`: a new component in a plan names its empty, loading and error state. A tool guard: the Kit
test in `ui/browser.test.ts` fails when `#kit-states`, `#kit-table-empty` or `#kit-chart-empty` stops drawing its
empty or loading line.

## Check

Does each new component or control draw its empty, loading, error, hover, focus, disabled and phone-width state,
or does the plan say which one it leaves out and why?
