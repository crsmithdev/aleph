# /install — Deploy Construct to ~/.claude

Runs the full installer: copies `src/` to `~/.claude/construct/`, installs dependencies,
builds the frontend, updates commands/settings/CLAUDE.md, and restarts the service.

If currently in linked mode (`~/.claude/construct` is a symlink), the symlink is replaced
with a fresh copy.

```bash
cd ~/construct && bun install.ts
```

## Post-install checks

After the script completes, verify:

```bash
systemctl --user status construct-ui   # should be active (running)
curl -s http://localhost:3000/api/system/info | head -5
```

## After install

Run the post-install checks above. The installer prints a `=== Symlinks ===` summary at the end — display that output here.
