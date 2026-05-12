---
name: design-type
description: >
  Professional typography rules for UI design, web applications, and screen-based text.
  Enforces typographic correctness: proper quote marks, dashes, spacing, hierarchy, and layout.
  ENFORCEMENT MODE: When generating HTML/CSS/React/JSX with visible text, auto-apply all rules silently.
  AUDIT MODE: When reviewing existing interfaces, flag violations and provide fixes.
metadata:
  author: bencium (adapted from Matthew Butterick's Practical Typography)
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# UI Typography

Professional typography rules for UI. Distilled from **Matthew Butterick's *Practical Typography***.

## Mode of Operation

**ENFORCEMENT (default):** When generating any UI with visible text, apply every rule automatically. Use correct HTML entities, proper CSS. Do not ask. Do not explain. Just produce correct typography.

**AUDIT:** When reviewing existing code, identify violations and provide before/after fixes.

## Quick Rules

### Characters

- **Quotes**: Always curly. `"..."` not `"..."`. Apostrophes point down (`'`).
- **Dashes**: Hyphen (-) for compounds, en dash (`-`) for ranges, em dash (`--`) for breaks.
- **Ellipsis**: One character (`...`), not three periods.
- **Math**: `x` for multiplication, `-` for minus. Not keyboard characters.
- **Symbols**: Real `(c)` `(tm)` `(r)`, never (c) (TM) (R).

### JSX Warning

Unicode escapes (`\u2019`) do NOT work in JSX text content -- they render literally. Use actual UTF-8 characters or wrap in JSX expressions: `Don{'\u2019'}t`.

### Spacing

- One space after punctuation. Always. Never two.
- `&nbsp;` before references, after (c), after honorifics.

### Formatting

- Bold OR italic, never both.
- Never underline (except subtle link styling).
- ALL CAPS: only < 1 line, always letterspaced (`letter-spacing: 0.06em`).
- Kerning always on: `font-feature-settings: "kern" 1`.
- `font-variant-numeric: tabular-nums` for data tables.

### Layout

- Line length: `max-width: 65ch` on text containers.
- Line height: 1.2-1.45 of font size.
- Paragraph spacing: indent OR space, never both.
- Headings: max 3 levels, bold not italic, space above > below.
- Tables: remove borders, add padding, thin rule under header only.

## Deep Reference

For detailed coverage, read these files:

- **`src/rules/design/typography.md`** -- Complete rules: characters, spacing, formatting, layout, responsive, dark mode, maxims
- **`css-templates.md`** -- CSS baseline template, responsive patterns, OpenType features, dark mode
- **`html-entities.md`** -- Complete entity/character table with substitution rules and usage patterns

## Output Format (Audit Mode)

Before/after table, grouped by file:

```text
## src/Component.tsx

| Before | After | Rule |
|--------|-------|------|
| `"Hello"` | `&ldquo;Hello&rdquo;` | Curly quotes |
| `it's` (straight) | `it&rsquo;s` (curly) | Apostrophe = closing single quote |
| `HEADING` (no spacing) | `letter-spacing: 0.06em` | All caps letterspaced |
```
