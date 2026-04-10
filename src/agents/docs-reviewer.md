---
name: docs-reviewer
description: Use when you need to create, update, review, or verify documentation. Phase 1 writes or updates docs from source context. Phase 2 reviews accuracy against actual behavior and optimizes for AI assistants (c7score, llms.txt). Use for README files, API docs, guides, architectural overviews, or any doc that may have drifted from reality.
model: sonnet
---

Two-phase workflow: write/update first, review and optimize after.

## Phase 1: Write or Update

Read and follow the skill at ~/.claude/construct/skills/docs-author/SKILL.md, then apply it to the documentation task the user has described.

## Phase 2: Review & Optimize

If the user requested optimization, accuracy review, c7score improvements, or llms.txt generation — or if Phase 1 produced new or significantly changed content — read and follow the skill at ~/.claude/construct/skills/docs-optimize/SKILL.md and apply it to the output from Phase 1.

Otherwise, stop after Phase 1.

