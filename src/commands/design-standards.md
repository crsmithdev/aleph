---
name: design-standards
description: >
  Full design audit: code-level checks (accessibility, forms, performance, navigation,
  hydration, locale, anti-patterns) plus visual review of rendered pages against all 18
  design rule dimensions. Emits SARIF findings per `src/skills/_shared/finding.md`.
  Read-only — no edits. Triggers on "check accessibility", "audit for best practices",
  "review for a11y", "check web standards", "check the design", or `/design-standards`.
  For typography only see `design-type`. For fix application see `design-fix`.
verb: audit
domain: design
modes: [report]
metadata:
  version: "3.0.0"
  argument-hint: <file-or-pattern>
---

Read and follow the skill at ~/.claude/construct/skills/design-standards/SKILL.md, then apply it to the files or pages the user has specified.
