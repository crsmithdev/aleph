---
name: code-audit
description: Audit TypeScript/JavaScript code under src/ against src/rules/code/RULES.md. Emits SARIF findings (per src/skills/_shared/finding.md) plus a phased prose summary. Read-only — no edits. Triggers on "audit the code", "review the diff", "/code-audit", or when the omnibus dispatches the audit verb to the code domain.
verb: audit
domain: code
modes: [report]
---

# Code Audit

Walks code in scope, evaluates each rule in `src/rules/code/RULES.md`, and emits findings in SARIF format. Does **not** apply fixes — that's `code-fix`.

This skill is a pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to review/audit the current branch or a module.
- User invokes `/code-audit` directly, or `/audit code`.
- The omnibus dispatches the `audit` verb to the `code` domain.

## When NOT to use

- Visual/layout review → `design-audit`.
- Documentation review → `docs-audit`.
- Hook/agent/skill audit → those domain leaves.
- Security audit → `security-audit` (separate domain).
- Fix-mode work (applying changes) → `code-fix`.

## Inputs

1. **Scope** (default: diff) — `--diff` against `origin/main`, `--module <path>`, or `--all`.
2. **Reference** (optional) — a file/section/symbol; when provided, enables drift checks (RULES §D).
3. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. Resolve scope

```bash
# Default
git diff --name-only origin/main...HEAD -- 'src/**/*.ts' '*.ts' | grep -v '^src/ui/'

# --module <path>
find <path> -name '*.ts' -not -path '*/node_modules/*'

# --all
find src -name '*.ts' -not -path '*/node_modules/*' -not -path 'src/ui/*'
```

Exclude `src/ui/` (visual concerns → `design-audit`), `*.generated.ts`, `.worktrees/`, and anything matched by `omnibus.yml` `leaves.code-audit.exclude`.

### 2. Walk the rules

For each in-scope file, evaluate every section in `src/rules/code/RULES.md` (A through H). For each rule, the `Detect:` line in RULES.md describes the signal. Concrete examples:

- **A.1 (no `any`):** grep `as any` in each file; exclude `JSON.parse` results and third-party-boundary casts (mark those with a same-line comment).
- **A.4 (no bare `@ts-ignore`):** grep for `@ts-ignore` and `@ts-expect-error`; flag if the next 80 chars on the same line contain no `//` justification.
- **B.1 (defensive code):** find try/catch blocks whose body has no rethrow/log/branching — the catch swallows the error.
- **B.2 (comments restating code):** for each `//` comment, compare its tokens to the next non-blank line's identifiers; flag if ≥60% overlap.
- **C.1 (inline reimplementation):** for each function in scope, grep `src/` for distinctive substrings of its body; flag matches outside that file.
- **F.3 (hooks in `.claude/`):** check `.claude/settings.json` for a `hooks` array — single grep, single finding if present.
- **H.1 (hooks fail loudly):** for each file under `src/core/hooks/`, confirm `JSON.parse(await Bun.stdin.text())` is inside a try/catch and the catch exits non-zero.

When a rule's Detect signal doesn't apply to the current scope (e.g., G.1 N+1 queries on a docs-only diff), skip silently — no "no findings" noise per rule.

### 3. Apply negative-filter list

For every candidate finding, check the negative-filter list (in `src/rules/code/RULES.md` and mirrored in `src/skills/_shared/finding.md`):

- Style/quality concerns not in RULES.md → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" run, not in primary findings
- Pedantic nitpicks → drop
- Issues a linter would catch → cite `agnix/<rule>` or `eslint/<rule>`, mark `severity: nit`
- Lint-ignored lines → drop

The validation pass (performed by the omnibus) is the second line of defense; this skill is the first.

### 4. Emit SARIF

Output a single SARIF v2.1.0 run with `tool.driver.name = "code-audit"`. Per `src/skills/_shared/finding.md`, each `result` has:

```json
{
  "ruleId": "code/RULES.md#<section-anchor>",
  "level": "error" | "warning" | "note" | "none",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": <0-100, set provisionally; validation pass refines>,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "learning" | "praise",
    "fix": "<concrete proposed change>",
    "tag": "<from RULES.md Tag: line>",
    "scope": "diff" | "module" | "all"
  }
}
```

When proposing a `praise` finding, look for code that's notably well-done — comprehensive error handling that's not defensive, a clean abstraction, a hard problem solved simply. At least one `praise` per audit when warranted.

### 5. Emit a phased prose summary

After the SARIF block, output a phased report for human readers (the omnibus reads the SARIF; humans read the prose):

```
# Code Audit — <scope>

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X)

## important (N)
- ...

## nit (N)
- ...

## suggestion / learning / praise (N each)
- ...

## Pre-existing issues (out of scope, M)
- ...
```

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or `Bash` calls that mutate state. Bash is used for `git diff`, `grep`, `find` only.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating; `gate("code")` runs only when `code-fix` finishes applying changes.

## Output template

The SARIF JSON block goes first (the omnibus reads it). The prose phased report follows (humans read it).

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Code Audit — <scope>
<phased prose>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report.

## Guardrails

- **Confidence is provisional.** The audit emits its own confidence guess; the omnibus's validation pass refines it. Don't pretend the confidence is final.
- **Cite rules precisely.** Every finding includes a `code/RULES.md#<anchor>` ruleId. No bare prose accusations.
- **Don't double-report.** If agnix or eslint would catch it, cite them (`agnix/<rule>`) — don't issue a separate code-audit finding.
- **Praise is intentional.** Most audits will have at least one `praise` finding. Make it specific (cite the file/lines), not generic.
- **Negative-filter is non-negotiable.** When in doubt about whether to flag, don't.

## Cross-references

- Rule source: `src/rules/code/RULES.md`
- Finding contract: `src/skills/_shared/finding.md` (SARIF schema + Construct extensions)
- Fix counterpart: `src/skills/code-fix/SKILL.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
