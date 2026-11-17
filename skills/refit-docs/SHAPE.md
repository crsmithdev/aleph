# Shape lens

Does each page serve one reader task? Diátaxis is the test. [write-docs](../write-docs/SKILL.md) rule
`structure-diataxis` holds the compass, and its `structure-` rules hold the rest.

## Signals

- **Mixed types.** Reference tables inside a tutorial; a long explanation inside a how-to; a how-to inside a
  reference page. Apply the compass (action or cognition, acquisition or application) to each section.
- **Bloat.** A section that a reader of this type skips; filler ("Introduction", "Overview" that says nothing).
- **Missing parts of the type.** A how-to with no goal or no result; a tutorial with no next step; a reference
  entry with no example.
- **The README.** It orients: what, status, install, use, where next. `write-docs`'s `readme-template.md`.
- **ADRs.** Each has status, context, decision and consequences (Nygard).

## Proof

Name the page's type, the section of another type, and the reader whose task it interrupts. A wrong page type is the main
false positive. `write-docs`'s Gotchas list it and the others.

## Fix

Split the section out to a page of its type and link to it, or cut it. Add the missing part of the type.

## Guard

Rule: write-docs RULES.md 4.

