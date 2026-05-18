# Example: /agent-review applying skills findings

## Invocation

```
/agent-review skills
fix the skill findings
```

After the scan presents findings, the user picks which to apply at the approval gate. Each finding's tag routes to a fix shape from the Skills sub-surface table. The leaf verifies with `gate("skills")` + JSON validity on `skill-rules.json` + re-grep for `Skill(` in leaves + `agnix --dry-run`.

## Plan

```
[plan]
src/skills/example-leaf/SKILL.md
  - finding tagged r1-violation: stray Skill('audit') invocation in body
  - remove the call; leaf skills don't dispatch other skills

src/skills/another-leaf/SKILL.md
  - finding tagged r4-violation: hardcoded `bun test.ts` in verification step
  - replace with gate("code") and confirm VERIFICATION.md has the entry

src/skills/skill-rules.json
  - finding tagged orphaned-skill: src/skills/new-skill/ has no registry entry
  - add entry with keywords derived from description
  - finding tagged trigger-drift: skill X's description promises "audit my X" but registry has only ["x"]
  - add "audit my x", "/audit x"
[/plan]
```

## Apply

```
[applying]
- src/skills/example-leaf/SKILL.md: stray Skill() call removed; R1 closed
- src/skills/another-leaf/SKILL.md: gate("code") substituted; R4 closed
- src/skills/skill-rules.json: 2 entries added/updated; JSON valid
- re-audit: zero remaining skills findings in scope
[/applying]
```

## Verify

```
[verify]
scope:      2 SKILL.md files + skill-rules.json
method:     gate("skills") + JSON.parse(skill-rules.json) + grep -r "Skill(" src/skills (excluding audit dispatcher)
            + agnix --dry-run src/skills/
assertions: skill tests pass; registry valid JSON; no leaf calls Skill(); agnix structural lint green
[/verify]
```

## Summary

- 4 skills findings resolved (1 R1, 1 R4, 1 orphaned-skill, 1 trigger-drift)
- 3 files edited (2 SKILL.md + 1 registry)
- 0 renames performed (none in findings)
- 0 findings skipped

**Eval-target marker preservation:** in this run, none of the touched skills had `eval-target:` frontmatter or `evals/<name>.yml` references. When such markers are present, the fix shape preserves them — the eval-harness reads them silently and breaks if they're renamed.
