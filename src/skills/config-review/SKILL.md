---
name: config-review
description: Reviews Claude Code configuration files (settings.json, CLAUDE.md) for consistency, correctness, and completeness.
---

# Configuration Review

Configuration files control permissions, hooks, MCP servers, and behavioral rules. Misconfigurations cause silent failures or security issues.

## When to Use

- After modifying settings.json, settings.local.json, or CLAUDE.md files
- After `bun install.ts` runs — verify installed config matches source
- When behavior seems wrong but code looks correct — may be config

## Scope

- `src/core/hooks/settings-hooks.json` (install source for hooks, settings)
- `.claude/settings.json` (project-local: permissions, statusline, MCP only)
- `~/.claude/settings.json` (installed global)
- `src/core/CLAUDE.md` (install source for behavioral rules)
- `.claude/CLAUDE.md` (project-local dev rules)
- `~/.claude/CLAUDE.md` (installed global)

## Checks

**Source vs installed drift** — Does `~/.claude/settings.json` match what `src/core/hooks/settings-hooks.json` would produce after merge? Has someone edited the installed file directly instead of the source? (Source in `src/` and `src/`, never edit installed files directly.)

**No duplication across layers** — Same hook, command, or setting in both `.claude/` and `src/`? This causes double-firing. `.claude/settings.json` may only contain permissions, statusline, and MCP server config — never hooks.

**CLAUDE.md ownership** — Rules exist in exactly one CLAUDE.md file:
  - `src/core/CLAUDE.md` → behavioral rules (installed to `~/.claude/CLAUDE.md`)
  - `.claude/CLAUDE.md` → dev-only rules (loaded at runtime, never installed)
  - No rule duplicated between the two. (No duplication between layers.)

**Permission scope** — Are permissions as narrow as practical? Flag anything dangerously broad (e.g. `Bash(*)` without justification).

**Hook registration** — Every hook entry points to an existing script. Event types are valid Claude Code events. Timeout values set where needed. (Cross-reference with hooks-review.)

**MCP servers** — Referenced MCP servers are configured and reachable. Environment variables they need are set or documented.

**Environment variables** — Referenced env vars are documented and have defaults or error messages when missing.

**Information layering** — Is information stored at the right layer? Ephemeral state → tasks/conversation. Durable insights → semantic memory (MCP). Project conventions → CLAUDE.md. Behavioral rules → src/core/CLAUDE.md. (No duplication between memory, CLAUDE.md, and docs.)

<!-- PROJECT-SPECIFIC CRITERIA
Add your own checks below:

-
-
-
-->

## Process

1. Read all config files in scope (source, project-local, installed)
2. Diff source vs installed for drift
3. Run each check above
4. Cross-reference hooks, permissions, and MCP entries against filesystem

## Report

For each finding: file, section, check category, issue, suggested fix.
Group by file. Sort by severity: security > duplication/double-fire > drift > missing > minor.

## Done when

- All config files read and compared
- Source ↔ installed consistency verified
- No duplicate hooks or rules across layers
- Report produced
