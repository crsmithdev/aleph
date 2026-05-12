# Config Rules

Authoritative rules for Claude Code agent configuration: `CLAUDE.md` files, `.claude/settings.json`, MCP server configs, `AGENTS.md`. Read by `config-audit`.

**Status: stub — agnix covers most of this domain.** `config-audit` already implements the semantic layer (hook output tracing, dead output detection, skill registry validation, CLAUDE.md reference integrity). agnix provides 385+ structural rules.

There is no `config-fix` or `config-author` skill — config writes are schema-driven and infrequent (agnix territory). Audit-only domain.

## Planned sections (mostly references to agnix rule IDs)

- **A. CLAUDE.md @-includes resolve** — every `@path/to/file.md` reference points to a real file
- **B. CLAUDE.md ownership** — rules exist in exactly one file (global vs project vs skill), no duplication
- **C. Hook registry consistency** — every command path in `settings-hooks.json` exists; cross-references in CLAUDE.md tables match
- **D. Skill registry consistency** — every `skill-rules.json` entry has a SKILL.md; every SKILL.md has a registry entry
- **E. MCP config validity** — server entries parse, executables resolve
- **F. Permission hygiene** — no overbroad allowlists (`Bash(*)` etc.); justification required
- **G. agnix passthrough** — findings from `agnix --dry-run` surfaced with rule IDs prefixed `agnix/`
