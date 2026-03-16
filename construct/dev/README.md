# construct-dev

Quality hook, notification hook.

**Depends on:** construct-core

## Contents

- `hooks/quality.ts` — per-file lint/format on Edit/Write (PostToolUse)
- `hooks/notify.ts` — WSL toast / macOS alert / terminal bell (Notification)

## Usage

**Quality** — runs silently after every file edit. Claude auto-formats and lints files using tools available on your system (ruff for Python, prettier for JS/TS, gofmt for Go, rustfmt for Rust). If a formatter isn't installed, it's skipped.

To override the defaults for a project, create `.claude/quality.json` in the project root:

```json
{"format": "prettier --write $FILE", "lint": "eslint --fix $FILE"}
```

**Notify** — sends a notification when Claude needs your attention (waiting for input, needs permission, or finished a task). Shows as a Windows toast on WSL, osascript alert on macOS, or terminal bell as fallback.

## Verification

Post-install checks: see [INSTALL.md](INSTALL.md).
