# Agent Review — output templates

Reference for the structured output `agent-review` emits. Loaded on demand from `SKILL.md` "Output" section.

## SARIF result shape

Single SARIF v2.1.0 run, `tool.driver.name = "agent-review"`. Each `result`:

```json
{
  "ruleId": "agent/<sub_surface>.md#<section>.<n>" | "agnix/<rule-id>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete remediation — script path, registry entry, or `agnix --fix-safe` flag>",
    "tag": "<one of the tag values below>",
    "sub_surface": "config" | "hooks" | "skills" | "personas",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

### Tag values per sub-surface

**config:** `broken-include`, `duplicate-rule`, `double-fire`, `dead-mcp`, `secret`, `overbroad-permission`, `agnix-autofix`

**hooks:** `silent-fail`, `observability`, `correctness`, `slop`, `dead-output`, `pii`, `pair-contract`, `dead-hook`, `double-fire`, `unused-hook`

**skills:** `frontmatter`, `naming`, `correctness`, `description-quality`, `orphaned-skill`, `routing-collision`, `slop`, `examples`, `r1-violation`, `r2-violation`, `r4-violation`, `trigger-drift`, `trigger-stale`, `slash-only`, `missed-trigger`, `over-broad-trigger`, `unused-skill`, `dead-reference`

**personas:** `frontmatter`, `naming`, `stale-model`, `description-quality`, `over-privileged`, `r1-violation`, `routing-collision`, `contract-drift`, `agent-drift`, `statelessness`, `cross-domain-drift`, `unused-agent`

**Cross-cutting:** `agnix`, `agnix-autofix`, `defense-in-depth` (praise).

## Praise candidates

Praise rarely qualifies — surface only when the entry could serve as a reference for peers in the same scope:

- **hooks:** try/catch around stdin parse with non-zero exit, full output→consumer chains, complete `trace()` calls.
- **skills:** slim SKILL.md, scoped, cite RULES.md, pure leaf, well-named, registry entry matches trigger phrases.
- **personas:** explicit "when to use" + "when NOT to use", minimal tool whitelist, stated output contract.
- **config:** clean CLAUDE.md `@`-include graph with no broken refs and no duplicates.

Mark `severity: praise`, `tag: defense-in-depth`, with a `fix` like "use as reference for: <pattern-name>".

## Phased prose summary

After the SARIF block:

```
# Agent Review — <scope>

## Summary
agnix: N errors, N warnings (N auto-fixable)
Config: N CLAUDE.md refs broken · N duplicate rules · N MCP issues · N overbroad permissions
Hooks: N live · N partial · N dead · N broken · pairs: N typed / N untyped
Skills: N orphaned · N missing examples · N over-length · keyword collisions: N · R1: N · R4: N
  Trigger health: N stale · N slash-only · N missed · N over-broad
Personas: N missing frontmatter · N over-privileged · N routing-collision pairs · N cross-domain-drift · N unused

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X) [sub_surface: <s>]

## important (N)
- ...

## nit (N)
- ...

## Config detail
| File | @-includes | Cycles | Duplicates | Verdict |
|------|-----------|--------|------------|---------|

## Hook detail
| Hook | Event | stdout | stderr | Exit | Files written | Consumed by | trace() | Verdict |
|------|-------|--------|--------|------|---------------|-------------|---------|---------|

### Hook pairs
| Writer | Reader | Shared file/signal | Handoff timing | Typed? |
|--------|--------|---------------------|----------------|--------|

## Skills detail
| Skill | Frontmatter | Registry | Name match | Length | Examples | R1 | Verdict |
|-------|-------------|----------|------------|--------|----------|----|---------|

### Trigger Health — <N> messages sampled
| Skill | Slash-only | NL-matched | Missed | Verdict |
|-------|-----------|------------|--------|---------|

## Persona detail
| Agent | Name match | Model | Tools | Scope | When-NOT | Verdict |
|-------|-----------|-------|-------|-------|---------|---------|

### Routing-collision pairs (require disambiguation)
| Agent A | Agent B | Overlap | Suggested |

## Pre-existing issues (out of scope)
- ...
```

After the prose: *"Want me to apply agnix auto-fixes (`agnix --fix-safe .`) or address any of these manually?"*

## Final delivery template (audit)

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Agent Review — <scope>
<phased prose + detail tables>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report (if it dispatched multiple review leaves in parallel).

## Final delivery template (fix)

```
[plan]
... edit list, grouped by sub_surface then file ...
[/plan]

[applying]
... per-edit lines, including per-finding re-check ...
[/applying]

[verify]
scope:      <files edited, grouped by sub_surface>
method:     gate("hooks") + gate("skills") + gate("agents") + gate("code") (per touched sub-surface)
            + agent-review --mode audit --sub-surface <s> --module <touched>
            + JSON.parse on touched registries + grep Skill( + agnix --dry-run
assertions: zero remaining agent-review findings in scope (per sub-surface); all gates green; registries valid JSON
[/verify]

# Summary
- <N> findings resolved (per sub-surface)
- <M> files edited
- <K> findings skipped (with reasons)
```
