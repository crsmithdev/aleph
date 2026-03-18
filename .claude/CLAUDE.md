# Construct Development

This is the Construct source repo. The installed Construct rules come from `~/.claude/CLAUDE.md`.

## Dev workflow

1. Edit source in `construct/` and `dotclaude/`
2. Run `bun install.ts` to deploy to `~/.claude/`
3. Run `bun test.ts` to verify

## Directory map

| Path | Purpose | Installs to | Method |
|---|---|---|---|
| `construct/` | Hook code, skills, identity files | `~/.claude/construct/` | Sync (overwrite + delete stale) |
| `dotclaude/` | CLAUDE.md rules, settings (hooks), commands | `~/.claude/` | Merge (overwrites Construct-owned content, preserves the rest) |
| `.claude/` | Project-local dev config (this file, permissions, statusline) | nowhere — used at runtime | — |
| `~/.claude/` | Installed runtime | — | Read-only; only written by `bun install.ts` |

## Avoiding duplication

Claude Code merges `.claude/` (project) with `~/.claude/` (global) at runtime. If the same hook, command, or setting exists in both, it fires/loads twice. To prevent this:

- **Never** put hooks, commands, or CLAUDE.md rules in `.claude/`. Those belong in `dotclaude/` (installed to `~/.claude/`).
- `.claude/settings.json` may only contain permissions, statusline, and MCP server config — never hooks.
- `.claude/CLAUDE.md` is dev-context only (this file). Construct behavioral rules live in `dotclaude/CLAUDE.md`.
