# aleph-ui — Post-install Checks

All paths relative to `~/.claude/aleph/ui/`. Run every check. Do not skip or summarize.

## Files

- `api/src/app.ts` exists
- `web/src/App.tsx` exists
- `package.json` exists and contains `"workspaces"`

## Data

- Database at `~/.aleph/aleph.db` may or may not exist (created on first run)

## Build

- `web/dist/index.html` exists (built automatically by `bun install.ts`)
- `web/dist/assets/` contains at least one `.js` file

