---
name: construct
description: Construct management — subcommands: install, verify, grasp, status, retain, trace, audit, link, unlink
---

Route to the matching subcommand based on `$ARGUMENTS`:

## No arguments

List the custom slash commands installed by Construct. Read the `.md` files in `~/.claude/commands/` and print each one with its description (from the frontmatter `description` field):

```
Construct commands:
  /construct    <description>
  /goal         <description>
  /todo         <description>
```

Use the actual descriptions from the frontmatter of each file. Pad command names to align descriptions.

## `install`

Run the Construct installer to deploy this repo globally to ~/.claude.

Execute: `bun install.ts`

If the user passes `--dry-run`, prepend each destructive step with `echo "[dry-run]"` instead of executing.

After the script completes, run `/construct verify` to confirm the installation.

## `verify`

For each installed module, read its INSTALL.md and run every check listed there.
Do not skip or summarize checks. Run each one individually and report the exact result.

Module INSTALL.md locations and detection:
- `src/core/INSTALL.md` — detected if `~/.claude/CLAUDE.md` exists
- `src/memory/INSTALL.md` — detected if `src/memory/hooks/session-start.ts` exists
- `src/skills/INSTALL.md` — detected if `src/skills/skill-rules.json` exists
- `src/meta/INSTALL.md` — detected if `src/meta/README.md` exists
- `src/dashboard/INSTALL.md` — detected if `src/dashboard/api/src/app.ts` exists

Report format: ✓ pass, ✗ fail (ACTION REQUIRED), ⚠ warning (informational).
Group results by module. Run Files, Data, and Verification checks for each module.

## `grasp`

Before any implementation, externalize your current model of this project.
State each item explicitly. Say "uncertain" rather than guessing.

**Commandments** — Read the `## Commandments` section from the project's CLAUDE.md (check both project root and `.claude/CLAUDE.md`). List each one verbatim. If there is no Commandments section, say so.

**Project identity** — What is this? What phase is it in?

**Stack** — Runtime, language, framework, DB/ORM, test tooling, package manager.

**Active work** — What was being worked on? Current ISC criteria if any?

**Key files** — Most important files for this task. Files NOT to touch without discussion.

**Conventions** — Naming, structure, patterns you're aware of. Anti-patterns you've been warned about.

**Uncertainties** — What are you NOT sure about? What assumptions could be wrong?

After producing this summary, ask: "Is any of this wrong or out of date?"

## `status`

Execute: `bun src/status.ts`

## `retain`

Review recent work and promote durable insights to semantic memory.

1. Show last 5 session summaries from `~/.claude/construct/memory/sessions/`
2. Ask which insights to store in semantic memory
3. For each approved entry, call `memory_store` with appropriate tags and `memory_type`


## `trace` (no additional arguments)

Toggle hook tracing.

Execute: `bun src/trace-toggle.ts`

## `trace <command> [args]` (with additional arguments)

One-shot trace: enable tracing, run the command, then restore previous state.

1. Run `bun src/trace-toggle.ts` (captures current state and toggles)
2. If output was "Trace: ON", run the command specified by the remaining arguments
3. Run `bun src/trace-toggle.ts` to restore previous state
4. If output was "Trace: already ON", just run the command (tracing was already on, no toggle needed)

## `audit`

Full project audit. Run these three skills in order, then print a combined summary.

1. Run the `code-review` skill (full scan of all `.ts` files under `src/` and the installer)
2. Run the `instructions-review` skill
3. Run the `docs-review` skill

After all three, ask: "Fix the code and reference issues now? (Instructions and docs require your review first.)"

## `link`

**Dev-only.** Symlinks `~/.claude/construct/` to the repo's `src/` directory so source edits are immediately live at runtime. Must be run from the Construct repo root.

1. Check that `src/` exists in the current working directory. If not, print "Run this from the Construct repo root." and stop.
2. Check if `~/.claude/construct` is already a symlink. If so, print "Already linked → <target>" and stop.
3. If `~/.claude/construct/` exists as a regular directory, back it up: `mv ~/.claude/construct ~/.claude/construct.bak`
4. Create symlink: `ln -s <repo>/src ~/.claude/construct`
5. **Migrate data:** If `~/.claude/construct.bak/data/construct.db` exists, checkpoint its WAL and copy it (and signals/, sessions/) into `<repo>/src/data/` — but only if the destination DB is empty or missing. This prevents data loss when switching to linked mode. Use `PRAGMA wal_checkpoint(TRUNCATE)` before copying. Also copy `memory/signals/ratings.jsonl` and `memory/sessions/` if they exist in the backup.
6. Run the dotclaude merge steps only (settings.json merge + CLAUDE.md update + commands sync): `bun install.ts`
7. Print "Linked: ~/.claude/construct → <repo>/src"
8. Print "Note: run `/construct install` to return to copy mode."

## `unlink`

Removes the dev symlink and does a full install.

1. Check if `~/.claude/construct` is a symlink. If not, print "Not linked." and stop.
2. Remove the symlink: `rm ~/.claude/construct`
3. If `~/.claude/construct.bak` exists, restore it: `mv ~/.claude/construct.bak ~/.claude/construct`
4. Run a full install: `bun install.ts`
5. Print "Unlinked. Full install completed."

## No match

If `$ARGUMENTS` doesn't match a subcommand, print:
```
Unknown subcommand: <what they typed>

Usage: /construct <subcommand>
  (no args)     List installed Construct commands
  install       Deploy repo to ~/.claude
  verify        Run post-install checks
  grasp         Surface project understanding
  status        Show system status
  retain        Promote insights to semantic memory
  trace         Toggle hook tracing (or trace <cmd> for one-shot)
  audit         Full project audit (code, refs, instructions, docs, spec)
  link          Symlink source for dev (repo root only)
  unlink        Remove symlink, full install
```
