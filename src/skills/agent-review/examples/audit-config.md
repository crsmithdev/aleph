# Example: /agent-review --sub-surface config

## Invocation

```
/agent-review --sub-surface config
```

Limits the walk to the config sub-surface: CLAUDE.md `@`-include graph, `.claude/settings.json` MCP servers and permissions, statusline config. Other sub-surfaces are skipped. agnix structural lint passthrough runs first.

## What was checked

- Every `@`-prefixed include in every CLAUDE.md file resolves (§A.1)
- Include graph has no cycles (§A.2)
- No duplicate rule content across CLAUDE.md layers (§A.3)
- Hook commands appear in at most one of `.claude/settings.json` / `src/core/hooks/settings-hooks.json` (§B.2)
- Every `mcpServers.<name>.command` resolves on PATH (§D.1)
- No literal secrets in `mcpServers.<name>.args` (§D.2)
- No `Bash(*)` or equivalent unrestricted patterns in `permissions.allow` (§E.1)

## Sample output (abbreviated)

```
# Agent Review — config

## Summary
agnix: 0 errors, 1 warning (1 auto-fixable)
Config: 1 CLAUDE.md ref broken · 0 duplicates · 0 MCP issues · 1 overbroad permission

## important (2)
- CLAUDE.md:14 — agent/config.md#A.1 — confidence 100 [sub_surface: config]
  Broken @-include: @construct/identity/MISSING.md does not resolve.
  [tag: broken-include] [approval: single]
- .claude/settings.json:23 — agent/config.md#E.1 — confidence 90 [sub_surface: config]
  Bash(*) grants unrestricted shell access; narrow to specific commands.
  [tag: overbroad-permission] [approval: single]

## Config detail
| File | @-includes | Cycles | Duplicates | Verdict |
|------|-----------|--------|------------|---------|
| CLAUDE.md (global) | 4 (1 broken) | 0 | 0 | drift |
| src/core/CLAUDE.md | 4 | 0 | 0 | OK |
| .claude/CLAUDE.md | 0 | 0 | 0 | OK |
```

**Note:** there is no `config-fix` predecessor — config fixes are split between agnix `--fix-safe` (structural autofix, prompted explicitly) and content-level Edits (broken `@`-includes, dead MCP, overbroad permissions). In `mode: fix`, this sub-section delegates structural lint to `agnix --fix-safe` and applies only the content-level fixes itself.
