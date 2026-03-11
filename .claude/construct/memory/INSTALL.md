# construct-memory — Post-install Verification

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/memory/CONTEXT.md` exists
- `construct/memory/LEARNED.md` exists
- `construct/memory/sessions/` directory exists
- `construct/memory/snapshots/` directory exists
- `construct/memory/signals/ratings.jsonl` exists
- Hook files exist: `session-start.ts`, `rating-capture.ts`, `sentiment-capture.ts`, `session-summary.ts` in `construct/memory/hooks/`
- `/construct retain` subcommand exists in `commands/construct.md`

## Data

- `LEARNED.md` is non-empty (0 bytes = data loss on upgrade)
- `CONTEXT.md` is non-empty (0 bytes = data loss on upgrade)
- `signals/ratings.jsonl` preserved (byte count >= pre-install, if upgrading)
- `MEMORY.md` preserved at `~/.claude/MEMORY.md` (if it existed before install)

## Functionality

- All 4 hooks exit 0 on `echo '{}' | bun <hook>`
- `rating-capture.ts` captures a rating: `echo '{"prompt":"7"}' | bun rating-capture.ts` appends to `ratings.jsonl`
- Hooks registered in `settings.json` (grep all hook commands for these substrings):
  - `memory/hooks/session-start.ts` under `SessionStart`
  - `memory/hooks/rating-capture.ts` under `UserPromptSubmit`
  - `memory/hooks/sentiment-capture.ts` under `Stop`
  - `memory/hooks/session-summary.ts` under `Stop`
- `CLAUDE.md` contains `## Memory Files` section
