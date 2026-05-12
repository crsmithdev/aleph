---
name: config-audit
description: >
  Full health check for Claude Code agent configuration — hooks, skills, AGENTS.md,
  CLAUDE.md, MCP. Walks `src/rules/config/RULES.md` (sections A-G) plus agnix
  structural lint as passthrough. Emits SARIF findings (per
  `src/skills/_shared/finding.md`) plus a phased prose report covering the
  semantic checks (hook output tracing, dead output detection, skill registry
  validation, CLAUDE.md `@`-include integrity). Read-only — no edits. Triggers
  on "audit hooks", "are my hooks wired up", "check my skills", "audit my
  config", "what's broken in my setup", "hook audit", "agent audit",
  "/config-audit", or `/audit config`.
verb: audit
domain: config
modes: [report]
---

# Config Audit

Full health check for Claude Code agent configuration. Combines structural linting via `agnix` with a deeper semantic audit: hook output tracing, dead output detection, skill registry validation, MCP config integrity, and `CLAUDE.md` reference checks.

Pure leaf: no `Skill()` calls. The omnibus chains us; we report. Audit-only — there is no `config-fix` leaf (config writes are schema-driven; agnix handles structural lint with `--fix-safe`).

## When to use

- User asks to audit their hooks, skills, MCP, AGENTS.md, or CLAUDE.md setup.
- User invokes `/config-audit`, or the omnibus dispatches the `audit` verb to the `config` domain.

## When NOT to use

- General code quality → `code-audit`.
- Visual / UX review → `design-audit`.
- Security vulnerabilities → `security-audit`.

## Inputs

1. **Scope** (default: current project) — the agent root directory.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

The semantic audit happens in four phases (2-5 below). agnix runs first as the structural-lint passthrough.

### 1. agnix structural lint (passthrough)

Check whether agnix is installed:

```bash
which agnix 2>/dev/null || echo "NOT_INSTALLED"
```

If installed, run:

```bash
agnix --dry-run --show-fixes .
```

For each error / warning, emit a SARIF finding with `ruleId: agnix/<rule-id>` per `config/RULES.md#G.1`. Map agnix's error → `level: error` + `severity: important`; warning → `level: warning` + `severity: nit`. Mark `--fix-safe`-applicable findings with `properties.tag: agnix-autofix`.

If agnix isn't installed, emit one `severity: nit` finding ("agnix not installed; install with `npm install -g agnix` for full structural lint") and continue.

### 2. Hook semantic audit (cites RULES.md §B)

#### 2a. Locate the hook registry

Check in order until one is found:

1. `src/core/hooks/settings-hooks.json` — Construct layout (hooks array with `command` fields)
2. `.claude/settings.json` → `hooks` array — standard Claude Code project
3. `~/.claude/settings.json` → `hooks` array — global fallback

#### 2b. For each registered hook, run five checks

- **stdout / stderr** — read the script and determine what each stream carries (`console.log` / `process.stdout.write` → stdout; `console.error` / `process.stderr.write` → stderr).
- **Exit codes** — find every `process.exit(N)` call (0 = continue, 1 = internal error, 2 = hard block on PreToolUse). Hooks without an explicit exit implicitly exit 0.
- **Files written** — find every `writeFileSync` / `appendFileSync` / `mkdirSync` and the full path; also resolve `reportHook()` and similar shared helpers.
- **Consumer search** — for each file path, grep the codebase: `grep -r "<partial-path-or-signal-name>" src/ --include="*.ts" -l`. A file nothing reads is a dead output (RULES.md §B.3).
- **Observability** — does the hook call `trace()` from `src/trace.ts`? (RULES.md §B.5)

#### 2c. Verdict per hook

- **LIVE** — all file outputs have confirmed consumers.
- **PARTIAL** — some outputs consumed, some orphaned (list which).
- **DEAD** — files written but nothing in the codebase reads them → emit finding (RULES.md §B.3, `tag: dead-output`, `severity: important`).
- **ADVISORY** — stdout/stderr only, no file outputs (correct for advisory hooks).
- **BROKEN** — script file missing or points at a non-existent path → emit finding (RULES.md §B.1, `tag: dead-hook`, `severity: blocking`).

#### 2d. Hook pairs

Scripts often work in pairs: one writes state (a signal file, summary, directives) and another reads it later — sometimes across a session boundary. Enumerate pairs explicitly with writer / reader / shared file / handoff timing.

Patterns to look for: PreCompact writes a snapshot → SessionStart reads it; Stop writes a session file → SessionStart reads it; UserPromptSubmit writes directives → Stop reads them.

#### 2e. Double-registration check

For each hook command path, check whether it appears in both `.claude/settings.json` AND `src/core/hooks/settings-hooks.json`. Double registration → finding (RULES.md §B.2, `tag: double-fire`, `severity: important`).

### 3. Skills registry audit (cites RULES.md §C)

#### 3a. Locate the registry

Check in order:

1. `src/skills/skill-rules.json` — Construct layout
2. Glob `.claude/skills/*/SKILL.md` — standard skill discovery (no central registry)

#### 3b. Per-entry checks

For each entry in the registry:

