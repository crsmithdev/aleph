---
name: hooks-audit
description: >
  Audit Claude Code hooks under `src/core/hooks/` against `src/rules/hooks/RULES.md`
  — stdin safety, tracing, exit codes, stdout/stderr discipline, file output
  consumers, pair contracts, registration integrity, and silent-failure
  prevention. Emits SARIF findings (per `src/skills/_shared/finding.md`) plus
  a phased prose report. Read-only — no edits. Triggers on "audit hooks",
  "check hook safety", "find dead hook outputs", "audit my hooks",
  "/hooks-audit", "/audit hooks", or when the omnibus dispatches the audit
  verb to the hooks domain. Narrower focus than `config-audit` (which covers
  the full agent setup); use this when you only care about the hook scripts
  themselves.
verb: audit
domain: hooks
modes: [report]
metadata:
  argument-hint: <hook-file-or-dir>
---

# Hooks Audit

Walks hook scripts in scope, evaluates each rule in `src/rules/hooks/RULES.md`, and emits SARIF findings. Focused subset of `config-audit` — runs the same hook semantic checks (output tracing, dead output detection, stdin safety, pair contracts) without the surrounding CLAUDE.md / skills-registry / MCP / permission audits.

Pure leaf: no `Skill()` calls. The omnibus chains us; we report.

## When to use

- User asks to audit just the hooks (not the whole agent setup).
- User invokes `/hooks-audit`, or the omnibus dispatches the `audit` verb to the `hooks` domain.
- Faster, narrower alternative to `config-audit` when only the hook scripts are interesting.

## When NOT to use

- Full agent-config health check (CLAUDE.md @-includes, MCP, skills registry, permissions) → `config-audit`.
- General code quality → `code-audit`.
- Security vulnerabilities in hooks (secrets, command injection in hook scripts) → `security-audit` (with the hooks files in scope).

## Inputs

1. **Scope** (default: smart) — `--diff` against `origin/main`, `--module <path>`, `--all`. Default `--all` includes every hook script registered + every file under `src/core/hooks/`.
2. **Threshold** (optional) — confidence floor 0-100; default 80 per `omnibus.yml`.

## Process

### 1. Run agnix structural lint

Before the semantic walk, run agnix against the hooks registry and related config files to collect structural findings. agnix covers the CC-HK-* family (Claude Code hook rules):

```bash
agnix --target claude-code --format sarif src/core/hooks/ .claude/settings.json 2>&1
```

Collect all errors and warnings. Mark fixable ones `[fixable]`. Pass them through in the SARIF output citing `agnix/CC-HK-<n>` rule IDs — don't re-report them under your own ruleIds.

### 2. Resolve scope

```bash
# --diff (against origin/main, conventional default)
git diff --name-only origin/main...HEAD -- 'src/core/hooks/**/*.ts' 'src/core/hooks/settings-hooks.json' '.claude/settings.json'

# --module <path>
find <path> -name '*.ts' -not -path '*/node_modules/*'

# --all (default — every registered hook script)
# Parse src/core/hooks/settings-hooks.json + .claude/settings.json hooks array;
# resolve every `command` field to its script path.
```

**Smart default:** try `--diff` first. If empty, fall back to `--all` (this domain has a small, stable set of files — auditing all of them is cheap).

### 3. Walk the rules

For each in-scope hook script, evaluate every section A through H in `src/rules/hooks/RULES.md`. Concrete high-value checks:

- **A.1 (stdin try/catch):** find `JSON.parse(await Bun.stdin.text())` and verify it's wrapped in try/catch with a non-zero exit in the catch path.
- **B.1 (trace call):** confirm `trace(` appears at least once before every `process.exit` path.
- **C.1 (explicit exit):** flag hook scripts whose top-level main path doesn't call `process.exit(...)` explicitly.
- **C.2/C.3 (exit code values + PreToolUse only):** confirm `process.exit(N)` uses `N ∈ {0, 1, 2}` and `exit(2)` only appears on PreToolUse-registered hooks.
- **D.1 (stdout slop):** flag `console.log('')` and similar empty writes.
- **D.2 (stderr on non-zero exit):** flag `process.exit(1|2)` calls without a preceding `console.error` / `process.stderr.write`.
- **E.1 (dead outputs):** for each `writeFileSync` / `appendFileSync` / `reportHook` target, grep `src/` for a consumer; flag if zero.
- **E.3 (PII / secrets in outputs):** scan written payloads for field names matching `password|token|apiKey|secret|authorization`; cross-reference `security/RULES.md#C.1` patterns.
- **F.1 (untyped pair contracts):** identify writer-reader hook pairs and check for shared type imports / schema files.
- **G.1 (dead hook registration):** for each entry in the registries, confirm the script file exists.
- **G.2 (event/matcher uniqueness):** flag duplicate `(event, matcher)` pairs.
- **G.3 (cross-registry double registration):** flag same command path appearing in both `.claude/settings.json` and `src/core/hooks/settings-hooks.json`.
- **H.1 (silent catch):** flag catch blocks without log / exit / re-throw.
- **I.1 (unused-hook):** for each registered hook, `grep "\"hook\":\"<name>\"" ~/.construct/signals/hook-events.jsonl | wc -l`; zero hits AND creation > 5 sessions ago (git log) = `suggestion` `unused-hook`; include the registered event type in the finding so the reader knows what was expected to trigger it
- **I.2 (writer fires, reader never does):** for each writer-reader pair identified in F.1/F.2, check `hook-events.jsonl` for the writer's entries; if writer entries exist but the reader's name never appears in subsequent entries within the same `sessionId`, flag as `important` `dead-output`

