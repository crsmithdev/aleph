# construct-skills — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/skills/skill-rules.json` exists and is valid JSON with a `rules` array
- `construct/core/hooks/routing-submit-classify.ts` exists
- `construct/core/hooks/quality-post-format.ts` exists
- SKILL.md files exist: `git-worktrees`, `research`, `ralph-loop`, `systematic-debugging`, `webapp-testing`, `skill-creator`, `frontend-design`, `using-git-worktrees`, `verification-before-completion`, `finishing-a-development-branch`, `code-simplifier`, `agent-browser`

## Registration

- `core/hooks/routing-submit-classify.ts` registered under `UserPromptSubmit` in `settings.json`
- `core/hooks/quality-post-format.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `construct/core/CLAUDE.md` contains `## Agent Personas`