- Does the implied SKILL.md actually exist? (RULES.md §C.1, `tag: dead-skill`, `severity: blocking`)
- Does the `name:` field in SKILL.md frontmatter match the directory / entry name? (RULES.md §C.3, `tag: naming`, `severity: important`)
- Do trigger keywords overlap with what the description promises? Are there duplicate keywords across entries? (RULES.md §C.4, `tag: routing-collision`, `severity: important`)

For each SKILL.md found on disk: does it have a corresponding registry entry? (RULES.md §C.2, `tag: orphaned-skill`, `severity: nit`)

### 4. CLAUDE.md reference audit (cites RULES.md §A)

Find all `CLAUDE.md` files:

```bash
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*"
```

For each file, find `@`-prefixed includes (e.g., `@construct/core/CLAUDE.md`, `@path/to/file.md`) and verify each referenced path resolves. A broken include silently omits rules — Claude never loads them and gives no error. (RULES.md §A.1, `tag: broken-include`, `severity: important`)

Walk the include graph for cycles (RULES.md §A.2). Check for duplicate rule content across CLAUDE.md layers (RULES.md §A.3, `tag: duplicate-rule`).

### 5. MCP + permission audit (cites RULES.md §D, §E)

Walk `.claude/settings.json`:

- For each `mcpServers.<name>.command`, verify the executable resolves (RULES.md §D.1, `tag: dead-mcp`).
- For each `mcpServers.<name>.args`, scan for literal secrets (RULES.md §D.2, `tag: secret`, `severity: blocking`).
- For each `permissions.allow` entry, flag `Bash(*)` or equivalent unrestricted patterns (RULES.md §E.1, `tag: overbroad-permission`).

### 6. Apply negative-filter list

Per `src/skills/_shared/finding.md` and RULES.md "Negative-filter list":

- Style preferences not in `config/RULES.md` → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues" SARIF run
- Issues agnix already covers → cite the agnix rule (don't duplicate)
- Pedantic nitpicks → drop
- Lint-ignored entries → drop

### 7. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "config-audit"`. Each `result`:

```json
{
  "ruleId": "config/RULES.md#<section>.<n>" | "agnix/<rule-id>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete remediation — script path, registry entry, or `agnix --fix-safe` flag>",
    "tag": "dead-hook" | "dead-output" | "double-fire" | "silent-fail" | "broken-include" | "duplicate-rule" | "dead-skill" | "orphaned-skill" | "naming" | "routing-collision" | "dead-mcp" | "secret" | "overbroad-permission" | "agnix" | "agnix-autofix" | "observability",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

Praise rarely qualifies — surface hooks that exemplify defensive practice (try/catch around stdin parse with non-zero exit, full output→consumer chains, complete trace() calls) only when they could serve as a reference for peers in the same scope.

### 8. Emit a phased prose summary

After the SARIF block, output a phased report with the table-rich detail the legacy config-audit produced:

```
# Config Audit — <project>

## Summary
agnix: N errors, N warnings (N auto-fixable)
Hooks: N live · N partial · N advisory · N dead · N broken
Skills: N valid · N missing files · N orphaned
CLAUDE.md refs: N broken
MCP: N dead, N with secrets in args
Permissions: N overbroad

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X)

## important (N)
- ...

## nit (N)
- ...

## Hook detail

| Hook | Event | stdout | stderr | Exit | Files written | Consumed by | Observability | Verdict |
|------|-------|--------|--------|------|---------------|-------------|---------------|---------|
| ... | ... | ... | ... | ... | ... | ... | ... | LIVE/PARTIAL/DEAD/ADVISORY/BROKEN |

### Hook pairs
| Writer | Reader | Shared file/signal | Handoff timing |
|--------|--------|---------------------|-----------------|
| ... | ... | ... | ... |

## Skills detail

| Skill | Registry | SKILL.md | Name match | Verdict |
|-------|----------|----------|------------|---------|
| ... | ✓/✗ | ✓/✗ | ✓/✗ | OK / orphaned / dead / mismatch |

## Pre-existing issues (out of scope)
- ...
```

The omnibus reads the SARIF; humans read the prose tables.

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`. Bash for `which`, `find`, `grep`, `agnix --dry-run`, and JSON parsing only.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating; there's no `config-fix` to trigger one.
- **Don't duplicate agnix.** If agnix already flagged it, cite the agnix rule and pass through — don't write a parallel finding.

## Output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Config Audit — <project>
<phased prose + detail tables>
```

When invoked by the omnibus, return the SARIF as the structured result; the omnibus assembles the cross-domain phased report.

After presenting the prose report, prompt: *"Want me to apply the agnix auto-fixes (`agnix --fix-safe .`) or address any of these manually?"* — the user decides on autofix; this skill does not apply changes itself.

## Guardrails

- **Confidence is provisional.** Omnibus validation refines it.
- **Cite rules precisely.** Every finding includes `config/RULES.md#<section>.<n>` or `agnix/<rule-id>`. No bare prose accusations.
- **Don't double-report.** agnix findings pass through; config-audit's own rules cover what agnix doesn't.
- **Hook output tracing is the highest-leverage check** — dead outputs accumulate as load-bearing maintenance burden.

## Cross-references

- Rule source: `src/rules/config/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- agnix project: https://github.com/agnix-rules/agnix (385+ structural rules for CLAUDE.md / hooks / agents / MCP)
- Verification gate table: `VERIFICATION.md` (this skill has no gate — audit-only)
