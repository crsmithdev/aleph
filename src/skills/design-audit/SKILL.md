---
name: design-audit
description: >
  Systematic UI/UX design audit. Walks every screen against `src/rules/design/RULES.md`
  (18 dimensions: hierarchy, typography, color, components, state coverage, dark mode,
  density, responsiveness, accessibility, forms, performance, hydration, locale,
  anti-patterns, etc.). Emits SARIF findings (per `src/skills/_shared/finding.md`)
  plus a phased prose summary (Critical / Refinement / Polish). Read-only — no edits.
  Triggers on "audit the design", "review the UI", "make this feel professional",
  "design review", or `/audit design`.
verb: audit
domain: design
modes: [report]
metadata:
  author: bencium (adapted)
  version: "2.0.0"
  argument-hint: <screen-or-pattern>
---

# Design Audit

Walks UI surfaces in scope, evaluates each rule in `src/rules/design/RULES.md`, and emits findings in SARIF format. Does **not** apply fixes — that's `design-conform` (renamed `design-fix` in a later phase).

This skill is a pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to review/audit a screen, page, or component for visual/UX quality.
- User invokes `/design-audit`, or the omnibus dispatches the `audit` verb to the `design` domain.

## When NOT to use

- Logic/feature work — out of scope.
- Pattern-propagation across peers — `design-conform`.
- Code-level a11y, forms, perf rules are folded into `src/rules/design/accessibility.md` and run as part of this audit (no separate `design-standards` invocation needed).
- Typography correctness is folded into `src/rules/design/typography.md` and run as part of this audit (no separate `design-type` invocation needed).

## Inputs

1. **Scope** (default: smart) — `--diff` against `origin/main`, `--module <path>`, `--since <git-ref>`, or `--all`.
2. **Reference** (optional) — a file/component when the audit is reference-anchored.
3. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. Resolve scope

```bash
git diff --name-only origin/main...HEAD -- 'src/ui/**'
find <path> -name '*.tsx' -not -path '*/node_modules/*'
find src/ui -name '*.tsx' -not -path '*/node_modules/*'   # --all
```

**Smart default:** try `--diff` first. If empty, stop and surface *"No files in scope: `origin/main...HEAD` is empty. Try `--module <path>`, `--since HEAD~5`, or `--all`."* — do not silently audit nothing.

### 2. Walk the rules

For each in-scope file, evaluate every section A through R in `src/rules/design/RULES.md`. Each rule's `Detect:` line specifies the signal (grep, structural check, or "render and read"). Qualitative rules (hierarchy, motion, alignment rhythm) require visual reasoning — render the surface via `bun run ui:smoke` or the dev server and anchor each finding to a specific JSX node (`file:line`).

When a rule's Detect signal doesn't apply to the current scope (e.g., form rules on a screen with no form), skip silently.

For detailed audit instructions on qualitative dimensions, read `design-principles.md` (progressive disclosure).

### 3. Apply the reduction filter

For every element on every screen:

- Can this be removed without losing meaning? Remove it.
- Would a user need to be told this exists? Redesign until obvious.
- Does this feel inevitable? If not, it's not done.
- Is visual weight proportional to functional importance? If not, fix hierarchy.

### 4. Apply negative-filter list

Per `src/skills/_shared/finding.md`:

- Style/quality concerns not in RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues", not in primary findings
- Pedantic nitpicks → drop
- Linter-catchable → cite `eslint/<rule>` or `agnix/<rule>`, mark `severity: nit`
- Lint-ignored lines → drop

### 5. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "design-audit"`. Each `result`:

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
    "tag": "<from RULES.md Tag: line — tokens, typography, a11y, state-coverage, etc.>",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

When proposing `praise`, the bar is concrete: the surface solves a common visual anti-pattern with a clean solution worth propagating. Praise must (a) cite a specific RULES.md rule the surface exemplifies the opposite of, and (b) carry "use this as a reference for: <pattern>" in `fix` so `design-conform` can use it as the anchor for aligning peers.

If no surface qualifies, omit praise. Don't manufacture it.

### 6. Emit a phased prose summary

After the SARIF block:

```
# Design Audit — <scope>

## Phase 1 — Critical (blocking + important)
- <file:line> — <rule> — <one-line> (confidence X)

## Phase 2 — Refinement (nit)
- ...

## Phase 3 — Polish (suggestion + learning)
- ...

## Praise
- <file> — <rule exemplified> — use as reference for <pattern>

## Pre-existing issues (out of scope)
- ...
```

SARIF severity → phase mapping: `blocking + important` → Phase 1; `nit` → Phase 2; `suggestion + learning` → Phase 3. The legacy Critical / Refinement / Polish grouping is preserved.

For the exact phased output template (when run standalone, not via omnibus), see `audit-template.md`.

### 7. Wait for approval

Present the SARIF + phased prose. Do not implement anything — `design-conform` applies approved fixes.

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`. Bash for `git diff`, `grep`, `find`, screenshot capture only.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating; `gate("design")` runs only when `design-conform` finishes applying changes.
- **Design only, not logic.** If a finding requires a functional change, flag it and surface — outside this skill's scope.

## Output template

SARIF block first (omnibus consumer), prose phased report after (human reader):

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Design Audit — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report.

## Guardrails

- **Confidence is provisional.** Omnibus validation pass refines it.
- **Cite rules precisely.** Every finding includes `design/RULES.md#<anchor>`. No bare prose accusations.
- **Anchor qualitative findings to JSX nodes.** "The hierarchy is off" without a `file:line` is not a finding.
- **Praise is intentional.** Specific, with a propagation pointer.
- **Negative-filter is non-negotiable.** When in doubt, don't flag.

## Cross-references

- Rule source: `src/rules/design/RULES.md`
- Reference sub-rules: `src/rules/design/accessibility.md`, `src/rules/design/typography.md`
- Finding contract: `src/skills/_shared/finding.md`
- Progressive-disclosure detail: `design-principles.md`, `audit-template.md`
- Fix counterpart: `src/skills/design-conform/SKILL.md` (renamed `design-fix` in a later phase)
- Orchestrator: `src/skills/omnibus/SKILL.md`
