# Example: /agent-review — hooks sub-surface only

## Invocation

```
/agent-review hooks
audit my hooks
are my hooks wired up
```

Narrows the walk to the hooks sub-surface when the user names it. Default scope is every hook script under `src/core/hooks/` against `src/rules/agent/hooks.md`. If the user names a specific hook ("audit git-hygiene-stop"), narrow further.

## What was checked

- Stdin JSON parse wrapped in try/catch with non-zero exit (A.1)
- `trace()` called before every exit path (B.1)
- Explicit `process.exit()` on all branches (C.1)
- Every `writeFileSync`/`reportHook` target has a grep-visible reader (E.1)
- Hook registration: all scripts in registry exist, no duplicate (event, matcher) pairs (G.1/G.2)
- No cross-registry double-fire (G.3)
- Usage signals: zero hits in `hook-events.jsonl` for established hooks → `unused-hook` (I.1)
- Writer fires but reader never does in same sessionId → `dead-output` (I.2)

## Sample output (abbreviated)

```
# Agent Review — hooks · diff (3 files)

## Summary
3 hooks audited · 3 live · 0 dead
Pairs: 2 typed · 1 untyped

## nit
src/memory/hooks/feedback-capture-submit.ts:39 — agent/hooks.md#B.1 — confidence 90 [sub_surface: hooks]
  No trace() before short-prompt early exit.
  [tag: observability] [approval: single]

## Hook detail
| Hook                    | Event            | Files written          | Consumed by      | trace() | Verdict |
|-------------------------|------------------|------------------------|------------------|---------|---------|
| feedback-capture-submit | UserPromptSubmit | signals/feedback.jsonl | consolidator.ts  | ✓       | LIVE    |
| rating-capture-submit   | UserPromptSubmit | signals/ratings.jsonl  | consolidator.ts  | ✓       | LIVE    |
| memory-extract-stop     | Stop             | (subprocess stdin)     | memory-writer.py | ✓       | LIVE    |
```
