# Installation

## MANDATORY: Read This Completely

After installing or upgrading, you MUST run the post-install verification checks defined in each module's `INSTALL.md`. Do not skip checks. Do not summarize checks. Run every single one and report the result.

When copying files during installation, copy them exactly. Do not summarize, truncate, or paraphrase file contents. Every file must arrive at the target byte-for-byte identical to the source.

## Prerequisites

- `bun` (TypeScript runtime for hooks and installer)

## New Install

```bash
git clone <repo-url> ~/construct
cd ~/construct
bun install.ts
```

The installer:
1. Syncs `src/` tree to `~/.claude/construct/`
2. Copies `dotclaude/commands/` to `~/.claude/commands/`
3. Merges `dotclaude/settings.json` into `~/.claude/settings.json` (hooks and statusline)
4. Updates `~/.claude/CLAUDE.md` with the Construct section from `dotclaude/CLAUDE.md`

After install completes, run `/install` in Claude Code. It runs the installer and then automatically reads each module's `INSTALL.md` and executes the Post-install Verification checks listed there. Every check must pass.

## Upgrade (reinstall)

```bash
cd ~/construct
git pull
bun install.ts
```

### What gets preserved

The installer automatically discovers and preserves any ALL CAPS `.md` file (filename matches `[A-Z_]+.md`) in two directories:

- `construct/core/identity/` — e.g. `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, plus any custom files you add (e.g. `PROJECTS.md`, `WORKFLOW.md`)
- `construct/memory/` — any custom ALL CAPS `.md` files you add (e.g. `GOALS.md`, `DECISIONS.md`)

All data under `~/.claude/data/` (databases, sessions, signals, backups) is preserved automatically — the installer never touches this directory. It only syncs `~/.claude/construct/` (code) and `~/.claude/commands/` (commands).


### What gets overwritten

Everything else in `construct/` is overwritten (hooks, skills, meta, README/INSTALL files, non-ALLCAPS files). This is intentional — infrastructure updates cleanly, user data survives.

For `settings.json`, only `hooks` and `statusLine` are replaced — permissions, model, and other settings are preserved. For `CLAUDE.md`, the `# Construct` section is replaced in-place; any user content above or after it is preserved.

### Adding custom data files

To add a new preserved file, create it with an ALL CAPS name in either `identity/` or `memory/`:

```bash
# These will survive upgrades automatically:
~/.claude/construct/core/identity/PROJECTS.md
~/.claude/construct/memory/GOALS.md
~/.claude/construct/memory/DECISIONS.md

# These will NOT survive (lowercase/mixed case):
~/.claude/construct/memory/notes.md        # lowercase
~/.claude/construct/memory/MyNotes.md      # mixed case
```

After upgrade completes, run `/install`. Pay special attention to the **Data** checks — they confirm preserved files were not lost or zeroed out.

## Post-install Verification

Checks are defined in each module's `INSTALL.md`:

| Module | Checks | Detection |
|------|--------|-----------|
| construct-core | `src/core/INSTALL.md` | `~/.claude/CLAUDE.md` exists |
| construct-memory | `src/memory/INSTALL.md` | `src/memory/hooks/session-start.ts` exists |
| construct-skills | `src/skills/INSTALL.md` | `src/skills/skill-rules.json` exists |
| construct-data | `src/data/INSTALL.md` | `src/data/src/client.ts` exists |
| construct-eval | `src/eval/INSTALL.md` | `src/eval/runner.ts` exists |
| construct-goals | `src/goals/INSTALL.md` | `src/goals/src/index.ts` exists |
| construct-ui | `src/ui/INSTALL.md` | `src/ui/api/src/app.ts` exists |

Each module's INSTALL.md defines three categories of checks:
- **Files** — expected files exist at the target
- **Data** — preserved files were not overwritten (non-empty, content predates install)
- **Functionality** — hooks exit 0 on trivial input, JSON is parseable, sections are present

A module is considered installed if its detection file exists. `/construct install` runs checks only for installed modules.

Report format: `✓` pass, `✗` fail (ACTION REQUIRED), `⚠` warning (informational).

Running these checks is not optional. Do not mark installation as complete until every check for every installed module passes.
