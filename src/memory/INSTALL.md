# construct-memory — Post-install Checks

All paths relative to `~/.claude/`. Run every check. Do not skip or summarize.

## Files

- `construct/memory/sessions/` directory exists
- `construct/memory/signals/ratings.jsonl` exists
- `construct/memory/parse-transcript.ts` exists
- Hook files exist: `session-start.ts`, `rating-capture.ts`, `session-summary.ts`, `memory-extract.ts` in `construct/memory/hooks/`
- `construct/memory/extract.ts` exists (extraction heuristics)
- `construct/memory/memory-writer.py` exists (semantic memory writer)

## Data

- `signals/ratings.jsonl` preserved (byte count >= pre-install, if upgrading)
- `construct/memory/sessions/` does NOT contain a nested `sessions/` subdirectory (installer bug symptom)

## Registration

- `memory/hooks/session-start.ts` registered under `SessionStart` in `settings.json`
- `memory/hooks/rating-capture.ts` registered under `UserPromptSubmit` in `settings.json`
- `memory/hooks/session-summary.ts` registered under `Stop` in `settings.json`
- `memory/hooks/memory-extract.ts` registered under `Stop` in `settings.json`
- `CLAUDE.md` contains `## Memory` section with `memory_store` and `memory_search` references

## Semantic memory (⚠ optional)

- `which memory` finds the `memory` binary
