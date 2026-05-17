# Example: /agent-review --sub-surface personas (--all)

## Invocation

```
/agent-review --sub-surface personas --all
```

Limits the walk to subagent definitions in `src/agents/` and `.claude/agents/`. Use `--all` when you want a full health check rather than just the diff. Resolves cross-domain references against `src/skills/` (G.1).

## What was checked

- All 8 agent files in `src/agents/`
- Frontmatter, name-matches-file, model freshness (A.1-A.3)
- Description has when-to + when-NOT + output contract (B.1, B.2)
- Tool whitelist: read-only agents flagged for Edit/Write grants (C.1)
- No `Task` in `tools:` (C.2 — R1 applied to agents)
- Trigger overlap: sibling agent descriptions compared for noun-phrase collision (D.1)
- Statelessness: body free of "as we discussed" / "earlier" (F.1)
- Cross-domain consistency: every `subagent_type:` and skill reference in body resolves against `src/skills/` (G.1)
- Stale-after-skill-change suggestions: recently-changed referenced skills flag the agent for review (G.2)
- Unused-agent: agents nobody dispatches in > 30 days (G.3)

## Sample output (abbreviated)

```
# Agent Review — personas · all

## Summary
8 agents audited · 1 dead skill reference · 1 over-privileged · 2 routing-collision pairs

## important
src/agents/docs-optimizer.md:7 — agent/personas.md#G.1 — confidence 95 [sub_surface: personas]
  Dead skill reference: body hardcodes `docs-optimizer` but skill is `docs-optimize`.
  [tag: cross-domain-drift] [approval: single]

src/agents/codebase-auditor.md:8 — agent/personas.md#C.1 — confidence 90 [sub_surface: personas]
  Edit+Write in tools list on read-only audit agent.
  [tag: over-privileged] [approval: per-finding]

## suggestion
src/agents/code-debugger.md:3 — agent/personas.md#B.1 — confidence 80 [sub_surface: personas]
  No negative scope ("Do NOT use when…"). Ambiguous vs code-review.
  [tag: description-quality] [approval: single]

## Persona detail
| Agent             | Name match | Model  | Tools    | Scope  | When-NOT | Verdict      |
|-------------------|------------|--------|----------|--------|----------|--------------|
| codebase-auditor  | ✓          | sonnet | over-priv| clear  | ✓        | over-priv    |
| docs-optimizer    | ✓          | sonnet | minimal  | clear  | ✓        | dead skill ref |
| code-debugger     | ✓          | sonnet | minimal  | vague  | ✗        | description  |
```
