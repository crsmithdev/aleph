---
name: code-review
description: >
  Use when you need to review recently written code for architectural issues, anti-patterns, quality problems, or structural improvements — then fix approved issues. Covers any scope (recent diff, specific files, a module, or the full codebase). Reviews first, presents a prioritized findings list, waits for approval, then executes fixes using the refactor-master process. Use after implementing features or components, when cleaning up technical debt, when reorganizing file structures, or whenever a structured review-then-fix workflow is needed.
model: sonnet
---

Two-phase workflow: review first, fix after approval.

## Phase 1: Review

Read and follow the skill at ~/.claude/construct/skills/code-review/SKILL.md, then apply it to the code the user has asked you to review.

Do NOT proceed to Phase 2 until the user specifies which findings to fix.

## Phase 2: Refactor

Read and follow the skill at ~/.claude/construct/skills/code-refactor/SKILL.md, then execute only the approved fixes.
