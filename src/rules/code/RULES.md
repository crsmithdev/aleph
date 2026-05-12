# Code Rules

Authoritative rules for TypeScript/JavaScript source under `src/` (excluding `src/ui/` for visual concerns; see `design/`). Read by `code-audit` (post-hoc) and applied silently by `code-author` (CLAUDE.md-loaded, write-time).

**Status: stub.** Will be populated in Phase 2 of the skill-architecture migration. Until then, `code-audit` falls back to:
- CLAUDE.md and `.claude/CLAUDE.md` rules
- `src/skills/code-review/SKILL.md` checks (architectural fit, type safety, security, performance)
- `src/skills/code-simplify/SKILL.md` slop patterns

## Planned sections

- **A. Type safety** — strict mode, no `any`, exhaustive switches, narrowing patterns
- **B. AI slop** — defensive code for impossible cases, scope creep, backwards-compat shims, comments restating code
- **C. Duplication** — single-source-of-truth, when to consolidate, when to leave inline
- **D. Drift** — peer conformance against a reference (the consolidation half of conform)
- **E. Test coverage** — what needs a test, what doesn't, contract vs. unit
- **F. Architectural fit** — module placement, separation of concerns, abstraction depth
- **G. Performance** — N+1, O(n²), memoization, leak prevention
- **H. Error handling** — what to catch, what to propagate, what to ignore
