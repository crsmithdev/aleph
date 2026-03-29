# construct-skills — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/skills/skill-rules.json` exists and is valid JSON with a `rules` array
- `construct/skills/hooks/format-reminder.ts` exists
- `construct/skills/hooks/quality.ts` exists
- `construct/skills/hooks/notify.ts` exists
- SKILL.md files exist: `build`, `debugging`, `verification`, `finishing-branch`, `git-worktrees`, `code-review`, `docs-review`, `commands-review`, `config-review`, `hooks-review`, `skills-review`, `research`, `ralph-loop`

## Registration

- `skills/hooks/format-reminder.ts` registered under `UserPromptSubmit` in `settings.json`
- `skills/hooks/quality.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `skills/hooks/notify.ts` registered under `Notification` in `settings.json`
- `CLAUDE.md` contains `## Agent Personas`
