# Agents Rules

Authoritative rules for subagent definitions (`.claude/agents/*.md` or per the agent registry). Read by `agents-audit` and applied by `agents-author`.

**Status: stub.** Will be populated in Phase 6. Largely net-new content.

## Planned sections

- **A. Frontmatter** — required fields (`name`, `description`, `tools`); `model` if not inherited
- **B. Description quality** — triggers, scope, when NOT to use; must be specific enough that the dispatcher can route accurately
- **C. Tool whitelist sanity** — minimum necessary; no `Task` (subagents don't spawn subagents — see `skills/RULES.md` E and `docs/plans/skill-architecture.md` R1)
- **D. Trigger overlap** — keywords/descriptions must not collide ambiguously with sibling agents
- **E. Output contract** — what the parent process can expect back (free-form text only; or structured)
- **F. Stateless** — no implicit dependency on prior turns within the parent session
