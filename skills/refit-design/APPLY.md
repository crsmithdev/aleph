# Apply lens

The doc records what the code mostly does. A page that leaves it makes the UI read as several UIs. The code view
finds a value that bypasses a token. The drawn view finds a layout, a state or a contrast that no line of code names.

## Signals

**Code view.** Run the inventory in place, on the route's files or on `ui`:

```
bun skills/design-language/scripts/inventory.ts <view and style files> --summary
bun skills/design-language/scripts/inventory.ts <view and style files>
```

Each row is `file:line, group, property, value, kind`. Run the script in place: a copy drifts. Mark each row of
kind `literal` or `helper-bypass`, and each table column and component the view builds, against the doc: **follows**,
**deviates** (name the rule), or **new** (the doc does not cover it). A row inside a shared helper's own body is the
helper, not a bypass. A row under Deviations or the Appendix of the doc is a known deviation: do not report it.

**Drawn view.** Follow [verify-ui](../verify-ui/SKILL.md) and screenshot the route in light and dark, at desktop
(1440 px) and phone (390 px) width: four PNGs. Do the same for the same component on `#/kit`. Compare the page with the specimen side by side: spacing, type size
and weight, tone, radius, alignment, row height, and what a table or chart does at phone width. Check each state the
page can show (empty, loading, error), and the console errors.

## Proof

A finding has all of:

- the rule: its section and the line of `docs/design.md` that the page breaks;
- the evidence: the `file:line` of the code that breaks it, or the screenshot where it shows, with the Kit
  specimen that shows the rule kept;
- one kind:

| Kind | Meaning | Fix |
|---|---|---|
| **missing token** | A value that the doc has a token for is written as a literal, or a token the page needs is absent from the code | Use the token, or add it where the doc says tokens live |
| **one-off** | A component built by hand that the doc names as a component | Use the component or its helper |
| **mismatch** | The component is the right one, and its use differs from the doc: order, alignment, width, wording, state | Change the use to the rule |
| **local defect** | A fault on the page that no rule names: clipped text, overflow at phone width, an unreadable pair, a console error | Fix the fault |

A candidate with no rule and no evidence is dropped. Where the code and the picture disagree, the picture wins.

**A pattern the doc does not cover.** A pattern that appears 3 or more times in the scope and that no rule, token
or component of the doc covers is a **proposal to amend the doc**, not a finding. List it apart with its `file:line`
locations and the sentence the doc needs. Fewer than 3 uses: a one-off, if the doc names a
component for it, else dropped.

## Fix

One change per finding, in the view or style file. Use the token, helper or component that the doc names. Leave
`docs/design.md` unchanged and do not fix a proposal: design-language owns the doc.

## Guard

Tool: the `guard:` test in `skills/refit-design/refit-design.test.ts` fails when the inventory count of kind
`literal` over `ui` rises, so the count only shrinks. The count of kind `helper-bypass` is unchecked: it is not yet
a test. Model, in `check`: a new component has a section in the doc and a specimen on `#/kit`.

## Check

For each new view, rule, value or component: which rule of `docs/design.md` covers it, which token or helper gives
the value, and which specimen on `#/kit` shows it? A literal with a token, a hand-built component that the doc
names, or a pattern with no rule is the finding.
