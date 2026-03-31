---
name: hooks-review
description: Reviews Claude Code hook scripts for correctness, safety, and alignment with settings.json registration.
---

# Hooks Review

Hook scripts run automatically on Claude Code events. A broken hook fails silently, blocks execution, or produces wrong behavior.

## When to Use

- After adding or modifying hook scripts in `src/skills/hooks/`
- After changing hook registration in settings.json
- When hooks seem to not fire or produce unexpected output

## Scope

All `.ts`/`.js`/`.sh` files registered as hooks in settings.json, plus settings.json hook entries themselves.

## Checks

**Registration vs implementation** — Every hook in settings.json points to a file that exists. Every hook file is registered in settings.json. Event types (PreToolUse, PostToolUse, Stop, etc.) match what the script expects.

**TypeScript over Bash** — Hooks should be TypeScript (`.ts`) not shell scripts. If a hook is Bash, flag it — can this be rewritten in TypeScript? (Code over AI instructions; TypeScript over Bash.)

**No silent failures** — Hook must not swallow errors. Stderr should be captured. Non-zero exit codes must be intentional, not accidental crashes. JSON parse failures must be handled. (Nothing fails silently.)

**Input/output contract** — Hook reads stdin JSON correctly. Exit codes are intentional (0 = pass, 2 = block for PreToolUse). Stdout output is meaningful and concise.

**Safety** — No destructive operations without guards. No infinite loops or unbounded waits. Timeout-safe (hooks have a 60s default timeout).

**Idempotency** — Hook produces the same result if fired twice. No append-only side effects that compound.

**Source location** — Hook source lives in `src/skills/hooks/`, not in `.claude/` or `dotclaude/`. Hooks are installed to `~/.claude/` via `bun install.ts`. (Commandment 9: source in `src/`, never `.claude/`.)

**No duplication across layers** — The same hook must not exist in both `.claude/settings.json` and `dotclaude/settings.json`. If it does, it fires twice. `.claude/settings.json` may only contain permissions, statusline, and MCP config — never hooks.

**Orphans** — No hook scripts in `src/skills/hooks/` that aren't registered anywhere. No registered paths pointing to missing files. (Commandment 6: remove completely.)

<!-- PROJECT-SPECIFIC CRITERIA
Add your own checks below:

-
-
-
-->

## Process

1. Read settings.json hook entries — build map of event → command → file
2. Read each hook script fully
3. Run each check above per hook
4. Cross-reference: orphaned scripts not in settings? Registered paths that don't exist?

## Report

For each finding: hook name, file, check category, issue, suggested fix.
Group by hook. Sort by severity: missing/broken > silent failure > safety > contract > idempotency > style.

## Done when

- Every registered hook file read and checked
- Settings.json ↔ filesystem consistency verified
- Report produced
