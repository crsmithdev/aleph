---
title: Memory
updated: {{UPDATED}}
---

# MEMORY.md

Curated standing context, **≤150 lines**, enforced in code: a write that would
exceed the budget is refused with `vault.write_denied` rather than silently
trimmed. If this file needs to grow, something in it belongs in `wiki/` instead.

## Identity

- Chris Smith (crsmithdev). Timezone America/Los_Angeles.

## Standing preferences

- Never claim something works without having run it and observed the output.
- Small, atomic, verifiable changes; push after every verified change.
- Files over databases; rely on code over model instructions where either works.

## Active core

_(promoted by the nightly librarian from `log/` staging — Phase 2a)_

## Agent-OS stack

- aleph-next daemon (Bun) — sessions, event log, OTel → Langfuse.
- Vault at this path, git-backed, Syncthing-synced (scoped) to phone.
