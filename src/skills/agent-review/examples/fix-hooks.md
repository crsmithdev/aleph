# Example: /agent-review --mode fix --sub-surface hooks

## Invocation

```
/fix agent --sub-surface hooks
```

Or, with a saved SARIF report:

```
/agent-review --mode fix --findings tmp/audit.sarif --sub-surface hooks
```

Applies edits derived from `agent-review` (audit) hooks findings. Each finding's `properties.tag` routes to a fix shape from the Hooks sub-surface table. Verifies with `gate("hooks")` + re-audit + `gate("code")` + JSON validity on both registries.

## Plan

```
[plan]
src/memory/hooks/feedback-capture-submit.ts
  39: insert trace({ event: "feedback-capture-submit", sessionId, reason: "short-prompt" })
  41: insert before process.exit(0)

src/core/hooks/dead-writer.ts
  - finding tagged dead-output: PER-FINDING approval needed
  - decision: REMOVE the writeFileSync (no consumer planned)
  - 18-22: delete write block; no other readers

src/core/hooks/settings-hooks.json
  - finding tagged double-fire (also in .claude/settings.json:14)
  - decision: remove from .claude/settings.json (keep in src/)
[/plan]
```

## Apply

```
[applying]
- src/memory/hooks/feedback-capture-submit.ts: trace() inserted (observability finding closed)
- src/core/hooks/dead-writer.ts: write block removed (dead-output finding closed)
- .claude/settings.json: duplicate hook entry removed (double-fire finding closed)
- re-audit: zero remaining findings in scope
[/applying]
```

## Verify

```
[verify]
scope:      3 hook files + 2 registries
method:     gate("hooks") + agent-review --mode audit --sub-surface hooks --module <touched>
            + gate("code") + JSON.parse(.claude/settings.json) + JSON.parse(src/core/hooks/settings-hooks.json)
assertions: zero remaining hooks findings in scope; hook tests pass; full test suite passes; both registries valid JSON
[/verify]
```

## Summary

- 3 hooks findings resolved
- 3 files edited (2 hooks + 1 registry; 1 dedup in .claude/settings.json)
- 1 trace added; 1 dead-output removed; 1 double-fire resolved
- 0 findings skipped
