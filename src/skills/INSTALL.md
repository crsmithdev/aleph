# aleph-skills — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `aleph/skills/skill-rules.json` exists and is valid JSON with a `rules` array
- `aleph/core/hooks/routing-classify-submit.ts` exists
- `aleph/core/hooks/quality-format-edit.ts` exists
- SKILL.md files exist: `address`, `agent-review`, `audit`, `code-review`, `code-test`, `context-compact`, `debug`, `design-review`, `docs-review`, `dogfood`, `git`, `interview`, `ralph-loop`, `red-team`, `search`, `skill-creator`

## Registration

- `core/hooks/routing-classify-submit.ts` registered under `UserPromptSubmit` in `settings.json`
- `core/hooks/quality-format-edit.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `aleph/core/identity/AGENTS.md` exists and is non-empty
