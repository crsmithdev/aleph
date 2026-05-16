# Example: /hooks-audit (diff scope)

## Invocation

```
/hooks-audit
```

Default scope is smart: tries `--diff` against `origin/main` first, falls back to `--all` when diff is empty. Audits changed hook scripts against `src/rules/hooks/RULES.md`.

## What was checked

- Stdin JSON parse wrapped in try/catch with non-zero exit (A.1)
- `trace()` called before every exit path (B.1)
- Explicit `process.exit()` on all branches (C.1)
- Every `writeFileSync`/`reportHook` target has a grep-visible reader (E.1)
- Hook registration: all scripts in registry exist, no duplicate (event, matcher) pairs (G.1/G.2)
- Usage signals: zero hits in `hook-events.jsonl` for established hooks flagged as `unused-hook` (I.1)

## Sample output (abbreviated)

```
# Hooks Audit — diff (3 files)

## Summary
3 hooks audited · 3 live · 0 dead
Pairs: 2 typed · 1 untyped

## nit
src/memory/hooks/feedback-capture-submit.ts:39 — hooks/RULES.md#B.1 — confidence 90
  No trace() before short-prompt early exit.
  [tag: observability] [approval: single]

## Hook detail
| Hook                    | Event            | Files written       | Consumed by      | trace() | Verdict |
|-------------------------|------------------|---------------------|------------------|---------|---------|
| feedback-capture-submit | UserPromptSubmit | signals/feedback.jsonl | consolidator.ts | ✓ | LIVE |
| rating-capture-submit   | UserPromptSubmit | signals/ratings.jsonl  | consolidator.ts | ✓ | LIVE |
| memory-extract-stop     | Stop             | (subprocess stdin) | memory-writer.py | ✓ | LIVE |
```
