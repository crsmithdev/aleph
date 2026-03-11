# construct-core — Post-install Verification

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `CLAUDE.md` exists and contains `# Construct`
- `settings.json` exists and is valid JSON (`jq . settings.json`)
- `settings.json` has a `statusLine` entry referencing `construct/core/hooks/statusline.ts`
- `construct/core/hooks/statusline.ts` exists
- Identity files (⚠ if missing — optional): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, `BOOTSTRAP.md` in `construct/core/identity/`

## Data

- Identity files are non-empty (0 bytes = data loss on upgrade)
- `CLAUDE.md` retains user content above `# Construct` (if upgrading)

## Functionality

- `echo '{}' | bun construct/core/hooks/statusline.ts` exits 0 and produces output
- `CLAUDE.md` under 300 lines (⚠ if over)
