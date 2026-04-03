# construct-skills — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/skills/skill-rules.json` exists and is valid JSON with a `rules` array
- `construct/core/hooks/routing-submit-classify.ts` exists
- `construct/core/hooks/quality-post-format.ts` exists
- `construct/core/hooks/notify-event-toast.ts` exists
- SKILL.md files exist: `finishing-branch`, `git-worktrees`, `research`, `ralph-loop`, `systematic-debugging`, `webapp-testing`, `skill-creator`, `frontend-design`, `using-git-worktrees`, `verification-before-completion`, `finishing-a-development-branch`, `code-simplifier`, `agent-browser`

## Registration

- `core/hooks/routing-submit-classify.ts` registered under `UserPromptSubmit` in `settings.json`
- `core/hooks/quality-post-format.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `core/hooks/notify-event-toast.ts` registered under `Notification` in `settings.json`
- `CLAUDE.md` contains `## Agent Personas`
