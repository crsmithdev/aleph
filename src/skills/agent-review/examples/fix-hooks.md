# Example: /agent-review — hooks fix flow

## Invocation

```
/agent-review hooks
fix the hook findings
```

Scans hooks, presents findings, asks at the approval gate, applies approved fixes inline, gates on `bun test src/core/hooks` + JSON validity on both registries. One skill invocation, one continuous flow.

## Findings (presented at the approval gate)

```
## important (3)
- src/memory/hooks/feedback-capture-submit.ts:39 — agent/hooks.md#trace
  Missing trace() before process.exit(0). Fix: insert trace({ event, sessionId, reason }).
  [tag: missing-trace] [approval: bulk]
- src/core/hooks/dead-writer.ts:18 — agent/hooks.md#dead-output
  writeFileSync has no downstream consumer. Fix: remove the write block or wire a reader.
  [tag: dead-output] [approval: single]
- .claude/settings.json:14 — agent/hooks.md#double-fire
  Hook also registered in src/core/hooks/settings-hooks.json. Fix: remove from .claude/settings.json.
  [tag: double-fire] [approval: single]
```

## Approval gate

User answers. For this run:

- `missing-trace` (bulk) → approved.
- `dead-output` (per-finding) → approved REMOVE; no consumer planned.
- `double-fire` (per-finding) → approved.

## Apply

```
[applying]
- src/memory/hooks/feedback-capture-submit.ts: trace() inserted (missing-trace closed)
- src/core/hooks/dead-writer.ts: write block removed (dead-output closed)
- .claude/settings.json: duplicate hook entry removed (double-fire closed)
- re-scan: zero remaining findings in scope
[/applying]
```

## Verify

```
[verify]
scope:      3 hook files + 2 registries
method:     bun test src/core/hooks
            + JSON.parse(.claude/settings.json) + JSON.parse(src/core/hooks/settings-hooks.json)
            + re-scan of hooks sub-surface
assertions: zero remaining hooks findings in scope; hook tests pass; both registries valid JSON
[/verify]
```

## Summary

- 3 hooks findings resolved
- 3 files edited (2 hooks + 1 registry; 1 dedup in .claude/settings.json)
- 1 trace added; 1 dead-output removed; 1 double-fire resolved
- 0 findings skipped
