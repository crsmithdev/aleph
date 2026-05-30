---
description: Write an implementation plan — touch list, tasks, verification, rollback
---

Write an implementation plan for the subject in `$ARGUMENTS` (may be a
sketch path, a short topic, or empty — infer from conversation if so).

Read and follow `~/.claude/aleph/skills/plan/SKILL.md` end-to-end.

A plan is the **execution contract**: every file that changes, the order,
the verify command per task, and the rollback path. If the subject is
about *whether* to build something rather than *how*, redirect to
`/sketch`.

Save to the configured `plans.outputDir` (default
`~/.aleph/plans/<slug>.md`). Report one line: `→ <absolute-path>`.
