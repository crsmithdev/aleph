---
name: design-standards
description: >
  Full design audit: Phase 1 checks code-level rules (grep/static, sections L-R — accessibility,
  forms, performance, navigation, hydration, locale, anti-patterns). Phase 2 does visual review
  of rendered pages against qualitative rules (sections A-K — hierarchy, typography, color,
  alignment, components, state coverage, dark mode, density, responsiveness). Emits SARIF findings
  per `src/skills/_shared/finding.md` plus a phased prose summary. Read-only — no edits.
  Triggers on "check accessibility", "audit for best practices", "review for a11y", "check web
  standards", "check the design", "design looks off", "design check", or `/design-standards`.
  For fix application see `design-fix`. For visual-only audit see `design-audit`.
verb: audit
domain: design
modes: [report]
metadata:
  version: "3.0.0"
  argument-hint: <file-or-pattern>
---

# Design Standards

Two-phase audit: code-level greppable checks first, then visual review of rendered surfaces.

This skill is a pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to check accessibility, web standards, a11y, or overall design quality.
- User invokes `/design-standards`, or the omnibus dispatches the design domain audit.
- For purely visual review only: `design-audit`. For typography only: `design-type`.

## When NOT to use

- Applying fixes → `design-fix`.
- Logic/feature work → out of scope.

## Inputs

1. **Scope** — files or pattern. Defaults to `--diff` against `origin/main` over `src/ui/**`.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

---

## Phase 1: Code-level checks (sections L-R)

### 1.1 Resolve scope

```bash
git diff --name-only origin/main...HEAD -- 'src/ui/**/*.tsx' 'src/ui/**/*.ts'
find <path> -name '*.tsx' -not -path '*/node_modules/*'
```

If `--diff` returns empty: stop and surface *"No files in scope. Try `--module <path>`, `--since HEAD~5`, or `--all`."* — do not silently audit nothing.

### 1.2 Walk sections L-R

Evaluate each in-scope file against sections L through R in `src/rules/design/RULES.md`. Full checklist in `src/rules/design/accessibility.md`.

Priority order when ranking severity:

1. **Accessibility (L)** — aria-labels, semantic HTML, keyboard handlers, focus states → `important`
2. **Anti-patterns (R)** — `outline-none` without replacement, div-as-button, paste blocking, zoom disabling → `important`
3. **Forms (M)** — autocomplete, input types, labels, error handling → `important`
4. **Performance (N)** — virtualization, layout thrashing, image dimensions → `important` or `nit`
5. **Hydration safety (P)** — SSR/CSR mismatches, `Date.now()` in render → `important`
6. **Navigation & state (O)** — URL sync, deep linking, destructive action guards → `nit` or `important`
7. **Locale & i18n (Q)** — hardcoded strings, ICU formatting → `nit`

Also check greppable code-level rules from earlier sections:
- **B.1-B.3** Typography: straight quotes, `--`/`---` in JSX text, three-period ellipsis → `nit`
- **B.4** `max-width: 65ch` on text containers → `important`
- **C.1** Inline hex colors → `important`

### 1.3 Apply negative-filter

Per `src/skills/_shared/finding.md`:
- Pre-existing issues outside scope → "Pre-existing Issues" section
- Linter-catchable → cite `eslint-plugin-jsx-a11y/<rule>`, `severity: nit`
- Lint-ignored lines → drop

---

## Phase 2: Visual review (sections A-K)

### 2.1 Check dev server

```bash
ss -tlnp | grep 3001
```

If not running: emit a `suggestion` finding: "Dev server not running — start with `bun dev-server.ts` to enable visual review. Phase 2 skipped." Then output Phase 1 findings only.

### 2.2 Capture screenshots

Take a screenshot of each in-scope page. In priority order:

1. **Use latest screenshot** if recently captured (within the session):
   ```bash
   ~/.local/bin/latest-shot
   ```

2. **Capture via agent-browser** if no recent screenshot — spawn `Agent(subagent_type: "agent-browser")` with:
   - "Navigate to http://localhost:3001/<route>, take a screenshot, return the file path."
   - Do this for each route that has in-scope TSX files.

3. **Check dark mode**: if the page has dark mode support, capture in both light and dark.

Read each screenshot file using the Read tool.

### 2.3 Walk sections A-K visually

For each screenshot, evaluate against:

- **A — Visual hierarchy & rhythm**: Is the primary action unmissable within 2 seconds? Is vertical rhythm consistent?
- **B — Typography**: Font sizes, line heights, spacing rhythm — does it match the type scale in `src/rules/design/typography.md`?
- **C — Color**: Are colors used purposefully? Is contrast sufficient (WCAG AA)?
- **D — Alignment & grid**: Are elements consistently grid-aligned? No "off by 1-2px" misalignment?
- **E — Components**: Are design-system components used consistently, or are there one-off implementations?
- **F — Iconography**: Are icons from the approved set (Material Symbols)? Consistent sizing?
- **G — Motion**: Any layout shifts or janky transitions visible on navigation?
- **H — State coverage**: Are loading/empty/error states rendered correctly? (Navigate to empty state, error state if testable)
- **I — Dark mode**: If applicable — does the rendered dark mode look correct (no missing tokens, no white flashes)?
- **J — Density**: Is the density appropriate for the content type and viewport?
- **K — Responsiveness**: Does the layout hold at narrower viewports?

For each qualitative finding, anchor to a specific JSX node in the source (`file:line`). "The hierarchy looks off" without a concrete location is not a valid finding.

### 2.4 Apply reduction filter

For every visual element:
- Can this be removed without losing meaning?
- Would a user need to be told this exists? If yes, redesign until obvious.
- Is visual weight proportional to functional importance?

---

## Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "design-standards"`. Phase 1 and Phase 2 findings in one run.

```json
{
  "ruleId": "design/RULES.md#<section-letter>",
  "level": "error" | "warning" | "note" | "none",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion",
    "fix": "<concrete proposed change>",
    "tag": "a11y" | "forms" | "perf" | "nav" | "hydration" | "locale" | "anti-pattern" | "typography" | "tokens" | "hierarchy" | "state-coverage",
    "phase": "code" | "visual",
    "scope": "diff" | "module" | "all"
  }
}
```

---

## Phased prose summary

```
# Design Standards — <scope>

## Phase 1 — Critical (blocking + important)
- <file:line> — <rule> — <one-line> (confidence X) [code|visual]

## Phase 2 — Refinement (nit)
- ...

## Phase 3 — Polish (suggestion + learning)
- ...

## Pre-existing issues (out of scope)
- ...
```

---

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash` except screenshot capture.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **Anchor every finding.** Qualitative findings without `file:line` are not valid.

## Guardrails

- **Confidence is provisional.** Omnibus validation pass refines it.
- **Cite rules precisely.** Every finding includes `design/RULES.md#<section-letter>`.
- **Negative-filter is non-negotiable.** When in doubt, don't flag.
- **Don't double-report.** If `eslint-plugin-jsx-a11y` catches it, cite the linter.

## Cross-references

- Rule source: `src/rules/design/RULES.md`, full accessibility checklist: `src/rules/design/accessibility.md`
- Finding contract: `src/skills/_shared/finding.md`
- Sibling audits: `src/skills/design-audit/SKILL.md` (visual-only, deeper), `src/skills/design-type/SKILL.md` (typography)
- Fix counterpart: `src/skills/design-fix/SKILL.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
