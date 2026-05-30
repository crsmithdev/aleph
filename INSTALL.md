# Installation

## MANDATORY: Read This Completely

After installing or upgrading, you MUST run the post-install verification checks defined in each module's `INSTALL.md`. Do not skip checks. Do not summarize checks. Run every single one and report the result.

When copying files during installation, copy them exactly. Do not summarize, truncate, or paraphrase file contents. Every file must arrive at the target byte-for-byte identical to the source.

## Prerequisites

- `bun` (TypeScript runtime for hooks and installer)

## New Install

```bash
git clone <repo-url> ~/aleph
cd ~/aleph
bun install.ts
```

The installer:
1. Syncs `src/` tree to `~/.claude/aleph/`
2. Copies `src/commands/` + skill SKILL.md files to `~/.claude/commands/`
3. Merges hooks+statusLine from `src/core/hooks/settings-hooks.json` into `~/.claude/settings.json`
4. Sets `~/.claude/CLAUDE.md` to `@import` from `aleph/core/CLAUDE.md`

After install completes, run `/install` in Claude Code. It runs the installer and then automatically reads each module's `INSTALL.md` and executes the Post-install Verification checks listed there. Every check must pass.

**First run:** Claude Code prompts once to approve the external `@~/` identity includes (see README "Identity layering"). Approve to load the user-side identity chain; the decision is reversible in Claude Code settings.

## Upgrade (reinstall)

```bash
cd ~/aleph
git pull
bun install.ts
```

### What gets preserved

The installer automatically discovers and preserves any ALL CAPS `.md` file (filename matches `[A-Z_]+.md`) in two directories:

- `aleph/core/identity/` — e.g. `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, plus any custom files you add (e.g. `PROJECTS.md`, `WORKFLOW.md`)
- `aleph/memory/` — any custom ALL CAPS `.md` files you add (e.g. `GOALS.md`, `DECISIONS.md`)

All user data lives in `~/.aleph/` (databases, sessions, signals, backups, memory) — the installer never touches this directory. It only syncs `~/.claude/aleph/` (code) and `~/.claude/commands/` (commands).

### What gets overwritten

Everything else in `aleph/` is overwritten (hooks, skills, meta, README/INSTALL files, non-ALLCAPS files). This is intentional — infrastructure updates cleanly, user data survives.

For `settings.json`, only `hooks` and `statusLine` are replaced — permissions, model, and other settings are preserved. For `CLAUDE.md`, the `# Aleph` section is replaced in-place; any user content above or after it is preserved.

### Adding custom data files

To add a new preserved file, create it with an ALL CAPS name in either `identity/` or `memory/`:

```bash
# These will survive upgrades automatically:
~/.claude/aleph/core/identity/PROJECTS.md
~/.claude/aleph/memory/GOALS.md
~/.claude/aleph/memory/DECISIONS.md

# These will NOT survive (lowercase/mixed case):
~/.claude/aleph/memory/notes.md        # lowercase
~/.claude/aleph/memory/MyNotes.md      # mixed case
```

After upgrade completes, run `/install`. Pay special attention to the **Data** checks — they confirm preserved files were not lost or zeroed out.

## Development

| Command | Purpose |
|---------|---------|
| `/link` | Creates symlink `~/.claude/aleph → src/` for live dev — all code changes take effect immediately without reinstalling. A one-time sync of commands, settings, and CLAUDE.md is still needed (`bun install.ts --link-only`). |
| `bun dev-server.ts` | Starts the dev server at port 3001 with Vite HMR. Serves live from `src/`. Both dev and prod share data at `~/.aleph/`. |
| `bun install.ts` | Deploys to prod (port 3000 via systemd `aleph-ui.service`). Run `/install` to go back from a linked dev copy. |

Code installs to `~/.claude/aleph/` (overwritten on each install). User data lives at `~/.aleph/` (databases, sessions, signals, backups, memory) — the installer never touches this directory.

## Post-install Verification

Checks are defined in each module's `INSTALL.md`:

| Module | Checks | Detection |
|------|--------|-----------|
| aleph-core | `src/core/INSTALL.md` | `~/.claude/CLAUDE.md` exists |
| aleph-memory | `src/memory/INSTALL.md` | `~/.claude/aleph/memory/hooks/context-restore-start.ts` exists |
| aleph-skills | `src/skills/INSTALL.md` | `~/.claude/aleph/skills/skill-rules.json` exists |
| aleph-data | `src/data/INSTALL.md` | `~/.claude/aleph/data/src/client.ts` exists |
| aleph-telemetry | `src/telemetry/INSTALL.md` | `~/.claude/aleph/telemetry/src/index.ts` exists |
| aleph-eval | `src/eval/INSTALL.md` | `~/.claude/aleph/eval/runner.ts` exists |
| aleph-goals | `src/goals/INSTALL.md` | `~/.claude/aleph/goals/src/index.ts` exists |
| aleph-research | `src/research/INSTALL.md` | `~/.claude/aleph/research/src/index.ts` exists |
| aleph-ui | `src/ui/INSTALL.md` | `~/.claude/aleph/ui/api/src/app.ts` exists |

Each module's INSTALL.md defines three categories of checks:
- **Files** — expected files exist at the target
- **Data** — preserved files were not overwritten (non-empty, content predates install)
- **Functionality** — hooks exit 0 on trivial input, JSON is parseable, sections are present

A module is considered installed if its detection file exists. `/aleph install` runs checks only for installed modules.

Report format: `✓` pass, `✗` fail (ACTION REQUIRED), `⚠` warning (informational).

Running these checks is not optional. Do not mark installation as complete until every check for every installed module passes.
