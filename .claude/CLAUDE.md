# Construct Development

This is the Construct source repo. The installed Construct rules come from `~/.claude/CLAUDE.md`.

## Layout

- `construct/` — source modules (hooks, skills, identity). Installed to `~/.claude/construct/`
- `dotclaude/` — install sources (CLAUDE.md, settings.json, commands). Installed to `~/.claude/`
- `.claude/` — dev-time config only (this file, settings.json for local hook testing)
- `install.ts` — copies construct/ and dotclaude/ to `~/.claude/`, rewrites paths

## Dev workflow

1. Edit source in `construct/` and `dotclaude/`
2. Hooks fire locally via `.claude/settings.json` (paths point to `construct/`)
3. Run `bun install.ts` to deploy to `~/.claude/`
4. Run `bun test.ts` to verify
