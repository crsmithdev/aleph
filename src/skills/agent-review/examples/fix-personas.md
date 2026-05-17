# Example: /agent-review --mode fix --sub-surface personas

## Invocation

```
/fix agent --sub-surface personas
```

Applies edits derived from `agent-review` (audit) personas findings. Each finding's `properties.tag` routes to a fix shape from the Personas sub-surface table. Verifies with `gate("agents")` + frontmatter parse + cross-reference scan for renames + `gate("code")`.

## Plan

```
[plan]
src/agents/codebase-auditor.md
  - finding tagged over-privileged: PER-FINDING approval needed
  - decision: APPROVED. Remove Edit, Write from tools:; agent is read-only ("audit") per description
  - frontmatter tools list: [Read, Grep, Glob, Bash]

src/agents/some-spawner.md
  - finding tagged r1-violation: PER-FINDING approval needed
  - decision: APPROVED. Remove Task from tools:; subagents cannot spawn subagents

src/agents/docs-optimizer.md
  - finding tagged cross-domain-drift: body references skill `docs-optimizer` but actual skill is `docs-optimize`
  - decision: rename reference (skill exists; just the wrong name)
  - 7: `subagent_type: "docs-optimizer"` → `subagent_type: "docs-optimize"`

src/agents/code-debugger.md
  - finding tagged description-quality: missing negative scope
  - description rewrite from properties.fix applied
[/plan]
```

## Apply

```
[applying]
- src/agents/codebase-auditor.md: Edit, Write removed from tools (over-privileged closed)
- src/agents/some-spawner.md: Task removed from tools (R1 closed)
- src/agents/docs-optimizer.md: skill reference corrected (cross-domain-drift closed)
- src/agents/code-debugger.md: description rewritten with when-NOT clause (description-quality closed)
- re-audit: zero remaining personas findings in scope
[/applying]
```

## Verify

```
[verify]
scope:      4 agent files
method:     gate("agents") (frontmatter parse + agnix AGM-* green)
            + agent-review --mode audit --sub-surface personas --module <touched>
            + cross-reference scan (no stragglers for renamed refs)
            + gate("code")
assertions: zero remaining personas findings in scope; frontmatter valid; no stale cross-references; full test suite passes
[/verify]
```

## Summary

- 4 personas findings resolved
- 4 agent files edited
- 0 file renames (only in-file changes)
- 0 findings skipped

**Per-finding approval pattern:** `over-privileged` and `r1-violation` (Task tool) tags required explicit approval before edit. Routing-collision rewrites would also require per-finding review of the auto-suggested rewrite text (none in this run).
