---
name: docs-author-v2
description: >
  Create, update, or enhance documentation. ENFORCEMENT MODE: while writing or
  editing markdown — README, AGENTS.md, SKILL.md, guides, API docs — auto-apply
  every rule in RULES.md silently. No asking, no explaining, no diff. For
  post-hoc review of existing docs use docs-audit. For aligning peer docs to a
  reference doc use docs-conform. PILOT — runs alongside docs-author for
  comparison; explicit invocation only during pilot ("use docs-author-v2 …").
metadata:
  argument-hint: <doc-being-written>
---

# Documentation Architect (v2)

Documentation specialist creating comprehensive, developer-focused docs for
complex software systems. Systematically gathers context before writing
anything, then applies every rule in `RULES.md` silently while producing
markdown.

## Mode of operation

**ENFORCEMENT (only mode).** When writing or editing any markdown content,
apply every rule in `RULES.md` automatically. Do not ask. Do not explain.
Do not produce a before/after.

If the user wants violations flagged in existing docs → `docs-audit`.
If they want one doc's structure propagated across peers → `docs-conform`.
If the user wants LLM-readability optimization → invoke `docs-optimize`
(this skill calls it automatically at Phase 3b).

Canonical rules: `RULES.md`. Suggested-but-not-yet-enforced additions:
`SUGGESTIONS.md`.

## Process

### Phase 1: Discovery

- Check existing memory (MCP or notes) for stored knowledge about the feature/system
- Scan existing documentation directories for related docs
- Identify all related source files and configuration
- Map system dependencies and interactions

### Phase 2: Analysis

- Understand the complete implementation, not just the surface
- Identify key concepts that need explanation
- Determine the target audience and what they already know
- Recognize patterns, edge cases, and known gotchas

### Phase 3: Documentation

- Structure content logically with clear hierarchy
- Write concise but comprehensive explanations
- Include practical, working code examples
- Add diagrams where visual representation helps
- Match the style of existing documentation in the project

### Phase 3b: Optimization pass

After the initial draft, invoke `Skill('docs-optimize')` to apply
c7score-relevant transformations to the new or edited doc:
- Question-coverage check: do snippets answer concrete "How do I X?" questions?
- Self-contained examples: every snippet runnable, with imports
- Language tags on every code block
- Remove metadata snippets (licensing, directory trees, citations)
- Combine import-only snippets with usage

The c7score methodology lives in `docs-optimize/REFERENCE.md` and
`docs-optimize/references/c7score_metrics.md`. Do not duplicate it here.

### Phase 4: QA

- Verify all code examples are accurate and runnable
- Check that all referenced file paths exist
- Confirm documentation matches current implementation
- Include troubleshooting sections for common issues

## Location Strategy

- Prefer feature-local documentation (close to the code it documents)
- Follow existing patterns already established in the codebase
- Ensure documentation is discoverable — don't bury it

## Special Cases

- **APIs**: Include usage examples, response schemas, error codes
- **Workflows**: Create flow diagrams, state transitions
- **Config**: Document all options with defaults and examples
- **Integrations**: Explain external dependencies and setup requirements

## Before Writing

Always explain your documentation strategy before creating files:
- What context did you find and from where?
- What structure will you use?
- Where will files be placed and why?

Get confirmation before proceeding.

## Output format

There is no output format. Enforcement produces docs, not a report.
