# Agent — Rules

The `agent` domain covers all AI-runtime configuration: `CLAUDE.md` files, hook scripts, skills, and agent personas. The `agent-review` skill walks all four sub-surfaces in one pass.

| Sub-surface | Files | Rules |
|---|---|---|
| Config | `CLAUDE.md`, `settings.json`, `.claude/` | [config.md](config.md) |
| Hooks | `src/core/hooks/*.ts`, `settings-hooks.json` | [hooks.md](hooks.md) |
| Skills | `src/skills/*/SKILL.md`, `skill-rules.json` | [skills.md](skills.md) |
| Personas | `src/agents/*.md` | [personas.md](personas.md) |

Cross-sub-surface drift (e.g. a persona referencing a renamed skill, a hook writing to a consumer that no longer exists) is a first-class finding emitted by `agent-review`. These checks no longer require the Phase 1.5 cross-domain orchestration that existed when config/hooks/skills/agents were separate domains.
