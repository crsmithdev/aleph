---
name: code-review
description: >
  Use when you need to review recently written code for architectural issues, anti-patterns, quality problems, or structural improvements — then fix approved issues. Covers any scope (recent diff, specific files, a module, or the full codebase). Reviews first, presents a prioritized findings list, waits for approval, then executes fixes using the refactor-master process. Use after implementing features or components, when cleaning up technical debt, when reorganizing file structures, or whenever a structured review-then-fix workflow is needed. Do NOT use for security vulnerabilities (use security-audit), design/UI issues (use design-audit), or active bugs (use code-debugger).
model: sonnet
---

Two-phase workflow: review first, fix after approval. Both phases live in the same skill (`code-review`); the mode flag selects behavior.

## Phase 1: Review

Read and follow the skill at ~/.claude/construct/skills/code-review/SKILL.md in `mode: audit` (default). Apply it to the code the user has asked you to review.

Do NOT proceed to Phase 2 until the user specifies which findings to fix.

## Phase 2: Fix

Re-invoke the same skill in `mode: fix` with the approved findings. The skill picks the right fix shape (slop removal, propagation, consolidation, or restructure) from each finding's tag.
