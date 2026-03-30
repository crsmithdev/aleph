# Hooks

All hook scripts live in `src/skills/hooks/`. They are registered in `dotclaude/settings.json` and installed to `~/.claude/settings.json` via `bun install.ts`.

## Enforcement table

| Area | Hook | Event | Script | Fails | Skill | Description |
|---|---|---|---|---|---|---|
| Quality | quality-post-format | PostToolUse | `quality-post-format.ts` | Open | — | Runs formatters/linters after edits |
| Quality | quality-post-typecheck | PostToolUse | `quality-post-typecheck.ts` | Open | — | Runs `tsc --noEmit`, reports errors |
| Quality | quality-stop-check-e2e | Stop | `quality-stop-check-e2e.ts` | Open (writes marker) | verification | Writes marker when edits lack e2e evidence |
| Quality | quality-pre-require-e2e | PreToolUse | `quality-pre-require-e2e.ts` | Closed | verification | Blocks edits when e2e marker is present |
| Context | context-stop-monitor | Stop | `context-stop-monitor.ts` | Open | — | Warns at 80%/90% token usage |
| Context | context-precompact-backup | PreCompact | `context-precompact-backup.ts` | Open | — | Copies transcript before compaction |
| Isolation | isolation-pre-block-destructive-sql | PreToolUse | `isolation-pre-block-destructive-sql.ts` | Closed | — | Blocks destructive SQL |
| Isolation | isolation-pre-block-prod-edit | PreToolUse | `isolation-pre-block-prod-edit.ts` | Closed | — | Blocks edits to production from dev repo |
| Dispatch | dispatch-pre-require-subagent | PreToolUse | `dispatch-pre-require-subagent.ts` | Closed | build | Blocks inline edits in main session |
| Dispatch | dispatch-stop-remind | Stop | `dispatch-stop-remind.ts` | Open | build | Reminds "you're the orchestrator" every 5 turns |
| Git | git-pre-require-commit | PreToolUse | `git-pre-require-commit.ts` | Closed @15 | — | Warns at 8 dirty files, blocks at 15 |
| Notifications | notify-event-toast | Notification | `notify-event-toast.ts` | Open | — | Sends OS toast on idle/permission/complete |
| Routing | routing-submit-classify | UserPromptSubmit | `routing-submit-classify.ts` | Open | all | Classifies depth, matches skills, injects directives |

**Fails closed** = PreToolUse hook exits with code 2, blocking the tool call.
**Fails open** = hook prints advisory output but cannot prevent the action.

Only PreToolUse hooks can fail closed. All other hook events (Stop, PostToolUse, UserPromptSubmit, PreCompact, Notification) are informational — exit code 2 has no blocking effect.

## By area

### Quality — "Don't leave broken or unverified code"

**quality-post-format** runs formatters/linters after every Edit/Write based on file extension (prettier for TS/JS, ruff for Python, gofmt for Go, rustfmt for Rust) or project-level `.claude/quality.json` config. Auto-formats in place but cannot undo a write.

**quality-post-typecheck** runs `tsc --noEmit` after Edit/Write on TS/JS files, finding the nearest tsconfig.json. Reports up to 5 errors. Exit code 1 signals failure but doesn't block.

**quality-stop-check-e2e** fires on Stop and scans the current turn's transcript for edits, e2e signals (devserver/Playwright/Chrome DevTools), and artifacts (screenshots/saved output). If edits are present but evidence is missing, writes a marker file to signals. The marker is read by quality-pre-require-e2e on the next Edit/Write, which hard-blocks until verification evidence clears it.

**quality-pre-require-e2e** fires on PreToolUse for Edit/Write. Reads the `require-e2e` marker written by quality-stop-check-e2e. If present, hard-blocks (exit 2) until the marker is cleared by a subsequent turn with e2e evidence.

**Enforceability:** Strong for e2e (deferred hard block via marker). Moderate for typecheck (exit 1 but edit already happened).

### Context — "Don't run out of context silently"

**context-stop-monitor** fires on Stop and reads token usage from the transcript. Warns at 80% context usage, critical alert at 90%. Auto-detects 1M extended context.

**context-precompact-backup** fires on PreCompact and copies the transcript JSONL to a backup directory before Claude compacts the conversation.

**Enforceability:** None. Pure information and operational backup.

### Isolation — "Never write to production from the dev repo"

**isolation-pre-block-destructive-sql** fires on PreToolUse for SQL MCP tools (`execute_sql`, `apply_migration`, `run_query`). Blocks `DROP TABLE/DATABASE/SCHEMA`, `TRUNCATE`, `DELETE FROM` without WHERE, and `ALTER TABLE DROP COLUMN`.

**isolation-pre-block-prod-edit** fires on PreToolUse for Edit/Write. Resolves the target path and checks if it falls under `~/.claude/construct/`. If running from the dev repo (detected by presence of `install.ts`), blocks the edit.

**Enforceability:** Strong. Both are hard PreToolUse blocks.

### Dispatch — "Main session delegates, doesn't execute"

**dispatch-pre-require-subagent** fires on PreToolUse for Edit/Write. Blocks edits in the main session unless an inline override signal exists or the caller is a subagent (different session_id). The `/inline` skill creates the override signal to bypass this.

**dispatch-stop-remind** fires on Stop every 5 turns and prints a reminder that the main session is an orchestrator, not an executor.

**Enforceability:** Strong for edits. Weak for non-edit actions — Claude can still research and run commands inline.

### Git — "Commit frequently, don't accumulate drift"

**git-pre-require-commit** fires on PreToolUse for Edit/Write. Runs `git status --porcelain` and counts dirty files. Warns at 8 dirty files, hard-blocks at 15. Tracks state via a marker file in signals that clears after a successful commit.

**Enforceability:** Strong at the upper bound. The 8-file warning is advisory only.

### Notifications — "Alert the human"

**notify-event-toast** fires on Notification events. Sends OS-level toast notifications (PowerShell on WSL, osascript on macOS) for idle/permission/complete events. Falls back to terminal bell.

**Enforceability:** N/A — operational plumbing.

### Routing — "Use the right skill for the job"

**routing-submit-classify** fires on UserPromptSubmit. Classifies prompt depth (QUICK vs FULL), detects architectural keywords, matches prompt against `skill-rules.json`, writes directive signals for matched skills and dispatch mode, and injects the verification gate reminder for non-question prompts.

**Enforceability:** Weak. Advisory prompt injection that relies on Claude's compliance.

## Naming convention

Hook filenames follow the pattern: `{area}-{event}-{verb}.ts`

- **area**: quality, context, isolation, dispatch, git, notify, routing
- **event**: pre (PreToolUse), post (PostToolUse), stop, submit, precompact, event
- **verb**: what the hook functionally does (block-destructive-sql, require-commit, check-e2e, etc.)

For deferred enforcement (a non-PreToolUse hook writes a marker, a PreToolUse hook reads it and blocks), use `require-{condition}` for the reader and `check-{condition}` for the writer.

## Summary

5 hard gates (all PreToolUse), 8 open advisories. Hard enforcement covers e2e verification (deferred), edits in the main session, production path protection, destructive SQL, and commit discipline. Everything else relies on Claude's compliance.
