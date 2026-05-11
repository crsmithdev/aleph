---
name: config-audit
description: Full health check for Claude Code agent configuration — hooks, skills, AGENTS.md, CLAUDE.md, and MCP. Use whenever the user wants to audit their hooks, find dead hook outputs, verify skill triggers match their files, or check if their agent setup is healthy. Trigger on any variation of "audit hooks", "are my hooks wired up", "check my skills", "audit my config", "what's broken in my setup", "hook audit", "agent audit", or "review my agent configuration" — even if they don't say "config-audit" explicitly.
---

# Config Auditor

Full health check for Claude Code agent configuration. Combines structural linting via `agnix` with a deeper semantic audit: hook output tracing, dead output detection, skill registry validation, and CLAUDE.md reference integrity.

## Phase 1: Structural Lint (agnix)

Check if agnix is installed:

```bash
which agnix 2>/dev/null || echo "NOT_INSTALLED"
```

If installed, run it on the project root:

```bash
agnix --dry-run --show-fixes .
```

agnix covers 385 rules including:
- **CC-*** — CLAUDE.md, hooks, agents, plugins (53 rules)
- **AS-* / CC-SK-*** — SKILL.md naming, frontmatter, required fields (31 rules)
- **AGM-* / XP-*** — AGENTS.md structure and spec (13 rules)
- **MCP-*** — MCP server config (12 rules)

Collect all errors and warnings. Mark which are auto-fixable (`--fix-safe` applies high-confidence fixes only). Do not apply fixes yet — surface them in the report.

If agnix is not installed, note it and suggest `npm install -g agnix`. Continue with the remaining phases regardless.

## Phase 2: Hook Semantic Audit

### 2a. Locate the hook registry

Check in order until one is found:
1. `src/core/hooks/settings-hooks.json` — Construct layout (hooks array with `command` fields)
2. `.claude/settings.json` → `hooks` array — standard Claude Code project
3. `~/.claude/settings.json` → `hooks` array — global fallback

### 2b. For each registered hook, run five checks

**stdout / stderr** — read the script and determine what each stream carries:
- `console.log` / `process.stdout.write` → stdout (advisory messages Claude reads)
- `console.error` / `process.stderr.write` → stderr (hard block reasons, error text)
- Many hooks write to one but not both — note which

**Exit codes** — find every `process.exit(N)` call:
- `0` = success / continue
- `1` = internal error (stdin parse failure etc.)
- `2` = hard block (PreToolUse only — prevents the tool call)
Note: hooks without an explicit exit call implicitly exit 0.

**Files written** — find every `writeFileSync`, `appendFileSync`, `mkdirSync` and the full path written. Also check calls to shared helpers like `reportHook()` — read those helpers to find what they write.

**Consumer search** — for each file path found above, grep the codebase:
```bash
grep -r "partial-path-or-signal-name" src/ --include="*.ts" -l
```
Check whether it feeds: other hooks, the observability UI, an eval harness, or session-start. A file nothing reads is a dead output.

**Observability logging** — does the hook call `reportHook()`? If so, what fields does it log beyond the base `{ts, hook, event, sessionId}`? Extra fields (like `decision`, `tier`, `detail`) power richer UI views.

**Verdict per hook:**
- **LIVE** — all file outputs have confirmed consumers
- **PARTIAL** — some file outputs consumed, some orphaned (list which)
- **DEAD** — files written but nothing in the codebase reads them
- **ADVISORY** — stdout/stderr only, no file outputs (correct for advisory hooks)
- **BROKEN** — script file missing or points to a non-existent path

### 2c. Identify hook pairs

Scripts often work in pairs: one writes state (a signal file, summary, directives) and another reads it later — sometimes across a session boundary. After auditing all hooks individually, explicitly enumerate any pairs:

- **Writer → Reader**: name both hooks, the shared file/signal, and when the handoff happens (same session vs. next session after /compact or /clear)

Look for patterns like: PreCompact hook writes a snapshot → SessionStart hook reads it; Stop hook writes a session file → SessionStart hook reads it; UserPromptSubmit hook writes directives → Stop hook reads them.

## Phase 3: Skills Registry Audit

### 3a. Locate the registry

Check in order:
1. `src/skills/skill-rules.json` — Construct layout
2. Glob `.claude/skills/*/SKILL.md` — standard skill discovery (no central registry)

### 3b. Per-entry checks

For each entry in the registry:
- Does the SKILL.md file it implies actually exist?
- Does the `name` field in SKILL.md frontmatter match the directory/entry name?
- Are trigger keywords meaningful — do they overlap with what the description promises?

For each SKILL.md found on disk:
- Does it have a corresponding registry entry? Orphaned skills load but never trigger via keyword routing.

## Phase 4: CLAUDE.md Reference Audit

Find all CLAUDE.md files:
```bash
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
```

For each file, find `@`-prefixed includes (e.g. `@construct/core/CLAUDE.md`, `@path/to/file.md`) and verify each referenced path resolves to a real file. A broken include silently omits rules — Claude never loads them and gives no error.

## Report Format

```
# Config Audit — [project or directory name]
Date: YYYY-MM-DD

## Summary
agnix: N errors, N warnings (N auto-fixable)
Hooks: N live · N partial · N advisory · N dead · N broken
Skills: N valid · N missing files · N orphaned
CLAUDE.md refs: N broken

---

## agnix Findings
[errors, then warnings; mark [fixable] on those that are]

If none: "agnix: no issues found."

---

## Hook Audit

| Hook | Event | stdout | stderr | Exit codes | Files written | Consumed by | Observability | Verdict |
|------|-------|--------|--------|------------|---------------|-------------|---------------|---------|
| name | Stop  | advisory msg | — | 0 | `signals/foo.jsonl` | context-restore-start | hook-events.jsonl (base) | LIVE |

### Hook pairs
List every writer→reader pair explicitly:

| Writer hook | Reader hook | Shared file / signal | Handoff timing |
|-------------|-------------|----------------------|----------------|
| context-backup-precompact | context-restore-start | `signals/compaction-notes.json` | Next session after /compact |

### Dead / Partial outputs (action required)
For each DEAD or PARTIAL hook: list the specific output path that is unread and suggest either removing it or adding a consumer.

---

## Skills Audit

| Skill | Registry entry | SKILL.md exists | Name match | Status |
|-------|---------------|-----------------|------------|--------|
| name  | ✓             | ✓               | ✓          | OK     |

Orphaned skills (SKILL.md exists, no registry entry):
[list them — they load but never trigger]

---

## CLAUDE.md Reference Audit

| File | Broken include | Expected path |
|------|---------------|---------------|
| path/to/CLAUDE.md | @construct/missing/file.md | ~/.claude/construct/missing/file.md |

If none: "All @-includes resolve correctly."

---

## Action Items

Group by priority:
- [Critical] Script missing for hook X — hook fires but does nothing
- [Warning] Hook Y writes signals/foo.jsonl — nothing reads it
- [Info] Skill Z has no registry entry — triggers on keywords but never auto-routes
```

## Scope

Default: audit the current working directory. If the user specifies a subdirectory, scope to that. If they ask about a specific hook or skill by name, focus on that entry but still run agnix globally.

Don't duplicate agnix findings in the semantic sections — if agnix already flagged a naming issue, reference it rather than repeating it.

After presenting the report, ask: "Want me to apply the agnix auto-fixes (`--fix-safe`) or address any of these manually?"
