# Example: /agent-review --sub-surface personas (fix flow)

## Invocation

```
/agent-review --sub-surface personas
```

Scans agent personas, presents findings, asks at the approval gate (per-finding for security-shaped tags), applies approved fixes inline, gates on frontmatter parse + cross-reference scan + `bun test`. One skill invocation, one continuous flow.

## Findings (presented at the approval gate)

```
## important (4)
- src/agents/codebase-auditor.md — agent/personas.md#over-privileged
  Edit, Write in tools: but description is read-only ("audit"). Fix: remove Edit, Write.
  [tag: over-privileged] [approval: single]
- src/agents/some-spawner.md — agent/personas.md#r1-violation
  Task in tools:. Subagents cannot spawn subagents. Fix: remove Task.
  [tag: r1-violation] [approval: single]
- src/agents/docs-optimizer.md:7 — agent/personas.md#cross-domain-drift
  References skill `docs-optimizer`; actual skill is `docs-optimize`. Fix: rename reference.
  [tag: cross-domain-drift] [approval: bulk]
- src/agents/code-debugger.md — agent/personas.md#description-quality
  Description missing negative scope. Fix: add when-NOT clause.
  [tag: description-quality] [approval: bulk]
```

## Approval gate

User answers. For this run:

- `over-privileged`, `r1-violation` (per-finding, security-shaped) → both approved.
- `cross-domain-drift`, `description-quality` (bulk) → approved.

## Apply

```
[applying]
- src/agents/codebase-auditor.md: Edit, Write removed from tools (over-privileged closed)
- src/agents/some-spawner.md: Task removed from tools (r1-violation closed)
- src/agents/docs-optimizer.md: skill reference corrected (cross-domain-drift closed)
- src/agents/code-debugger.md: description rewritten with when-NOT clause (description-quality closed)
- re-scan: zero remaining personas findings in scope
[/applying]
```

## Verify

```
[verify]
scope:      4 agent files
method:     frontmatter parse + agnix AGM-* lint
            + cross-reference scan (no stragglers for renamed refs)
            + re-scan of personas sub-surface
            + bun test
assertions: zero remaining personas findings in scope; frontmatter valid; no stale cross-references; full test suite passes
[/verify]
```

## Summary

- 4 personas findings resolved
- 4 agent files edited
- 0 file renames (only in-file changes)
- 0 findings skipped

**Per-finding approval pattern:** `over-privileged` and `r1-violation` (Task tool) tags required explicit approval before edit. Routing-collision rewrites would also require per-finding review of the auto-suggested rewrite text (none in this run).
