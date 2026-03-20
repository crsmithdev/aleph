# construct-core

Foundation module. Provides CLAUDE.md, settings.json, statusline, and optional identity files.

**Depends on:** nothing (always required)

## Contents

- `CLAUDE.md` — framework rules and behavior (installed at `~/.claude/CLAUDE.md`)
- `settings.json` — hooks, statusline, permissions (installed at `~/.claude/settings.json`)
- `ccstatusline` — external binary for status bar (model, branch, dir, context %, tokens)
- `identity/` — optional semantic identity layer:
  - `SOUL.md` — purpose, values, mental models
  - `IDENTITY.md` — name, tone, personality
  - `STYLE.md` — output formatting, conventions
  - `USER.md` — principal profile, environment

## Usage

The statusline appears automatically at the bottom of Claude Code, showing model, git branch, directory, and context usage. No interaction needed.

Identity files are loaded via `@path` imports in CLAUDE.md and shape how Claude behaves across sessions:

- Edit `SOUL.md` to change Claude's values, priorities, or mental models
- Edit `IDENTITY.md` to adjust tone, personality, or voice
- Edit `STYLE.md` to change output formatting or code conventions
- Edit `USER.md` to update your profile, tech stack, or working preferences

Changes take effect on the next session.

## Verification

Post-install checks: see [INSTALL.md](INSTALL.md).
