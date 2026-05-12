---
name: design-standards
description: >
  Audit UI code against web interface best practices: accessibility, forms, performance, navigation,
  content handling, touch interaction, hydration safety, locale/i18n, and common anti-patterns.
  Use when asked to "check accessibility", "audit for best practices", "review for a11y", or
  "check web standards". For typography/character correctness see design-type.
  For creative design direction see frontend-design.
metadata:
  author: construct (adapted from Vercel web-interface-guidelines)
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Standards

Audit UI code against web interface best practices. This skill covers correctness and robustness — not aesthetics (see `frontend-design`) or typographic correctness (see `design-type`).

## Process

1. Read the specified files (or ask user for files/pattern)
2. Check against all rules in `src/rules/design/accessibility.md`
3. Output findings in `file:line` format

## Output Format

Group by file. Terse findings, no preamble.

```text
## src/Button.tsx

src/Button.tsx:42 - icon button missing aria-label
src/Button.tsx:18 - input lacks label
src/Button.tsx:67 - missing overscroll-behavior: contain

## src/Card.tsx

pass
```

## Priority Order

1. **Accessibility** — aria-labels, semantic HTML, keyboard handlers, focus states
2. **Anti-patterns** — outline-none, div-as-button, paste blocking, zoom disabling
3. **Forms** — autocomplete, input types, labels, error handling
4. **Performance** — virtualization, layout thrashing, image dimensions
5. **Content handling** — truncation, empty states, long content
6. **Navigation & state** — URL sync, deep linking, destructive action guards

## Deep Reference

For the complete checklist, read `src/rules/design/accessibility.md`. It covers:

- Accessibility, focus states, forms
- Content handling, images, performance
- Navigation & state, touch & interaction
- Safe areas & layout, dark mode & theming
- Locale & i18n, hydration safety
- Hover & interactive states, content & copy
- Anti-patterns to flag
