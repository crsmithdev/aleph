# Variants lens

Is each component drawn one way? Two builds of one component make the UI read as two UIs, and a fix to one build
leaves the other. The apply lens asks whether a value follows a rule; this lens asks whether two places agree.

## Signals

**Code view.** List each component the UI builds: each helper of `ui/views/lib/html.js` and each class that `ui/app.css`
styles as a part. For each one, list its call sites and its hand-built copies, and compare:

- the helper arguments: the same component called with a different order of parts, a different label form or a
  different set of options;
- a second helper or class for the same job, such as two chip builders or two row classes;
- a copy of the markup with one part added, removed or renamed.

**Drawn view.** Follow [verify-ui](../verify-ui/SKILL.md). Screenshot the same component on two routes and on
`#/kit`, at desktop width. Compare height, spacing, type, tone, alignment and the parts present.

## Proof

A finding has all of:

- the component, and its specimen on `#/kit`;
- two builds, each with `file:line` or a screenshot, that differ in a way the doc does not name;
- the build that the doc names, or the build that more call sites use when the doc is silent.

Two builds that differ by a documented option are one component. A component with a different job is a different
component. A candidate that is one build plus a value that breaks a rule belongs to the apply lens.

## Fix

Move the odd build to the common one: call the helper with the common arguments. Where the doc names neither
build, report a proposal to amend the doc and change no code.

## Hold

A model hold in `check`: a plan that draws a component a second way from its specimen is stopped before the build.
No tool hold yet: it comes when a retro finds a variant that a script could list.

## Check

Does each component in the change look like its specimen on `#/kit` and like its other uses? Does the change add
a second way to draw a part that has one?
