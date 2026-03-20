# construct-ui — Post-install Checks

All paths relative to `~/.claude/construct/ui/`. Run every check. Do not skip or summarize.

## Files

- `api/src/app.ts` exists
- `web/src/App.tsx` exists
- `package.json` exists and contains `"workspaces"`

## Data

- Database at `~/.claude/construct/data/construct.db` may or may not exist (created on first run)

## Build

- `npm run build` completes without errors (run from ui directory)
- `npm test` passes (Vitest API integration tests)
