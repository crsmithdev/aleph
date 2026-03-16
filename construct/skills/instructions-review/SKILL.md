---
name: instructions-review
description: Use to review and improve the quality of AI instruction files. Reviews CLAUDE.md, identity files, SKILL.md files, and command files for vagueness, contradictions, impossible instructions, duplication, and missing information.
---

# Instructions Audit: Say What You Mean

> Instructions that are vague, contradictory, or impossible to follow are worse than no instructions — they erode trust in all instructions.

## When to Activate

- During `/construct audit` (phase 3)
- After significant changes to CLAUDE.md, identity files, or skill files
- When prompted with "audit instructions", "review rules", "contradictions"

## Scope

All files that contain instructions for Claude:

| File type | Locations |
|-----------|----------|
| CLAUDE.md | Project root, `.claude/`, `~/.claude/` |
| Identity files | `construct/core/identity/` (SOUL.md, IDENTITY.md, STYLE.md, USER.md, BOOTSTRAP.md) |
| Skill playbooks | `construct/skills/*/SKILL.md` |
| Command file | `dotclaude/commands/construct.md` |

## The Process

### Step 1 — Read All Instruction Files

Read every file in scope. Build a mental index of what each file covers.

### Step 2 — Check Each File for Five Problems

For each file:

**Vague or ambiguous instructions** — Could this be interpreted multiple ways? Would two different agents do different things when following it?
- Flag it. Suggest a concrete rewrite that eliminates ambiguity.
- Example: "Keep things clean" → "After completing a task, remove unused imports from modified files."

**Contradictions** — Does this instruction conflict with another instruction in any file?
- Cite both locations (file + line).
- Recommend which one to keep and why.

**Impossible instructions** — Does this reference tools, features, files, or patterns that don't exist?
- Check that referenced files exist on disk.
- Check that referenced tools/commands are real.

**Duplication** — Is this instruction stated in multiple files?
- Cite both locations.
- Recommend which to keep (prefer the more specific location).
- Information should live in exactly one place.

**Missing information** — What would a brand-new session need to know that can't be derived from the codebase?
- Entry points, non-obvious conventions, things that have bitten previous sessions.
- Don't flag things derivable from code or git history.

### Step 3 — Report

For each finding:
- File, line number
- Problem category (vague / contradiction / impossible / duplicate / missing)
- The instruction text
- Suggested fix or resolution

Group by file. Sort by severity (contradictions > impossible > vague > duplicate > missing).

## Principles

- **Specificity over brevity.** A longer, unambiguous instruction beats a short, vague one.
- **Single source of truth.** Each rule lives in exactly one place. Cross-reference, don't duplicate.
- **Test the instruction mentally.** Ask: "If I gave this to an agent with no context, would it do the right thing?"
- **Instructions decay.** Files get renamed, tools get removed, processes change. Instructions that reference them become lies.
