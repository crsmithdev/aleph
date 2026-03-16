# construct-dashboard — Post-install Checks

All paths relative to `~/.claude/construct/dashboard/`. Run every check. Do not skip or summarize.

## Files

- `api/src/app.ts` exists
- `web/src/App.tsx` exists
- `mcp/src/index.ts` exists
- `shared/src/index.ts` exists
- `package.json` exists and contains `"workspaces"`
- `tsconfig.base.json` exists
- `mcp/src/index.ts` imports `@modelcontextprotocol/sdk`

## Data

- `api/data/goals.db` may or may not exist (created on first run)

## Build

- `npm run build` completes without errors (run from dashboard directory)
- `shared/dist/index.d.ts` exists after build (type declarations generated)
- `npm test` passes (Vitest API integration tests)
