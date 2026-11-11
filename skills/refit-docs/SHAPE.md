# Shape lens

Does each page serve one reader task? Tangled pages, bloat and excess structure are presentation problems (Uddin
and Robillard 2015): less severe than wrong or missing content, but they hide it. Diátaxis is the test:
[docs-writing](../docs-writing/SKILL.md) rule `structure-diataxis` holds the compass, and its `structure-` rules the
rest.

## Signals

- **Mixed types.** Reference tables inside a tutorial; a long explanation inside a how-to; a how-to inside a
  reference page. Apply the compass (action or cognition, acquisition or application) to each section.
- **Bloat.** A section that a reader of this type skips; filler ("Introduction", "Overview" that says nothing).
- **Missing parts of the type.** A how-to with no goal or no result; a tutorial with no next step; a reference
  entry with no example.
- **The README.** It orients: what, status, install, use, where next. `docs-writing`'s `readme-template.md`.
- **ADRs.** Each has status, context, decision and consequences (Nygard).

## Proof

Name the page's type, the section of another type, and the reader whose task it interrupts. Misclassifying a page's type
is the main false positive: `docs-writing`'s Gotchas list it and the others.

## Fix

Split the section out to a page of its type and link to it, or cut it. Add the missing part of the type.

## Hold

Model: `check`.

## Check

What is the new page's type? Does each new section serve that type's reader?
