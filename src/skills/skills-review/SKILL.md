---
name: skills-review
description: Reviews skill SKILL.md files for quality, correct registration in skill-rules.json, and alignment with actual behavior.
---

# Skills Review

Skills guide agent behavior for specific task types. A vague or contradictory skill produces inconsistent results.

## When to Use

- After adding or modifying skill files in `src/skills/`
- After changing skill-rules.json keywords
- When a skill triggers at the wrong time or doesn't trigger when expected

## Scope

All `SKILL.md` files in `src/skills/*/`, plus `src/skills/skill-rules.json`.

## Checks

**Registration** — Every skill directory has a matching entry in skill-rules.json. Keywords are specific enough to avoid false triggers and broad enough to catch real use. No orphaned directories without rules. No rules pointing to missing skills. (Remove completely — no orphaned artifacts.)

**Code over instructions** — If a skill's process describes mechanical steps that could be scripted (file scanning, pattern matching, counting), those steps should be in code, not instructions. The skill prompt should handle judgment; code handles mechanics. (Code over AI instructions; TypeScript over Bash.)

**Vague or ambiguous** — Could the process steps be interpreted multiple ways? Would two agents do different things given the same input? Suggest concrete rewrites.

**Contradictions** — Does this skill conflict with another skill, with CLAUDE.md rules, or with Commandments? Cite both locations. (No duplication between memory, CLAUDE.md, and docs.)

**Impossible instructions** — References tools, files, MCP servers, or patterns that don't exist? Check that referenced paths exist on disk. (Nothing fails silently.)

**When to Use / When NOT to Use** — Are the trigger conditions clear and non-overlapping with other skills?

**Done when** — Are completion criteria testable and unambiguous? Can you verify "done" without subjective judgment?

**Keyword overlaps** — Do any two skills share keywords that would cause ambiguous activation?

**Project extensions** — If the skill supports project-specific extensions, is that mechanism documented and functional?

<!-- PROJECT-SPECIFIC CRITERIA
Add your own checks below:

-
-
-
-->

## Process

1. Read skill-rules.json — build skill → keywords map
2. Read each SKILL.md fully
3. Run each check above per skill
4. Cross-reference: orphaned directories? Missing rules entries? Keyword overlaps?

## Report

For each finding: skill name, file, check category, issue, suggested fix.
Group by skill. Sort by severity: contradictions > impossible > code-over-instructions > vague > registration > minor.

## Done when

- Every skill file read and checked
- skill-rules.json ↔ filesystem consistency verified
- Cross-skill contradictions and keyword overlaps identified
- Report produced
