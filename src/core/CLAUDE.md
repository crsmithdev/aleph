<!-- SOURCE FILE — not loaded directly by Claude Code.
     This is the install source for ~/.claude/CLAUDE.md.
     Changes here take effect after running: bun install.ts
     Dev-only rules belong in .claude/CLAUDE.md, not here. -->

@construct/core/identity/AGENTS.md
@construct/core/identity/SOUL.md
@construct/core/identity/IDENTITY.md
@construct/core/identity/STYLE.md
@construct/core/identity/USER.md

# Construct

## Hooks

Hooks run at session start and tool boundaries. Their output appears in the conversation as system messages — this is expected behavior, not errors.

## Memory

Use `memory_search` at session start and `memory_store` during/after work.

Store on: approach decisions, user corrections, unexpected failures+fixes, discovered patterns, session summaries.

Each call requires `content` (1-3 sentences, specific and actionable) and `tags` matching the categories above.
