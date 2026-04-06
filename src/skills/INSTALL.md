# construct-skills — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/skills/skill-rules.json` exists and is valid JSON with a `rules` array
- `construct/core/hooks/routing-submit-classify.ts` exists
- `construct/core/hooks/quality-post-format.ts` exists
- SKILL.md files exist: `agent-browser`, `code-architect`, `code-refactor`, `docs-author`, `docs-optimizer`, `isolate-changes`, `land-changes`, `ralph-loop`, `research`, `simplify`, `skill-creator`, `systematic-debugging`, `using-git-worktrees`, `verify-completion`, `webapp-testing`

## Registration

- `core/hooks/routing-submit-classify.ts` registered under `UserPromptSubmit` in `settings.json`
- `core/hooks/quality-post-format.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `construct/core/identity/AGENTS.md` exists and is non-empty
