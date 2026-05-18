# Example: /agent-review (default — whole codebase)

## Invocation

```
/agent-review
audit my config
what's broken in my setup
```

Walks all four sub-surfaces across the project: config (CLAUDE.md, settings.json), hooks (`src/core/hooks/`), skills (`src/skills/`), personas (`src/agents/`, `.claude/agents/`). Default scope is every file in each sub-surface — narrow only when the user names a sub-surface or file.

## What was checked

**Config:**
- Every `@`-prefixed include in every CLAUDE.md resolves (§A.1)
- Include-graph has no cycles (§A.2)
- No duplicate rule blocks across layers (§A.3)
- MCP `command` fields resolve; args contain no secrets (§D.1, §D.2)
- No overbroad permissions (§E.1)

**Hooks:**
- Stdin JSON parse wrapped in try/catch with non-zero exit (A.1)
- `trace()` called before every exit path (B.1)
- Every `writeFileSync` target has a grep-visible reader (E.1)
- No double-registration across `.claude/settings.json` + `src/core/hooks/settings-hooks.json` (G.3)
- Telemetry: `unused-hook` and writer-fires-reader-never-does (I.1, I.2)

**Skills:**
- Frontmatter + name-matches-dir (A.1, A.2)
- Registry consistency: every SKILL.md has a `skill-rules.json` entry (C.1)
- R1 (no `Skill()` from leaves), R4 (no hardcoded `bun test.ts`) (E.1, F.1)
- Trigger phrases in description appear in registry keywords (G.1)
- Transcript-backed trigger health on scope=all (G.2)

**Personas:**
- Frontmatter, name-matches-file, model freshness (A.1-A.3)
- Description has when-to + when-NOT + output contract (B.1, B.2)
- No `Task` in `tools:`; read-only agents have no `Edit`/`Write` (C.1, C.2)
- Cross-domain drift: every `subagent_type:` and skill reference resolves (G.1)
- Stale-after-skill-change suggestions (G.2)

## Sample output (abbreviated)

```
# Agent Review — all

## Summary
agnix: 2 errors, 5 warnings (4 auto-fixable)
Config: 1 CLAUDE.md ref broken · 0 duplicates · 0 MCP issues · 1 overbroad permission
Hooks: 12 live · 1 partial · 1 dead · 0 broken · pairs: 3 typed / 1 untyped
Skills: 0 orphaned · 4 missing examples · 0 over-length · R1: 0 · R4: 0
  Trigger health: 0 stale · 2 slash-only · 1 missed · 0 over-broad
Personas: 0 missing frontmatter · 1 over-privileged · 1 routing-collision pair · 1 cross-domain-drift · 0 unused

## blocking (0)

## important (4)
- src/agents/docs-optimizer.md:7 — agent/personas.md#G.1 — [sub_surface: personas]
  Dead skill reference: body hardcodes `docs-optimizer` but skill is `docs-optimize`. [tag: cross-domain-drift]
- src/agents/codebase-auditor.md:8 — agent/personas.md#C.1 — [sub_surface: personas]
  Edit+Write in tools list on read-only audit agent. [tag: over-privileged]
- src/core/hooks/feedback-emit.ts:42 — agent/hooks.md#E.1 — [sub_surface: hooks]
  Writes signals/feedback-debug.jsonl; no consumer found in src/. [tag: dead-output]
- CLAUDE.md:14 — agent/config.md#A.1 — [sub_surface: config]
  Broken @-include: @construct/identity/MISSING.md does not resolve. [tag: broken-include]

## nit (5)
- src/skills/audit/ — agent/skills.md#D.2 — [sub_surface: skills]
  No examples/ directory; description mentions /audit slash-command. [tag: examples]
- ...
```

After the report: *"Apply all, pick which to apply, or discard? (`over-privileged` and `dead-output` will prompt per-finding.)"*
