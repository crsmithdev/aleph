---
name: design-type
description: >
  Professional typography rules for UI design, web applications, and screen-based text.
  Enforces typographic correctness: proper quote marks, dashes, spacing, hierarchy, layout.
  ENFORCEMENT MODE: When generating HTML/CSS/React/JSX with visible text, auto-apply all
  rules in `src/rules/design/typography.md` silently — no asking, no explaining, no diff.
  AUDIT MODE: When reviewing existing interfaces, surface findings as plain markdown
  grouped by severity, citing `design/RULES.md#B.<n>`. Triggers on "typography",
  "fix typography", "em dash", "en dash", "text hierarchy", "font size", or `/design-type`.
verb: audit
domain: design
metadata:
  author: bencium (adapted from Matthew Butterick's Practical Typography)
  version: "2.0.0"
  argument-hint: <file-or-pattern>
---

# UI Typography

Professional typography rules for UI. Distilled from **Matthew Butterick's *Practical Typography***.

This is a standalone leaf. It runs a single combined flow — scan, present, approve, fix, gate — at audit time, or applies rules silently at write time.

## Mode of Operation

**ENFORCEMENT (default at write-time):** When generating any UI with visible text, apply every rule in `src/rules/design/typography.md` automatically. Use correct HTML entities, proper CSS. Do not ask. Do not explain. Just produce correct typography. No findings — silent application.

**AUDIT (when invoked as `/design-type` or via the audit dispatcher):** Walk existing code in scope and emit a phased prose summary citing the violated rule in `src/rules/design/RULES.md` section B.

## Quick Rules

### Characters

- **Quotes**: Always curly. `&ldquo;...&rdquo;` not `"..."`. Apostrophes point down (`&rsquo;`).
- **Dashes**: Hyphen (-) for compounds, en dash (`&ndash;`) for ranges, em dash (`&mdash;`) for breaks.
- **Ellipsis**: One character (`&hellip;`), not three periods.
- **Math**: `&times;` for multiplication, `&minus;` for minus. Not keyboard characters.
- **Symbols**: Real `&copy;` `&trade;` `&reg;`, never `(c)` `(TM)` `(R)`.

### JSX Warning

Unicode escapes (`’`) do NOT work in JSX text content — they render literally. Use actual UTF-8 characters or wrap in JSX expressions: `Don{'’'}t`.

### Spacing

- One space after punctuation. Always. Never two.
- `&nbsp;` before references, after `&copy;`, after honorifics.

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

## Audit-Mode Process

### 1. Resolve scope

Default scope is the current diff against `main`:

```bash
git diff --name-only origin/main...HEAD -- 'src/ui/**/*.tsx' 'src/ui/**/*.css'
find <path> -name '*.tsx' -o -name '*.css' -not -path '*/node_modules/*'
```

If `--diff` returns empty: stop and surface *"No files in scope. Try `--module <path>`, `--since HEAD~5`, or `--all`."* — do not silently audit nothing.

### 2. Walk the rules

Evaluate each in-scope file against section B of `src/rules/design/RULES.md` (B.1 through B.8) and the extended ruleset in `src/rules/design/typography.md`:

| Rule | Detect |
|---|---|
| B.1 Curly quotes | grep `"` or `'` between `>` and `<` in JSX text |
| B.2 Em/en dash discipline | grep `--` or `---` in rendered text |
| B.3 Ellipsis as `&hellip;` | grep `\.\.\.` in rendered text |
| B.4 `max-width: 65ch` on text containers | prose containers with no max-width |
| B.5 `line-height` 1.2-1.45 on body text | check CSS / Tailwind classes |
| B.6 `font-feature-settings: "kern" 1` on body text | check global typography styles |
| B.7 All-caps needs `letter-spacing: 0.06em` | `text-transform: uppercase` without letter-spacing |
| B.8 `tabular-nums` on data-table numeric columns | numeric cells with no `tabular-nums` |

Skip rules whose Detect signal doesn't apply to the scope.

### 3. Re-read and drop false positives

Re-read each cited location. Drop any finding where:

- The pattern is in a comment, doc string, or code example (not rendered text)
- A linter would have caught it (cite the linter; mark `nit`)
- The rule's Detect doesn't actually apply (e.g., `--` inside a regex, not user-visible)
- The issue is pre-existing outside scope → record under "Pre-existing Issues"
- It's a pedantic nitpick or style preference not in RULES.md → drop

### 4. Present findings (phased prose)

Group findings by severity tier and emit as plain markdown:

```
# Typography Audit — <scope>

## Phase 1 — Important (readability blockers)
- <file:line> — design/RULES.md#B.4 — <one-line> — fix: <concrete replacement>

## Phase 2 — Refinement (nit, character correctness)
- <file:line> — design/RULES.md#B.1 — <one-line> — fix: <concrete replacement>

## Pre-existing issues (out of scope)
- ...
```

Severity defaults: B.1-B.3, B.5-B.8 → `nit`. B.4 (line-length) → `important` (affects readability at scale).

For a richer before/after table when run standalone:

```text
## src/Component.tsx

| Before | After | Rule |
|--------|-------|------|
| `"Hello"` | `&ldquo;Hello&rdquo;` | B.1 Curly quotes |
| `it's` (straight) | `it&rsquo;s` (curly) | B.1 Apostrophe = closing single quote |
| `HEADING` (no spacing) | `letter-spacing: 0.06em` | B.7 All caps letterspaced |
```

### 5. Approval gate

Offer the user: **apply all / pick / discard**. No per-finding prompting for typography — these are non-security. Apply only what the user picks; record skipped findings with a one-line reason.

### 6. Verify

After applying fixes, re-grep the touched files to confirm the violating patterns are gone. Emit a `[verify]` block describing scope, method, and assertions.

## Scope discipline

- **Read-only when scanning.** No `Edit`, `Write`, or mutating `Bash` until the user approves at the gate.
- **Write-time in enforcement mode.** Apply silently; emit nothing.
- **No `Skill()` calls.** Only the audit dispatcher invokes other skills; this leaf runs standalone.
- **Typography only.** Visual hierarchy, rhythm, and code-level a11y / forms / perf belong in `design-review`.

## Guardrails

- **Cite rules precisely.** Every finding includes `design/RULES.md#B.<n>`. No bare prose accusations.
- **Anchor every finding to `file:line`.**
- **Enforcement mode is silent.** No findings, no diffs, no explanation when applying rules at write-time.

## Cross-references

- Rule source: `src/rules/design/RULES.md` section B
- Extended ruleset: `src/rules/design/typography.md` (characters, spacing, formatting, layout, responsive, dark mode, maxims)
- CSS baseline: `css-templates.md` (responsive patterns, OpenType, dark mode)
- Entity reference: `html-entities.md` (substitution rules, usage patterns)
- Sibling unified skill: `src/skills/design-review/SKILL.md` (visual + a11y/forms/perf)
- Audit dispatcher: `src/skills/audit/SKILL.md`
