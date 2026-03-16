# Construct Development

This is the Construct source repo. The installed Construct rules come from `~/.claude/CLAUDE.md`.

## Layout

- `construct/` — source modules (hooks, skills, identity). Installed to `~/.claude/construct/`
- `dotclaude/` — install sources (CLAUDE.md, settings.json, commands). Installed to `~/.claude/`
- `.claude/` — dev-time config only (this file, settings.json for local hook testing)
- `install.ts` — copies construct/ and dotclaude/ to `~/.claude/`, rewrites paths

## Dev workflow

1. Edit source in `construct/` and `dotclaude/`
2. Run `bun install.ts` to deploy to `~/.claude/`
3. Run `bun test.ts` to verify

## Critical: no duplication between .claude/ and ~/.claude/

`.claude/` is dev-only config. `~/.claude/` is the installed runtime.
Claude Code merges project-level `.claude/` with global `~/.claude/`, so anything
present in both will fire/load twice. **Never** put hooks, commands, or settings
in `.claude/` that duplicate what the installer deploys to `~/.claude/`.

- **Hooks**: only in `~/.claude/settings.json` (via `dotclaude/settings.json` source)
- **Commands**: only in `~/.claude/commands/` (via `dotclaude/commands/` source)
- **CLAUDE.md**: `.claude/CLAUDE.md` is dev-context only (this file). Construct rules live in `dotclaude/CLAUDE.md`
- **settings.json**: `.claude/settings.json` has permissions/statusline only. No hooks.
