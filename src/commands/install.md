# /install — Deploy Construct to ~/.claude

Copies `src/` to `~/.claude/construct/`, builds the frontend, installs dependencies,
updates commands/settings/CLAUDE.md, and restarts the production service on port 3000.

```bash
cd ~/construct && bun install.ts
```

## Post-install checks

```bash
systemctl --user status construct-ui        # active (running)
curl -s http://localhost:3000/api/system/info | head -5
```

The installer prints a compact summary. Show that output to the user.

## Dev vs Prod

- **User dev** (port 3001, optional): `bun run dev` — live from `src/`, no install needed
- **Agent verification** (free port ≥ 3002, ephemeral): `PORT=<port> bun run --cwd src/ui start &`, killed when done
- **Prod** (port 3000): this command — built static files, deployed copy
