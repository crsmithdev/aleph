---
name: config-audit
description: Full health check for Claude Code agent configuration — hooks, skills, AGENTS.md, CLAUDE.md, and MCP setup. Runs agnix structural linting, traces hook outputs to their downstream consumers (flagging dead outputs), validates the skills registry against files on disk, and checks CLAUDE.md @-includes for broken references. Produces a prioritized findings report then offers to fix approved issues. Use when auditing hooks, checking if hook outputs are consumed, finding orphaned skills, reviewing agent configuration health, or any time the user asks "are my hooks wired up", "audit my config", or "what's broken in my agent setup". Do NOT use for general code quality (use code-review), security vulnerabilities (use security-audit), or UI design (use design-reviewer).
model: sonnet
---

Two-phase workflow: audit first, fix after approval.

## Phase 1: Audit

### Step 1 — Run agnix

Run agnix on the project root (it is installed at `/usr/bin/agnix`, v0.17.0). Use `--target claude-code` to activate Claude Code-specific rule families (CC-AG-*, CC-SK-*, CC-HK-*):

```bash
agnix --target claude-code --dry-run --show-fixes .
```

Collect all errors and warnings. Note which are marked `[fixable]`.

### Step 2 — Hook semantic audit

Read the hook registry (`src/core/hooks/settings-hooks.json` for Construct projects, otherwise `.claude/settings.json` → `hooks`).

For each registered hook, read the script and collect:
1. **stdout** — `console.log`/`process.stdout.write` calls and what they carry (advisory messages, JSON decisions)
2. **stderr** — `console.error`/`process.stderr.write` calls and what they carry (block reasons, errors)
3. **Exit codes** — every `process.exit(N)` call: 0 = continue, 1 = internal error, 2 = hard block (PreToolUse only)
4. **Files written** — every `writeFileSync`, `appendFileSync`, and path written; check shared helpers like `reportHook()` too
5. For each file path: grep for consumers: `grep -r "<partial-path>" src/ --include="*.ts" -l`
6. Whether it calls `reportHook()` and what fields beyond `{ts, hook, event, sessionId}`

After auditing all hooks individually, identify **hook pairs**: scripts that work together where one writes state and another reads it (possibly across a session boundary or /compact). List each pair with the shared file and handoff timing.

Verdict: **LIVE** (file outputs consumed) / **PARTIAL** (some orphaned) / **DEAD** (files written, nothing reads) / **ADVISORY** (stdout/stderr only, no file outputs) / **BROKEN** (script missing)

### Step 3 — Skills registry audit

Read `src/skills/skill-rules.json` (Construct) or glob `.claude/skills/*/SKILL.md`.

For each entry: does the SKILL.md exist? Does its `name` frontmatter match? Are there SKILL.md files on disk with no registry entry (orphaned — they load but never auto-route)?

### Step 4 — CLAUDE.md reference audit

```bash
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
```

For each file, find `@`-prefixed includes and verify the referenced path exists on disk.

### Report format

```
# Config Audit — [project]
Date: YYYY-MM-DD

## Summary
agnix: N errors, N warnings (N fixable)
Hooks: N live · N partial · N advisory · N dead · N broken
Skills: N valid · N missing · N orphaned
CLAUDE.md refs: N broken

## agnix Findings
[errors then warnings; mark [fixable]]

## Hook Audit
| Hook | Event | stdout | stderr | Exit codes | Files written | Consumed by | Observability | Verdict |
...

### Hook pairs
| Writer hook | Reader hook | Shared file / signal | Handoff timing |
...

### Dead / Partial outputs
[specific paths that are unread + suggested action]

## Skills Audit
| Skill | Registry | SKILL.md | Name match | Status |

## CLAUDE.md Reference Audit
| File | Broken include | Expected path |

## Action Items
- [Critical] ...
- [Warning] ...
- [Info] ...
```

Do NOT proceed to Phase 2 until the user reviews the report and specifies what to fix.

## Phase 2: Fix

Apply only the approved fixes:

- **agnix auto-fixable** — run `agnix --target claude-code --fix-safe .`; show diff before applying
- **Broken @-includes** — locate the missing file or remove the reference
- **Dead hook outputs** — remove the write or add a consumer
- **Missing SKILL.md** — stub the file or remove the registry entry
- **Orphaned skills** — add a registry entry with trigger keywords

After fixes, re-run `agnix --target claude-code --dry-run .` to confirm the issue count dropped.
