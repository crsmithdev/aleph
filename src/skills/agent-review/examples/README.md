# Agent Review — examples

Worked invocations covering every sub-surface. Each file is self-contained.

- `audit-all.md` — full health check across config, hooks, skills, personas (scope=all). Default `/agent-review` invocation.
- `audit-config.md` — config sub-surface only (CLAUDE.md @-includes, MCP, permissions).
- `audit-hooks.md` — hooks sub-surface only (diff scope, smart default).
- `audit-skills.md` — skills sub-surface only (registry consistency, R1/R4, trigger health).
- `audit-personas.md` — personas sub-surface only (cross-domain drift, routing-collision).
- `fix-hooks.md` — applying approved hooks findings (stdin try/catch, trace, dead-output).
- `fix-skills.md` — applying approved skills findings (R1, R4, frontmatter, registry).
- `fix-personas.md` — applying approved personas findings (over-privileged, Task tool, statelessness).

Example invocation: "audit my config" or "/agent-review". The skill runs a single combined flow: scan all four sub-surfaces (config, hooks, skills, personas) against `src/rules/agent/*.md`, present findings as phased prose grouped by severity and tagged by sub-surface, request approval at the gate (apply-all / pick / discard), apply approved edits, then verify with the appropriate checks. Default scope is the diff against `main`; fall back to `--all` per sub-surface when diff is empty.
