---
name: docs-review
description: Use when documentation may have drifted from actual behavior. Detects drift between docs (README.md, INSTALL.md, SPEC.md, CLAUDE.md) and code/file state. Checks spec completeness. Activated by /construct spec subcommands or when docs are mentioned alongside changes.
---

# Documentation Sync

Docs that don't match behavior are worse than no docs — they actively mislead.

**Grounding:** SOUL.md mental model — *Map vs territory* (docs lie; code and tests are truth). Commandment 7 — "All docs must match actual behavior with zero drift."

## When to Activate

- After any FULL task that modifies behavior
- During `/construct audit` (phases 4 + 5)
- After install/upgrade (part of the verification cycle)
- When prompted with "doc sync", "spec diff", "docs drift", "documentation mismatch"

## Scope

| Document | Truth source |
|----------|-------------|
| README.md | Actual directory layout, hook registrations, slash commands |
| INSTALL.md | Actual installer behavior, preserved files, prerequisites |
| Module README.md | Actual module contents and hook behavior |
| Module INSTALL.md | Actual verification results (run the checks) |
| SPEC.md | Actual hooks, commands, skills, behavior |
| CLAUDE.md | Actual behavior (are rules followed? do referenced files exist?) |
| Skill SKILL.md | Actual skill-rules.json keywords, skill directory contents |

## Detection Process

### 1. Enumerate Claims

Read the document. Extract every factual claim:
- "File X exists at path Y"
- "Hook Z is registered under event W"
- "The installer preserves files matching pattern P"
- "Running command C produces output O"

### 2. Verify Each Claim

For each claim, check the truth source:
- File existence → `ls` / Glob
- Hook registration → read settings.json
- Behavior claims → run the command, check output
- Directory layout → compare tree output to documented tree
- Keyword lists → compare skill-rules.json to SKILL.md "when to use"

### 3. Check Spec Completeness

Read `SPEC.md` and verify:
1. Every hook registered in `settings.json` is documented in the Hook Registration table.
2. Every slash subcommand in `construct.md` is documented.
3. Every skill in `skill-rules.json` is documented.
4. Every module detection file listed matches reality.
5. Flag any behavior described in SPEC.md that has no corresponding implementation.

### 4. Report

For each claim, report:
- `✓` — claim matches reality
- `✗` — claim contradicts reality (with evidence)
- `⚠` — claim is ambiguous or untestable

Output a table: document, line, claim, actual state, suggested direction (update doc or update code).

## /construct spec Subcommands

### `spec diff`

Show drift without changing anything:
1. Run detection process on all docs in scope
2. Output a table of all `✗` and `⚠` findings
3. For each, show: document, line, claim, actual state, suggested direction (update doc or update code)

### `spec update`

Update docs from current file/code state:
1. Run detection process on all docs in scope
2. For each `✗` finding, propose the fix (show old → new)
3. Apply approved fixes
4. Run verification skill to confirm changes are correct

### `spec apply`

Update code/files to match doc claims (reverse direction):
1. Run detection process on all docs in scope
2. For each `✗` finding, determine if the doc or code is "right"
3. For cases where the doc is intentional (new feature spec), modify code to match
4. Run tests after each change
5. Run verification skill on the full result
