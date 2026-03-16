---
name: code-review
description: Use after completing a task, during review, or when code feels cluttered. Scans for dead code, unused imports, silent failures, redundant logic, and misnamed identifiers. Also checks that all file paths referenced in configs and docs actually exist.
---

# Code Quality: If It Serves No Purpose, It Must Go

> Code that serves no purpose is not neutral — it is a lie that the next reader must investigate.

Every dead line forces the next developer to ask: "Is this important? Was it left intentionally?" That wasted investigation multiplies across every future reader.

## When to Activate

- After completing a task (post-task cleanup)
- During `/construct audit` (phases 1 + 2)
- When prompted with "clean up", "dead code", "unused", "simplify"
- Before a PR or commit that touches multiple files

## The Process

### Step 1 — Scan

Sweep all modified/created files (or all `.ts` files under `construct/` for a full audit) for these categories:

| Category | What to look for |
|----------|-----------------|
| **Unused imports** | Modules imported but never referenced. Check for side-effect imports (CSS, polyfills) that are intentionally reference-free. |
| **Unreferenced functions/variables** | Declared but never called or accessed. Search the entire project, not just the current file. Check for dynamic references (bracket notation, reflection) and exports consumed elsewhere. |
| **Commented-out code** | Old code preserved "just in case" — not comments explaining why. `// Calculate hash using SHA-256` is a comment. `// const result = oldApi.fetch(url)` is dead code. |
| **Orphaned files** | Files not imported or referenced anywhere. Check build configs, test configs, and scripts. |
| **Duplicate utilities** | Functions that do the same thing as an existing utility. Keep the version with better naming, tests, or documentation. Update all callers. |
| **Silent failures** | Error handling that swallows useful context. `catch {}` or `catch { return null }` when the caller needs to know what failed. |
| **Misnamed identifiers** | Functions/variables whose names don't match what they do. |
| **Redundant logic** | Overly verbose patterns, code that could be shorter without losing clarity. Entire `else` branches returning the same value as the `if`. |

### Step 2 — Verify Before Removing

For each candidate, confirm it is truly dead:

- **Unused imports**: Search the file for any reference to the imported name.
- **Unreferenced functions**: Search the entire project. Check for dynamic references and exports consumed elsewhere.
- **Commented-out code**: Distinguish code from documentation comments.
- **Orphaned files**: Verify no imports, requires, or references point to the file. Check settings.json, CLAUDE.md, SPEC.md, README.md, all INSTALL.md files, skill-rules.json, and construct.md.
- **Duplicates**: Confirm identical behavior before removing.

### Step 3 — Remove One Category at a Time

- Remove one category, verify tests still pass, then proceed to the next.
- Do NOT remove code outside the scope of the current task unless it was created or modified as part of this task.
- If unsure whether something is dead, flag it for the user — don't remove it.

### Step 4 — Check Dead References

Collect every file path referenced in: `settings.json`, `CLAUDE.md`, `SPEC.md`, `README.md`, all `INSTALL.md` files, `skill-rules.json`, `construct.md`.

- Check each path exists on disk (resolve relative to `~/.claude/` or project root as appropriate).
- Check every hook command in `settings.json` and verify the target file exists.
- Flag: `✗` for missing files, `⚠` for files that exist but are empty.

### Step 5 — Report

Summarize:
- What was removed and why
- What was flagged as suspicious but left (with reasoning)
- Dead references found
- Any duplicates that may warrant consolidation in a future task

For each finding: file, line, issue, suggested fix (one line).

## Principles

- **Correctness over cleanliness.** Never remove something that might be used. When in doubt, flag it.
- **Crash on invalid state.** Prefer explicit failures over silent swallowing. If a catch block has no meaningful recovery, let it propagate.
- **Three similar lines > premature abstraction.** Don't create helpers for one-time operations.
- **Delete completely.** When removing, remove all references, unused files, related artifacts, and every other trace.
