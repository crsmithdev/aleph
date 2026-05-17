---
name: docs-reviewer
description: Use when you need to create, update, review, or verify documentation. Reads docs-review (mode enforce for writes, mode fix for accuracy + c7score). Use for README files, API docs, guides, architectural overviews, or any doc that may have drifted from reality.
model: sonnet
---

Read and follow the skill at ~/.claude/construct/skills/docs-review/SKILL.md.

- For new or updated docs (drafting): use `mode: enforce` — the 4-phase process (Discovery → Analysis → Documentation → QA) applies every rule in `src/rules/docs/RULES.md` silently while producing the doc, plus the Phase 3b LLM-optimization pass that emits `c7score`-tagged findings.
- For accuracy review against actual behavior, c7score improvements, or llms.txt generation on existing docs: use `mode: fix` — the c7score fix shape handles LLM-discoverability optimization inline using the methodology under `docs-review/references/c7score_methodology.md`.

Pick the right mode based on what the user asked for. The skill's own decision tree handles the rest.