For rules whose Detect signal doesn't apply to a given hook (e.g., F.1 on a hook with no file outputs), skip silently.

### 4. Apply negative-filter list

Per `src/rules/hooks/RULES.md` + `src/skills/_shared/finding.md`:

- Style preferences not in `hooks/RULES.md` → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues"
- Issues agnix CC-HK-* covers → cite agnix's rule, pass through
- Pedantic nitpicks → drop
- Linter-catchable → cite the linter, mark `severity: nit`
- Lint-ignored lines → drop

### 5. Emit SARIF

Single SARIF v2.1.0 run, `tool.driver.name = "hooks-audit"`. Each `result`:

```json
{
  "ruleId": "hooks/RULES.md#<section>.<n>" | "agnix/CC-HK-<n>",
  "level": "error" | "warning" | "note",
  "message": { "text": "<one-line description>" },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "..." }, "region": { "startLine": N, "endLine": N } } }],
  "properties": {
    "confidence": 0,
    "severity": "blocking" | "important" | "nit" | "suggestion" | "praise",
    "fix": "<concrete remediation>",
    "tag": "silent-fail" | "observability" | "correctness" | "slop" | "dead-output" | "pii" | "pair-contract" | "dead-hook" | "double-fire" | "unused-hook",
    "scope": "diff" | "module" | "all"
  }
}
```

`confidence` is provisional; the omnibus validation pass refines it.

Praise rarely qualifies for hooks — but specifically surface hooks that demonstrate the full pattern (try/catch around stdin parse, trace() call, every output has a consumer, explicit exits with stderr context). Mark them `severity: praise`, `tag: defense-in-depth`, with a `fix` like "use as reference for: hook structural pattern".

### 6. Emit a phased prose summary

After the SARIF block:

```
# Hooks Audit — <scope>

## Summary
N hooks audited · N live · N partial · N dead · N broken
Pairs: N typed · N untyped

## blocking (N)
- <file:line> — <rule> — <one-line> (confidence X)

## important (N)
- ...

## nit (N)
- ...

## Hook detail

| Hook | Event | Files written | Consumed by | trace() | Verdict |
|------|-------|---------------|-------------|---------|---------|
| ... | ... | ... | ... | ✓/✗ | LIVE / PARTIAL / DEAD / BROKEN / ADVISORY |

### Hook pairs
| Writer | Reader | Shared file | Handoff | Typed? |
|--------|--------|-------------|---------|--------|
| ... | ... | ... | ... | ✓/✗ |

## Pre-existing issues (out of scope)
- ...
```

The omnibus reads the SARIF; humans read the prose tables.

## Scope discipline

- **Read-only.** No `Edit`, `Write`, or mutating `Bash`. Bash for `find`, `grep`, JSON parsing only.
- **No `Skill()` calls.** The omnibus chains; we audit.
- **No verification gate.** Audit is non-mutating; no `hooks-fix` leaf yet.
- **Don't duplicate config-audit.** `config-audit` covers the same hook checks plus CLAUDE.md / skills / MCP / permissions. Use `hooks-audit` only when scope is hooks-only.

## Output template

```
[sarif]
{ ... SARIF v2.1.0 ... }
[/sarif]

# Hooks Audit — <scope>
<phased prose + detail tables>
```

When invoked by the omnibus, return the SARIF as the structured result.

## Guardrails

- **Confidence is provisional.** Omnibus validation refines it.
- **Cite rules precisely.** Every finding includes `hooks/RULES.md#<section>.<n>` or `agnix/CC-HK-<n>`. No bare prose accusations.
- **Silent-fail rules are the highest-leverage** — a hook that crashes silently breaks Claude Code's signal-to-noise without ever surfacing the cause.
- **Dead outputs accumulate** — flagging them early prevents load-bearing maintenance burden later.

## Cross-references

- Rule source: `src/rules/hooks/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Broader audit: `src/skills/config-audit/SKILL.md` (hooks + skills + CLAUDE.md + MCP + permissions in one pass)
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Trace helper: `src/trace.ts`
