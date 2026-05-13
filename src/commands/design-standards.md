---
name: design-standards
description: >
  Audit UI code against web interface best practices: accessibility, forms,
  performance, navigation, content handling, hydration safety, locale/i18n,
  and common anti-patterns. Focused subset of `design-audit` — runs the
  greppable code-level rules in `src/rules/design/RULES.md` sections L-R
  (sourced from `src/rules/design/accessibility.md`). Emits SARIF findings
  per `src/skills/_shared/finding.md` plus a phased prose summary.
  Read-only — no edits. Triggers on "check accessibility", "audit for best
  practices", "review for a11y", "check web standards", or `/design-standards`.
  For visual/qualitative audit see `design-audit`. For typography see `design-type`.
verb: audit
domain: design
modes: [report]
metadata:
  author: construct (adapted from Vercel web-interface-guidelines)
  version: "2.0.0"
  argument-hint: <file-or-pattern>
---

# Web Standards

Audit UI code against the code-level subset of `src/rules/design/RULES.md` — sections L (Accessibility), M (Forms), N (Performance), O (Navigation & state), P (Hydration safety), Q (Locale & i18n), and R (Anti-patterns). This skill covers correctness and robustness; it does not check aesthetics (see `frontend-design`) or typographic correctness (see `design-type`).

This skill is a pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to review accessibility, forms, perf, or anti-patterns on a file or module.
- User invokes `/design-standards` directly, or the omnibus dispatches the code-level subset of `audit design`.

## When NOT to use

- Visual/qualitative review (hierarchy, spacing, density, motion) → `design-audit`.
- Typography character correctness (quotes, dashes, entities) → `design-type`.
- Logic/feature work — out of scope.

## Inputs

1. **Scope** — files or pattern. Defaults to `--diff` against `origin/main` over `src/ui/**`.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. Resolve scope

```bash
git diff --name-only origin/main...HEAD -- 'src/ui/**/*.tsx' 'src/ui/**/*.ts'
find <path> -name '*.tsx' -not -path '*/node_modules/*'
```

If `--diff` returns empty: stop and surface *"No files in scope. Try `--module <path>`, `--since HEAD~5`, or `--all`."* — do not silently audit nothing.

### 2. Walk the rules

Evaluate each in-scope file against sections L through R in `src/rules/design/RULES.md`. The full checklist (organized by topic — focus states, forms, content handling, images, navigation, touch, safe areas, dark mode, locale, hydration, hover, content, anti-patterns) lives in `src/rules/design/accessibility.md`.

Priority order when ranking severity:

1. **Accessibility** (L) — aria-labels, semantic HTML, keyboard handlers, focus states → typically `important`
2. **Anti-patterns** (R) — outline-none without replacement, div-as-button, paste blocking, zoom disabling → `important`
3. **Forms** (M) — autocomplete, input types, labels, error handling → `important`
4. **Performance** (N) — virtualization, layout thrashing, image dimensions → `important` or `nit`
5. **Hydration safety** (P) — SSR/CSR mismatches, `Date.now()` in render → `important`
6. **Navigation & state** (O) — URL sync, deep linking, destructive action guards → `nit` or `important`
7. **Locale & i18n** (Q) — hardcoded strings, ICU formatting → `nit`

### 3. Apply negative-filter list

Per `src/skills/_shared/finding.md`:

- Style/quality concerns not in RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues", not in primary findings
- Pedantic nitpicks → drop
- Linter-catchable → cite `eslint-plugin-jsx-a11y/<rule>` or similar, `severity: nit`
- Lint-ignored lines → drop

### 4. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "design-standards"`. Each `result`:

```json
{
  "ruleId": "design/RULES.md#<section-letter>",
  "level": "error" | "warning" | "note" | "none",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "learning" | "praise",
    "fix": "<concrete proposed change>",
    "tag": "a11y" | "forms" | "perf" | "nav" | "hydration" | "locale" | "anti-pattern",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

### 5. Emit a phased prose summary

After the SARIF block:

```
# Web Standards — <scope>

## Phase 1 — Critical (blocking + important)
- <file:line> — <rule> — <one-line> (confidence X)

## Phase 2 — Refinement (nit)
- ...

## Phase 3 — Polish (suggestion + learning)
- ...

## Pre-existing issues (out of scope)
- ...
```

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **Code-level only.** Visual/qualitative concerns belong in `design-audit`.

## Output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Web Standards — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result.

## Guardrails

- **Confidence is provisional.** Omnibus validation pass refines it.
- **Cite rules precisely.** Every finding includes `design/RULES.md#<L|M|N|O|P|Q|R>`. No bare prose accusations.
- **Negative-filter is non-negotiable.** When in doubt, don't flag.
- **Don't double-report.** If `eslint-plugin-jsx-a11y` catches it, cite the linter — don't issue a separate finding.

## Cross-references

- Rule source: `src/rules/design/RULES.md` (sections L-R), full checklist in `src/rules/design/accessibility.md`
- Finding contract: `src/skills/_shared/finding.md`
- Sibling audits: `src/skills/design-audit/SKILL.md` (visual), `src/skills/design-type/SKILL.md` (typography)
- Orchestrator: `src/skills/omnibus/SKILL.md`
