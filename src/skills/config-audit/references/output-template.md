# Config Audit — output templates

Reference for the structured output `config-audit` emits. Loaded on demand from `SKILL.md` step 7 and step 8.

## SARIF result shape

Single SARIF v2.1.0 run, `tool.driver.name = "config-audit"`. Each `result`:

```json
{
  "ruleId": "config/RULES.md#<section>.<n>" | "agnix/<rule-id>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete remediation — script path, registry entry, or `agnix --fix-safe` flag>",
    "tag": "dead-hook" | "dead-output" | "double-fire" | "silent-fail" | "broken-include" | "duplicate-rule" | "dead-skill" | "orphaned-skill" | "naming" | "routing-collision" | "dead-mcp" | "secret" | "overbroad-permission" | "agnix" | "agnix-autofix" | "observability",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

Praise rarely qualifies — surface hooks that exemplify defensive practice (try/catch around stdin parse with non-zero exit, full output→consumer chains, complete trace() calls) only when they could serve as a reference for peers in the same scope.

## Phased prose summary

After the SARIF block, output the phased report with table-rich detail:

```
# Config Audit — <project>

## Summary
agnix: N errors, N warnings (N auto-fixable)
Hooks: N live · N partial · N advisory · N dead · N broken
Skills: N valid · N missing files · N orphaned
CLAUDE.md refs: N broken
MCP: N dead, N with secrets in args
Permissions: N overbroad

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X)

## important (N)
- ...

## nit (N)
- ...

## Hook detail

| Hook | Event | stdout | stderr | Exit | Files written | Consumed by | Observability | Verdict |
|------|-------|--------|--------|------|---------------|-------------|---------------|---------|
| ... | ... | ... | ... | ... | ... | ... | ... | LIVE/PARTIAL/DEAD/ADVISORY/BROKEN |

### Hook pairs
| Writer | Reader | Shared file/signal | Handoff timing |
|--------|--------|---------------------|-----------------|
| ... | ... | ... | ... |

## Skills detail

| Skill | Registry | SKILL.md | Name match | Verdict |
|-------|----------|----------|------------|---------|
| ... | ✓/✗ | ✓/✗ | ✓/✗ | OK / orphaned / dead / mismatch |

## Pre-existing issues (out of scope)
- ...
```

## Final delivery template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Config Audit — <project>
<phased prose + detail tables>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report.

After presenting the prose report, prompt: *"Want me to apply the agnix auto-fixes (`agnix --fix-safe .`) or address any of these manually?"* — the user decides on autofix; this skill does not apply changes itself.
