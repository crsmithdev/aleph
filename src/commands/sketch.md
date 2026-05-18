---
description: Capture an idea as a slim, opinionated sketch — frame, shape, prior art, open questions
---

Build a structured design sketch for the subject in `$ARGUMENTS`.

Read and follow `~/.claude/construct/skills/sketch/SKILL.md` end-to-end.

A sketch is about the **idea**, not the plan. Avoid file paths, task lists,
verification commands, rollback strategies — those belong in `/plan`. If
the request is ambiguous, ask 3–5 short questions before writing.

Save to the configured `sketches.outputDir` (default
`~/.construct/sketches/<slug>.md`). Report one line: `→ <absolute-path>`.
