# construct-core — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `CLAUDE.md` exists and contains `# Construct`
- `settings.json` exists and is valid JSON (`jq . settings.json`)
- `ccstatusline` is on PATH (`which ccstatusline`)
- Identity files (⚠ if missing — optional): `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, `BOOTSTRAP.md` in `construct/core/identity/`

## Registration

- Hook registration structure is nested: `hooks.<Event>[].hooks[].command`. To verify a hook is registered, use: `jq '.hooks.<Event>[]?.hooks[]?.command' settings.json | grep '<filename>'`
- `settings.json` has a `statusLine` entry referencing `ccstatusline`

## Data

- Identity files are non-empty (0 bytes = data loss on upgrade)
- `CLAUDE.md` retains user content above `# Construct` (if upgrading)
- `CLAUDE.md` under 300 lines (⚠ if over)
