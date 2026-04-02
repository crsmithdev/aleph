# @construct/eval — Post-install Checks

All paths relative to `~/.claude/construct/eval/`. Run every check. Do not skip or summarize.

## Files

- `runner.ts` exists
- `scenarios/` directory exists with at least one scenario subdirectory
- Each scenario has `task.md`
- `scenarios/e2e-basic/server.ts` exists
- `scenarios/commit-sequence/task-1.md` and `task-2.md` exist

## Data

- `results/` directory may or may not exist (created on first eval run)
