# Installation

## MANDATORY: Read This Completely

After installing or upgrading, you MUST run the post-install verification checks defined in each pack's `README.md`. Do not skip checks. Do not summarize checks. Run every single one and report the result.

When copying files during installation, copy them exactly. Do not summarize, truncate, or paraphrase file contents. Every file must arrive at the target byte-for-byte identical to the source.

## Prerequisites

- `jq` (for settings.json merging)
- `bun` (TypeScript runtime for hooks)

## New Install

```bash
git clone <repo-url> ~/Construct
cd ~/Construct
bash install.sh
```

The installer:
1. Creates `~/.claude/construct/` and syncs the full tree
2. Copies slash commands to `~/.claude/commands/`
3. Creates `~/.claude/settings.json` with hooks and statusline
4. Creates `~/.claude/CLAUDE.md` with the Construct section

After install completes, run `/construct verify` in Claude Code. It reads each pack's `INSTALL.md` and executes the Post-install Verification checks listed there. Every check must pass.

## Upgrade (reinstall)

```bash
cd ~/Construct
git pull
bash install.sh
```

### What gets preserved

The installer automatically discovers and preserves any ALL CAPS `.md` file (filename matches `[A-Z_]+.md`) in two directories:

- `construct/core/identity/` — e.g. `SOUL.md`, `IDENTITY.md`, `STYLE.md`, `USER.md`, `BOOTSTRAP.md`, plus any custom files you add (e.g. `PROJECTS.md`, `WORKFLOW.md`)
- `construct/memory/` — e.g. `LEARNED.md`, `CONTEXT.md`, plus any custom files you add (e.g. `GOALS.md`, `DECISIONS.md`)

Also preserved:
- `memory/signals/ratings.jsonl` — rating history
- `memory/sessions/` — session summaries
- `memory/snapshots/` — mental model snapshots
- `~/.claude/MEMORY.md` — Claude's working notes

### What gets overwritten

Everything else in `construct/` is overwritten (hooks, skills, meta, dev, README/INSTALL files, non-ALLCAPS files). This is intentional — infrastructure updates cleanly, user data survives.

For `settings.json`, only `hooks` and `statusLine` are replaced — permissions, model, and other settings are preserved. For `CLAUDE.md`, the `# Construct` section is replaced in-place; any user content above it is preserved.

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

After upgrade completes, run `/construct verify`. Pay special attention to the **Data** checks — they confirm preserved files were not lost or zeroed out.

## Post-install Verification

Checks are defined in each pack's `README.md`:

| Pack | Checks | Detection |
|------|--------|-----------|
| construct-core | `.claude/construct/core/INSTALL.md` | `~/.claude/CLAUDE.md` exists |
| construct-memory | `.claude/construct/memory/INSTALL.md` | `construct/memory/CONTEXT.md` exists |
| construct-dev | `.claude/construct/dev/INSTALL.md` | `construct/dev/hooks/quality.ts` exists |
| construct-skills | `.claude/construct/skills/INSTALL.md` | `construct/skills/skill-rules.json` exists |
| construct-meta | `.claude/construct/meta/INSTALL.md` | `construct/meta/README.md` exists |

Each pack's INSTALL.md defines three categories of checks:
- **Files** — expected files exist at the target
- **Data** — preserved files were not overwritten (non-empty, content predates install)
- **Functionality** — hooks exit 0 on trivial input, JSON is parseable, sections are present

A pack is considered installed if its detection file exists. `/construct verify` runs checks only for installed packs.

Report format: `✓` pass, `✗` fail (ACTION REQUIRED), `⚠` warning (informational).

Running these checks is not optional. Do not mark installation as complete until every check for every installed pack passes.
