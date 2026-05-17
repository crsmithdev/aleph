# Example: /agent-review --sub-surface skills

## Invocation

```
/agent-review --sub-surface skills
```

Default scope is `--all` (skill set is small and stable). Audits every `src/skills/*/SKILL.md` against `src/rules/agent/skills.md` and cross-checks `skill-rules.json` for registry consistency. Runs G.2 transcript-backed trigger health on scope=all.

## What was checked

- Required frontmatter (name, description; verb/domain/modes for audit/fix leaves) — A.1
- `name:` matches parent directory — A.2
- Description ≥100 chars with quoted trigger phrases — B.1
- `skill-rules.json` entry exists for each user-facing skill — C.1
- No duplicate keywords across registry entries — C.2
- SKILL.md under 250 lines — D.1
- `examples/` directory present for slash-command skills — D.2
- No `Skill()` calls from leaves (only omnibus may invoke) — E.1 (R1)
- No hardcoded `bun test.ts` in fix-flavor skills — F.1 (R4)
- Trigger phrases in description appear in `skill-rules.json` keywords — G.1
- Transcript-backed trigger health (G.2)
- Usage signals: no git activity + sparse description + no examples = `unused-skill` — H.1

## Sample output (abbreviated)

```
# Agent Review — skills · all (42 skills)

## Summary
42 skills audited · 0 orphaned · 4 missing examples · 0 over-length
Keyword collisions: 0 · R1 violations: 0 · R4 violations: 0
Trigger health: 0 stale · 2 slash-only · 1 missed · 0 over-broad

## nit
src/skills/agent-review/ — agent/skills.md#D.2 — confidence 90 [sub_surface: skills]
  No examples/ directory; description mentions /agent-review slash-command.
  [tag: examples] [approval: single]

## Skill detail
| Skill         | Frontmatter | Registry | Name match | Length | Examples | R1 | Verdict |
|---------------|-------------|----------|------------|--------|----------|----|---------|
| agent-review  | ✓           | ✓        | ✓          | 220L   | ✓        | ✓  | OK      |
| code-review   | ✓           | ✓        | ✓          | 183L   | ✓        | ✓  | OK      |
| omnibus       | ✓           | ✓        | ✓          | 207L   | ✓        | n/a| OK      |

### Trigger Health — 287 messages sampled
| Skill         | Slash-only | NL-matched | Missed | Verdict |
|---------------|-----------|------------|--------|---------|
| agent-review  | 3         | 12         | 1      | ⚠ check triggers |
| eval-harness  | 8         | 0          | 0      | ok (slash-only by design) |
```
