---
name: design-type
description: >
  Professional typography rules for UI design, web applications, and screen-based text.
  Enforces typographic correctness: proper quote marks, dashes, spacing, hierarchy, layout.
  ENFORCEMENT MODE: When generating HTML/CSS/React/JSX with visible text, auto-apply all
  rules in `src/rules/design/typography.md` silently — no asking, no explaining, no diff.
  AUDIT MODE: When reviewing existing interfaces, emit SARIF findings per
  `src/skills/_shared/finding.md` citing `design/RULES.md#B.<n>`, plus a phased prose
  summary. Triggers on "typography", "fix typography", "em dash", "en dash",
  "text hierarchy", "font size", or `/design-type`.
verb: audit
domain: design
modes: [report, scaffold]
metadata:
  author: bencium (adapted from Matthew Butterick's Practical Typography)
  version: "2.0.0"
  argument-hint: <file-or-pattern>
---

# UI Typography

Professional typography rules for UI. Distilled from **Matthew Butterick's *Practical Typography***.

This skill is a pure leaf: no `Skill()` calls. The omnibus chains us; we report (audit mode) or apply (enforcement mode) silently at write-time.

## Mode of Operation

**ENFORCEMENT (default at write-time):** When generating any UI with visible text, apply every rule in `src/rules/design/typography.md` automatically. Use correct HTML entities, proper CSS. Do not ask. Do not explain. Just produce correct typography. No SARIF, no findings — silent application.

**AUDIT (when invoked as `/design-type` or via omnibus `audit design`):** Walk existing code in scope, emit SARIF findings + phased prose summary citing the violated rule in `src/rules/design/RULES.md` section B.

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

### 3. Apply negative-filter list

Per `src/skills/_shared/finding.md`:

- Style preferences not in RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues"
- Pedantic nitpicks → drop
- Issues a linter would catch → cite the linter; mark `severity: nit`
- Lint-ignored lines → drop

### 4. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "design-type"`. Each `result`:

```json
{
  "ruleId": "design/RULES.md#B.<n>",
  "level": "note" | "warning",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "nit" | "important",
    "fix": "<concrete replacement — e.g., 'Replace `\"` with `&ldquo;...&rdquo;` or curly UTF-8'>",
    "tag": "typography" | "readability" | "data-display",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

Severity defaults: B.1-B.3, B.5-B.8 → `nit`. B.4 (line-length) → `important` (affects readability at scale).

### 5. Emit a phased prose summary

After the SARIF block:

```
# Typography Audit — <scope>

## Phase 1 — Important (readability blockers)
- <file:line> — <rule> — <one-line>

## Phase 2 — Refinement (nit, character correctness)
- <file:line> — <rule> — <one-line>

## Pre-existing issues (out of scope)
- ...
```

For a richer before/after table when run standalone:

```text
## src/Component.tsx

| Before | After | Rule |
|--------|-------|------|
| `"Hello"` | `&ldquo;Hello&rdquo;` | B.1 Curly quotes |
| `it's` (straight) | `it&rsquo;s` (curly) | B.1 Apostrophe = closing single quote |
| `HEADING` (no spacing) | `letter-spacing: 0.06em` | B.7 All caps letterspaced |
```

## Scope discipline

- **Read-only in audit mode.** No `Edit`, `Write`, or mutating `Bash`.
- **Write-time in enforcement mode.** Apply silently; do not emit SARIF.
- **No `Skill()` calls.** The omnibus chains; we report or apply.
- **Typography only.** Visual hierarchy and rhythm belong in `design-audit`; code-level a11y / forms / perf in `design-standards`.

## Output template (audit mode)

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Typography Audit — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result.

## Guardrails

- **Confidence is provisional.** Omnibus validation pass refines it.
- **Cite rules precisely.** Every finding includes `design/RULES.md#B.<n>`. No bare prose accusations.
- **Anchor every finding to `file:line`.**
- **Enforcement mode is silent.** No findings, no diffs, no explanation when applying rules at write-time.

## Cross-references

- Rule source: `src/rules/design/RULES.md` section B
- Extended ruleset: `src/rules/design/typography.md` (characters, spacing, formatting, layout, responsive, dark mode, maxims)
- CSS baseline: `css-templates.md` (responsive patterns, OpenType, dark mode)
- Entity reference: `html-entities.md` (substitution rules, usage patterns)
- Finding contract: `src/skills/_shared/finding.md`
- Sibling audits: `src/skills/design-audit/SKILL.md` (visual), `src/skills/design-standards/SKILL.md` (a11y/forms/perf)
- Orchestrator: `src/skills/omnibus/SKILL.md`
