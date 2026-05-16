# Example: /agents-audit --all

## Invocation

```
/agents-audit --all
```

Audits every agent file in `src/agents/` and `.claude/agents/` against `src/rules/agents/RULES.md`. Use `--all` when you want a full health check rather than just the diff.

## What was checked

- All 8 agent files in `src/agents/`
- Cross-domain consistency: skill references in agent bodies verified against `src/skills/`
- Trigger overlap: sibling agent descriptions compared for keyword collision
- Tool whitelist: read-only agents flagged for Edit/Write grants

## Sample output (abbreviated)

```
# Agents Audit — all

## Summary
8 agents audited · 1 dead skill reference · 1 over-privileged · 2 routing-collision pairs

## important
src/agents/docs-optimizer.md:7 — agents/RULES.md#G.1 — confidence 95
  Dead skill reference: body hardcodes `docs-optimizer` but skill is `docs-optimize`.
  [tag: cross-domain-drift] [approval: single]

src/agents/codebase-auditor.md:8 — agents/RULES.md#C.1 — confidence 90
  Edit+Write in tools list on read-only audit agent.
  [tag: over-privileged] [approval: per-finding]

## suggestion
src/agents/code-debugger.md:3 — agents/RULES.md#B.1 — confidence 80
  No negative scope ("Do NOT use when…"). Ambiguous vs code-review.
  [tag: description-quality] [approval: single]
```
