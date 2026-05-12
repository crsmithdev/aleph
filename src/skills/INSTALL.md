# construct-skills — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/skills/skill-rules.json` exists and is valid JSON with a `rules` array
- `construct/core/hooks/routing-classify-submit.ts` exists
- `construct/core/hooks/quality-format-edit.ts` exists
- SKILL.md files exist: `agent-browser`, `code-debug`, `code-refactor`, `code-review`, `code-simplify`, `context-compact`, `design-audit`, `design-fix`, `docs-author`, `docs-optimize`, `eval-harness`, `git-workflow`, `ralph-loop`, `search`, `skill-creator`, `test-webapp`, `verify-completion`

## Registration

- `core/hooks/routing-classify-submit.ts` registered under `UserPromptSubmit` in `settings.json`
- `core/hooks/quality-format-edit.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `construct/core/identity/AGENTS.md` exists and is non-empty
