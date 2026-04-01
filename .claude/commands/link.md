---
description: Symlink ~/.claude/construct to repo src/ for live development
---

One symlink to make all Construct code changes take effect immediately.

## Steps

1. Verify we're in the construct repo root (install.ts and src/ must exist)

2. Stop services and create the symlink:
   ```bash
   systemctl --user stop construct-ui 2>/dev/null
   if [ -d ~/.claude/construct ] && [ ! -L ~/.claude/construct ]; then
     mv ~/.claude/construct ~/.claude/construct.bak
   fi
   ln -sfn "$(pwd)/src" ~/.claude/construct
   ```

3. One-time setup — sync commands, settings, and CLAUDE.md:
   ```bash
   bun install.ts --link-only
   ```
   This skips the file sync (the symlink handles it) and only does:
   - Copy commands from `src/commands/` + skill SKILL.md files to `~/.claude/commands/`
   - Merge hooks+statusLine from `src/core/hooks/settings-hooks.json` into `~/.claude/settings.json`
   - Update `~/.claude/CLAUDE.md` with `@construct/core/CLAUDE.md` import

4. Verify and restart:
   ```bash
   ls -la ~/.claude/construct
   systemctl --user restart construct-ui 2>/dev/null
   ```

To undo, run `/install` which replaces the symlink with a fresh copy.
