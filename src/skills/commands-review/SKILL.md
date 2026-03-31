---
name: commands-review
description: Reviews slash command definitions for clarity, completeness, and correct registration.
---

# Slash Commands Review

Slash commands are the user-facing interface to skills and automation. Unclear or broken commands erode trust.

## When to Use

- After adding or modifying command files in `dotclaude/commands/`
- When a slash command behaves unexpectedly
- Periodic audit of command quality

## Scope

All `.md` files in `dotclaude/commands/` (installed to `~/.claude/commands/`) and `.claude/commands/` (project-local commands loaded at runtime).

## Checks

**Clarity** — Would a user understand what this command does from the name and description alone? Is the name intuitive?

**Code over instructions** — If the command's behavior could be implemented in TypeScript (a hook, a script, an API call) rather than a prompt, it should be. Prompt-only commands are appropriate for judgment tasks; mechanical tasks belong in code. (Commandment 2: code over AI instructions, TypeScript over Bash.)

**Arguments** — If the command accepts arguments, are they documented? Are defaults sensible? Does `$ARGUMENTS` get parsed correctly?

**Behavior description** — Does the prompt accurately describe what the command will do? Would an agent follow it correctly with no other context?

**Duplication** — Does this command overlap with another command or a skill? Should they be merged? Commands must not shadow global slash commands. (Commandment 8: no duplication between layers.)

**References** — Does the command reference tools, files, MCP servers, or APIs that exist? Are referenced skills registered in skill-rules.json? (Commandment 1: nothing fails silently.)

**Source location** — Command source lives in `dotclaude/commands/`, not `.claude/commands/` (unless intentionally project-local). Commands install to `~/.claude/commands/` via merge. (Source in `dotclaude/`, never `.claude/` for shared commands.)

**Orphans** — No command files that aren't reachable via the slash command interface. No references to commands that don't exist. (Commandment 6: remove completely.)

<!-- PROJECT-SPECIFIC CRITERIA
Add your own checks below:

-
-
-
-->

## Process

1. List all command files in `dotclaude/commands/`
2. Read each fully
3. Run each check above
4. Cross-reference with skills — does any command duplicate a skill's trigger?

## Report

For each finding: command name, file, check category, issue, suggested fix.
Group by command. Sort by severity: broken references > code-over-instructions > unclear > duplicate > minor.

## Done when

- Every command file read and checked
- Cross-references verified
- Report produced
