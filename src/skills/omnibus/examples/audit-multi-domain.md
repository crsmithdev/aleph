# Example: /audit code agent

## Invocation

```
/audit code agent
```

Runs `code-review` (mode: audit) and `agent-review` (mode: audit) in parallel (Phase 1), then a cross-domain consistency pass (Phase 1.5), then validation (Phase 2), then presents a merged phased report.

Note: `agent-review` covers what used to be four separate domains (config, hooks, skills, personas) in a single leaf pass. Intra-`agent` cross-references (e.g. persona referencing a skill) are first-class findings emitted directly by the leaf — Phase 1.5 only fires for drift that crosses outside the `agent` domain (e.g. a hook writer whose consumer is in `code`).

## What happened

**Phase 1 (parallel):** Two leaves returned SARIF runs. `agent-review` SARIF results tagged with `properties.sub_surface: config|hooks|skills|personas`.

**Phase 1.5 (cross-domain graph):** Built the agent → skill dispatch graph. Found a `docs-optimizer` reference inside `agent-review` results that no longer resolves; flagged as `dead-reference`.

**Phase 2 (validation):** Re-read cited lines to confirm. Dropped false positives. Adjusted confidences.

## Sample output (abbreviated)

```
# Omnibus audit — code · agent

## Summary
0 blocking · 2 important · 3 nit · 4 suggestion
Domains run: code, agent   Phase 1.5: cross-domain graph run

## important
[agent-review] src/agents/docs-optimizer.md:7 — agent/personas.md#G.1 — confidence 95
  Dead skill reference: hardcodes docs-optimizer, skill is docs-optimize.
  [tag: cross-domain-drift] [sub_surface: personas] [approval: single]

[agent-review] src/agents/codebase-auditor.md:8 — agent/personas.md#C.1 — confidence 90
  Edit+Write on read-only audit agent.
  [tag: over-privileged] [sub_surface: personas] [approval: per-finding]

## nit
[agent-review] src/memory/hooks/feedback-capture-submit.ts:39 — agent/hooks.md#B.1 — confidence 90
  No trace() before short-prompt exit.
  [tag: observability] [sub_surface: hooks] [approval: single]
```
