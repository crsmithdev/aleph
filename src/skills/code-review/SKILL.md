---
name: code-review
description: Scans for dead code, unused imports, silent failures, redundant logic, misnamed identifiers, and dead references.
---

# Code Review

## When to Use

- After completing a feature or significant change
- When cleaning up dead code, unused imports, or technical debt
- Before merging — final quality pass

## When NOT to Use

- Mid-implementation — finish first, then review
- Exploring or reading code — just read it

## Process

### 1 — Scan

Sweep all modified/created files for:

| Category | What to look for |
|----------|-----------------|
| Unused imports | Imported but never referenced. Check for side-effect imports. |
| Unreferenced functions/variables | Declared but never called. Search entire project. |
| Commented-out code | Old code, not explanatory comments. |
| Orphaned files | Not imported or referenced anywhere. Check build/test configs. |
| Duplicate utilities | Same logic exists elsewhere. Keep the better version. |
| Silent failures | `catch {}` or `catch { return null }` when caller needs context. |
| Misnamed identifiers | Name doesn't match behavior. |
| Redundant logic | Could be shorter without losing clarity. |
| Questionable abstractions | Abstraction with low reuse, legacy abstractions with low use |
| Complexity debt | Wrappers/shims/indirection that once served multiple callers but now serve one. Functions extracted "for reuse" but called from exactly one place. Parameterization that's never varied (always-default args, config with one value). Barrel re-exports that just add an import hop. Interfaces wrapping a single primitive. Measure: if inlining it saves lines and loses nothing, flag it. |

### 2 — Verify before removing

For each candidate, confirm it's truly dead. Search the entire project. Check dynamic references, exports, config files.

### 3 — Remove one category at a time

Remove, verify tests pass, then next category. If unsure, flag — don't remove.

### 4 — Check dead references

Collect every file path referenced in config/docs. Verify each exists on disk. Flag missing or empty.

### 5 — Report

- What was removed and why
- What was flagged but left
- Dead references found

## Done when

- All categories scanned across all files in scope
- Every removal verified by passing tests
- Dead references checked in all config/doc files
- Report produced with findings and actions taken

## Principles

- Correctness over cleanliness — never remove something that might be used
- Crash on invalid state — prefer explicit failures over silent swallowing
- Three similar lines > premature abstraction
- Delete completely — all references, files, and traces
