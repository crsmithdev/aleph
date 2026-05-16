# Example: /skills-audit (diff scope)

## Invocation

```
/skills-audit
```

Default scope is `--all` (skill set is small and stable). Audits every `src/skills/*/SKILL.md` against `src/rules/skills/RULES.md` and cross-checks `skill-rules.json` for registry consistency.

## What was checked

- Required frontmatter fields (name, description; verb/domain/modes for audit/fix leaves) — A.1
- `name:` matches parent directory — A.2
- Description ≥100 chars with quoted trigger phrases — B.1
- `skill-rules.json` entry exists for each user-facing skill — C.1
- No duplicate keywords across registry entries — C.2
- SKILL.md under 250 lines — D.1
- `examples/` directory present for slash-command skills — D.2
- No `Skill()` calls from leaves (only omnibus may invoke skills) — E.1
- Trigger phrases in description appear in `skill-rules.json` keywords — G.1
- Usage signals: no git activity + sparse description + no examples = `unused-skill` — H.1

## Sample output (abbreviated)

```
# Skills Audit — all (42 skills)

## Summary
42 skills audited · 0 orphaned · 4 missing examples · 0 over-length
Keyword collisions: 0 · R1 violations: 0 · R4 violations: 0

## nit
src/skills/agents-audit/ — skills/RULES.md#D.2 — confidence 90
  No examples/ directory; description mentions /agents-audit slash-command.
  [tag: examples] [approval: single]

## Skill detail
| Skill        | Frontmatter | Registry | Name match | Length | Examples | R1 | Verdict |
|--------------|-------------|----------|------------|--------|----------|----|---------|
| agents-audit | ✓           | ✓        | ✓          | 183L   | ✗        | ✓  | 1 nit   |
| hooks-audit  | ✓           | ✓        | ✓          | 199L   | ✗        | ✓  | 1 nit   |
| omnibus      | ✓           | ✓        | ✓          | 207L   | ✗        | ✓  | 1 nit   |
| skills-audit | ✓           | ✓        | ✓          | 182L   | ✗        | ✓  | 1 nit   |
```
