---
name: construct
description: Construct management — subcommands: install, verify, grasp, status, retain, trace, audit
---

Route to the matching subcommand based on `$ARGUMENTS`:

## `install` (or no argument from project root with install.ts present)

Run the Construct installer to deploy this repo globally to ~/.claude.

Execute: `bun install.ts`

If the user passes `--dry-run`, prepend each destructive step with `echo "[dry-run]"` instead of executing.

After the script completes, run `/construct verify` to confirm the installation.

## `verify`

For each installed module, read its INSTALL.md and run every check listed there.
Do not skip or summarize checks. Run each one individually and report the exact result.

Module INSTALL.md locations and detection:
- `construct/core/INSTALL.md` — detected if `~/.claude/CLAUDE.md` exists
- `construct/memory/INSTALL.md` — detected if `construct/memory/hooks/session-start.ts` exists
- `construct/skills/INSTALL.md` — detected if `construct/skills/skill-rules.json` exists
- `construct/meta/INSTALL.md` — detected if `construct/meta/README.md` exists
- `construct/dashboard/INSTALL.md` — detected if `construct/dashboard/api/src/app.ts` exists

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

Execute: `bun construct/status.ts`

## `retain`

Review recent work and promote durable insights to semantic memory.

1. Show last 5 session summaries from memory/sessions/

3. Ask which insights to store in semantic memory
4. For each approved entry, call `memory_store` with appropriate tags and `memory_type`


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

## `audit`

Full project audit. Run these three skills in order, then print a combined summary.

1. Run the `code-review` skill (full scan of all `.ts` files under `construct/` and the installer)
2. Run the `instructions-review` skill
3. Run the `docs-review` skill (including spec completeness checks)

After all three, ask: "Fix the code and reference issues now? (Instructions and docs require your review first.)"

## No match

If `$ARGUMENTS` doesn't match a subcommand, print:
```
Usage: /construct <subcommand>
  install       Deploy repo to ~/.claude
  verify        Run post-install checks
  grasp         Surface project understanding
  status        Show system status
  retain        Promote insights to semantic memory
  trace         Toggle hook tracing (or trace <cmd> for one-shot)
  audit         Full project audit (code, refs, instructions, docs, spec, stats)
```
