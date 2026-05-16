# Example: /audit agents hooks skills

## Invocation

```
/audit agents hooks skills
```

Runs `agents-audit`, `hooks-audit`, and `skills-audit` in parallel (Phase 1), then a cross-domain consistency pass (Phase 1.5), then validation (Phase 2), then presents a merged phased report.

## What happened

**Phase 1 (parallel):** Three leaves returned SARIF runs.

**Phase 1.5 (cross-domain graph):** Built dispatch graph — agents → skills they reference. Found `docs-optimizer` agent references a skill that no longer exists. Emitted `cross-domain-drift` finding.

**Phase 2 (validation):** Re-read cited lines to confirm. Dropped false positives (rating-capture-submit B.1 over-reported by leaf — all exits traced). Adjusted confidences.

## Sample output (abbreviated)

```
# Omnibus audit — agents · skills · hooks

## Summary
0 blocking · 2 important · 3 nit · 4 suggestion
Domains run: agents, hooks, skills   Phase 1.5: cross-domain graph run

## important
[agents-audit] src/agents/docs-optimizer.md:7 — agents/RULES.md#G.1 — confidence 95
  Dead skill reference: hardcodes docs-optimizer, skill is docs-optimize.
  [tag: cross-domain-drift] [source: cross-domain] [approval: single]

[agents-audit] src/agents/codebase-auditor.md:8 — agents/RULES.md#C.1 — confidence 90
  Edit+Write on read-only audit agent.
  [tag: over-privileged] [approval: per-finding]

## nit
[hooks-audit] src/memory/hooks/feedback-capture-submit.ts:39 — hooks/RULES.md#B.1 — confidence 90
  No trace() before short-prompt exit.
  [tag: observability] [approval: single]
```
