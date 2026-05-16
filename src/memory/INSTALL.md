# construct-memory — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/memory/sessions/` directory exists
- `construct/memory/signals/ratings.jsonl` exists
- `construct/memory/parse-transcript.ts` exists
- Hook files exist: `context-restore-start.ts`, `rating-capture-submit.ts`, `context-save-stop.ts`, `memory-extract-stop.ts` in `construct/memory/hooks/`
- `construct/memory/extract.ts` exists (extraction heuristics)
- `construct/memory/memory-writer.py` exists (semantic memory writer)

## Data

- `signals/ratings.jsonl` preserved (byte count >= pre-install, if upgrading)
- `construct/memory/sessions/` does NOT contain a nested `sessions/` subdirectory (installer bug symptom)

## Registration

- `memory/hooks/context-restore-start.ts` registered under `SessionStart` in `settings.json`
- `memory/hooks/rating-capture-submit.ts` registered under `UserPromptSubmit` in `settings.json`
- `memory/hooks/feedback-capture-submit.ts` registered under `UserPromptSubmit` in `settings.json`
- `memory/hooks/context-save-stop.ts` registered under `Stop` in `settings.json`
- `memory/hooks/memory-extract-stop.ts` registered under `Stop` in `settings.json`
- `memory/hooks/memory-consolidate-stop.ts` registered under `Stop` in `settings.json`
- `memory/hooks/signal-capture-posttooluse.ts` registered under `PostToolUse` in `settings.json`
- `construct/core/CLAUDE.md` contains `## Memory` section with `memory_store` and `memory_search` references

## Semantic memory (⚠ optional)

- `which memory` finds the `memory` binary
