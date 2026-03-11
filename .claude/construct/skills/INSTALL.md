# construct-skills — Post-install Verification

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/skills/skill-rules.json` exists
- `construct/skills/hooks/format-reminder.ts` exists
- `construct/skills/research/SKILL.md` exists

## Functionality

- `skill-rules.json` is valid JSON with a `rules` array (`jq -e '.rules | type == "array"'`)
- `echo '{}' | bun construct/skills/hooks/format-reminder.ts` exits 0
- `echo '{"prompt":"research something interesting online"}' | bun format-reminder.ts` produces output containing "research"
- Hook registered in `settings.json`: `skills/hooks/format-reminder.ts` under `UserPromptSubmit`
