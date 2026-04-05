# /link — Toggle linked mode

Switches the Construct install between **linked** (live from repo) and **copy** mode.

## Detect current state

```bash
ls -la ~/.claude/ | grep construct
```

- `lrwxrwxrwx ... construct -> ...` → currently **linked**
- `drwxr-xr-x ... construct` → currently **installed (copy)**

## Link (copy → linked)

Creates a symlink so `~/.claude/construct` points directly to `~/construct/src/`.
The running server detects the symlink and switches to Vite middleware mode,
serving API code and frontend assets live from the repo with no stale copies.

```bash
cd ~/construct && bun install.ts --link
```

## Unlink (linked → copy)

Removes the symlink and runs a full install: copies files, builds the UI, restarts the service in production mode.

```bash
cd ~/construct && bun install.ts
```

## What changes in linked mode

| | Linked | Installed |
|--|--------|-----------|
| `~/.claude/construct` | symlink → `~/construct/src/` | file copy |
| API code | live from repo (restart to pick up changes) | static copy |
| Frontend assets | Vite middleware — HMR, no build needed | served from `web/dist/` |
| Commands / hooks | copied once on link; re-link to pick up new files | copied on install |

The server runs on **port 3000** in both modes.
