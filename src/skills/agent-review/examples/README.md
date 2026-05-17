# Agent Review — examples

Worked invocations covering every sub-surface and both modes. Each file is self-contained.

- `audit-all.md` — full health check across config, hooks, skills, personas (scope=all). Default `/agent-review` invocation.
- `audit-config.md` — config sub-surface only (CLAUDE.md @-includes, MCP, permissions).
- `audit-hooks.md` — hooks sub-surface only (diff scope, smart default).
- `audit-skills.md` — skills sub-surface only (registry consistency, R1/R4, trigger health).
- `audit-personas.md` — personas sub-surface only (cross-domain drift, routing-collision).
- `fix-hooks.md` — fix mode on hooks findings (stdin try/catch, trace, dead-output).
- `fix-skills.md` — fix mode on skills findings (R1, R4, frontmatter, registry).
- `fix-personas.md` — fix mode on personas findings (over-privileged, Task tool, statelessness).

Example invocation: "audit my config" or "/agent-review". The skill walks all four sub-surfaces (config, hooks, skills, personas) against `src/rules/agent/*.md`, then emits a phased SARIF report with findings tagged by `sub_surface`. No changes are written without explicit approval. In `mode: fix`, the omnibus dispatches approved findings; this skill applies edits and verifies with the appropriate gates.
