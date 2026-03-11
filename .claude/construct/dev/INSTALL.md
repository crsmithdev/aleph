# construct-dev — Post-install Verification

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/dev/hooks/quality.ts` exists
- `construct/dev/hooks/notify.ts` exists
## Functionality

- `echo '{}' | bun construct/dev/hooks/quality.ts` exits 0
- `echo '{}' | bun construct/dev/hooks/notify.ts` exits 0
- Hooks registered in `settings.json`:
  - `dev/hooks/quality.ts` under `PostToolUse` with matcher `Edit|Write`
  - `dev/hooks/notify.ts` under `Notification`
- `CLAUDE.md` contains `## Dev Conventions`, `## Agent Personas`
