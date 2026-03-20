---
name: instructions-review
description: Reviews AI instruction files for vagueness, contradictions, impossible instructions, duplication, and missing information.
---

# Instructions Audit

> Instructions that are vague, contradictory, or impossible to follow are worse than no instructions — they erode trust in all instructions.

## Inputs

- List of instruction files to review (or use project extension to define scope)

## Process

### 1 — Read all instruction files in scope

Build a mental index of what each file covers.

### 2 — Check each file for five problems

**Vague or ambiguous** — Could this be interpreted multiple ways? Would two agents do different things?
- Suggest a concrete rewrite that eliminates ambiguity.

**Contradictions** — Does this conflict with another instruction in any file?
- Cite both locations. Recommend which to keep and why.

**Impossible instructions** — References tools, files, or patterns that don't exist?
- Check that referenced files exist on disk and referenced tools are real.

**Duplication** — Same instruction stated in multiple files?
- Cite both locations. Keep the more specific one. Information lives in exactly one place.

**Missing information** — What would a new session need to know that can't be derived from the codebase?
- Entry points, non-obvious conventions, things that have bitten previous sessions.

### 3 — Report

For each finding: file, line, category, instruction text, suggested fix.

Group by file. Sort by severity: contradictions > impossible > vague > duplicate > missing.

## Done when

- Every file in scope read completely
- All five problem categories checked in every file
- Cross-file contradictions and duplications identified
- Report produced, grouped by file, sorted by severity

## Principles

- Specificity over brevity — longer and unambiguous beats short and vague
- Single source of truth — cross-reference, don't duplicate
- Test mentally: "If I gave this to an agent with no context, would it do the right thing?"
- Instructions decay — files get renamed, tools removed, processes change
