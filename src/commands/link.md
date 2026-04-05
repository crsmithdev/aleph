# /link — Toggle linked mode

Switches the Construct install between **linked** (live from repo) and **copy** mode.
Run `bun link.ts` from the repo root.

## States

```bash
ls -la ~/.claude/ | grep construct
```

- `lrwxrwxrwx ... construct -> ~/construct/src/` → **linked-on** (serving live from repo)
- `lrwxrwxrwx ... construct -> ~/.claude/construct-<id>` → **linked-off** (symlink to backup)
- `drwxr-xr-x ... construct` → **installed** (real directory copy)

## Transitions

| From | Command | Result |
|------|---------|--------|
| installed | `bun link.ts` | backs up real dir as `construct-<word1-word2-noun>`, creates symlink → repo `src/` |
| linked-on | `bun link.ts` | retargets symlink to backup dir (linked-off) |
| linked-off | `bun link.ts` | retargets symlink back to repo `src/` (linked-on) |

```bash
cd ~/construct && bun link.ts
```

## What changes in linked mode

| | Linked | Installed |
|--|--------|-----------|
| `~/.claude/construct` | symlink → `~/construct/src/` | file copy |
| API code | live from repo (restart to pick up changes) | static copy |
| Frontend assets | Vite middleware — HMR, no build needed | served from `web/dist/` |
| Commands / hooks | copied on initial link; re-link to pick up new files | copied on install |

The server runs on **port 3000** in both modes.

## Unlink (restore copy mode)

```bash
cd ~/construct && bun install.ts
```
