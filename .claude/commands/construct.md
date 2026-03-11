---
name: construct
description: Construct management — subcommands: install, verify, grasp, status, retain, trace
---

Route to the matching subcommand based on `$ARGUMENTS`:

## `install` (or no argument from project root with install.sh present)

Run the Construct installer to deploy this repo globally to ~/.claude.

Execute: `bash install.sh`

If the user passes `--dry-run`, prepend each destructive step with `echo "[dry-run]"` instead of executing.

After the script completes, run `/construct verify` to confirm the installation.

## `verify`

For each installed pack, read its INSTALL.md and run every check listed there.
Do not skip or summarize checks. Run each one individually and report the exact result.

Pack INSTALL.md locations and detection:
- `construct/core/INSTALL.md` — detected if `~/.claude/CLAUDE.md` exists
- `construct/memory/INSTALL.md` — detected if `construct/memory/CONTEXT.md` exists
- `construct/dev/INSTALL.md` — detected if `construct/dev/hooks/quality.ts` exists
- `construct/skills/INSTALL.md` — detected if `construct/skills/skill-rules.json` exists
- `construct/meta/INSTALL.md` — detected if `construct/meta/README.md` exists

Report format: ✓ pass, ✗ fail (ACTION REQUIRED), ⚠ warning (informational).
Group results by pack. Run Files, Data, and Functionality checks for each pack.

## `grasp`

Before any implementation, externalize your current model of this project.
State each item explicitly. Say "uncertain" rather than guessing.

**Commandments** — Read the `## Commandments` section from the project's CLAUDE.md. List each one verbatim. If there is no Commandments section, say so.

**Project identity** — What is this? What phase is it in?

**Stack** — Runtime, language, framework, DB/ORM, test tooling, package manager.

**Active work** — What was being worked on? Current ISC criteria if any?

**Key files** — Most important files for this task. Files NOT to touch without discussion.

**Conventions** — Naming, structure, patterns you're aware of. Anti-patterns you've been warned about.

**Uncertainties** — What are you NOT sure about? What assumptions could be wrong?

After producing this summary, ask: "Is any of this wrong or out of date?"

## `status`

Collect and display:

**Context**
- Which identity files are present in `construct/core/identity/`
- Which skills are active (list from `construct/skills/`)
- Active project and current focus from `memory/CONTEXT.md`

**Memory**
- Session signals — explicit + implicit rating count, rolling average from `ratings.jsonl`
- Recent sessions — last 5 entries from `memory/sessions/`
- `memory/LEARNED.md` — High Confidence section + last 5 Active entries
- `MEMORY.md` tail — last 5 entries (candidates for promotion)
- Memory size — session count, ratings count, snapshot count
- Unresolved snapshots in `memory/snapshots/`

## `retain`

If construct-memory is not installed, say: "construct-memory is not installed — /construct retain requires session summaries and LEARNED.md. Run /construct verify to check what's installed."
Otherwise:
1. Show last 5 session summaries from memory/sessions/
2. Show last 10 entries from MEMORY.md
3. Ask which insights to promote to memory/LEARNED.md
4. For each approved entry:
   - Seen before (3+ sessions): -> ## High Confidence, **bold** prefix
   - New: -> ## Active, today's date
5. Flag ## Active entries >90 days old as pruning candidates
6. Confirm additions and flags

## `trace` (no additional arguments)

Toggle hook tracing. The trace flag is the file `~/.claude/construct/.trace`.

1. Check if `~/.claude/construct/.trace` exists
2. If it exists: delete it, print `Trace: OFF`
3. If it doesn't exist: create it (empty file), print `Trace: ON`

## `trace <command> [args]` (with additional arguments)

Run a single command with tracing enabled, then restore previous state.

1. Check if `~/.claude/construct/.trace` already exists (remember this as `was_on`)
2. If not already on: create `~/.claude/construct/.trace`
3. Print `Trace: ON (one-shot)`
4. Run the command specified by the remaining arguments (e.g., `/construct trace status` runs `/construct status`)
5. If `was_on` is false: delete `~/.claude/construct/.trace`, print `Trace: OFF`

## No match

If `$ARGUMENTS` doesn't match a subcommand, print:
```
Usage: /construct <subcommand>
  install    Deploy repo to ~/.claude
  verify     Run post-install checks
  grasp      Surface project understanding
  status     Show system status
  retain     Promote insights to LEARNED.md
  trace      Toggle hook tracing (or trace <cmd> for one-shot)
```
