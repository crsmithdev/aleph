# construct-dev — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/dev/hooks/quality.ts` exists
- `construct/dev/hooks/notify.ts` exists

## Registration

- `dev/hooks/quality.ts` registered under `PostToolUse` with matcher `Edit|Write` in `settings.json`
- `dev/hooks/notify.ts` registered under `Notification` in `settings.json`
- `CLAUDE.md` contains `## Dev Conventions` and `## Agent Personas`
