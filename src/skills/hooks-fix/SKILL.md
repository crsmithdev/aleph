---
name: hooks-fix
description: >
  Apply fixes for hooks-audit findings — wrap stdin parse in try/catch with
  non-zero exit (silent-fail), add trace() call (observability), set explicit
  exit codes, redirect non-zero exits through stderr, remove dead outputs or
  add consumers, add mkdirSync({recursive:true}) before writes, redact PII /
  secrets from logged payloads, add typed shapes to writer-reader pairs, fix
  registration (event/matcher uniqueness, cross-registry double-firing),
  catch-block logging. Takes SARIF findings from `hooks-audit` as input.
  Verifies with `gate("hooks")`.
  Triggers on "fix the hooks findings", "remediate hook silent-fails",
  "/hooks-fix", "/fix hooks", or when the omnibus dispatches the fix verb
  to the hooks domain after approval.
verb: fix
domain: hooks
modes: [fix]
---

# Hooks Fix

Applies edits derived from `hooks-audit` findings. Each finding's `properties.tag` routes to a fix shape; this skill executes the change minimally and verifies with `gate("hooks")`.

Pure leaf: no `Skill()` calls. The omnibus chains audit → approval → fix.

## When to use

- After `hooks-audit` produced findings and the user approved them.
- User invokes `/hooks-fix` against a saved SARIF report, or `/fix hooks` via the omnibus.

## When NOT to use

- General code fixes → `code-fix`.
- Skill-registry fixes → `skills-fix`.
- Agent-definition fixes → `agents-fix`.
- Authoring new hooks → that's just code; no author-mode skill yet.

## Inputs

1. **Findings** (required) — SARIF v2.1.0 from `hooks-audit`.
2. **Approvals** — per `omnibus.yml.by_domain.hooks` (single by default; `pii` / `secret` tags upgrade to per-finding).
3. **Scope** — inherited from findings.

## Process

### 1. Resolve findings

Parse SARIF; group by `properties.tag`.

### 2. Map tag → fix shape

| Tag | Fix shape | What it does |
|---|---|---|
| `silent-fail` (stdin parse) | Wrap in try/catch | Surround `JSON.parse(await Bun.stdin.text())` with try/catch; catch path writes to stderr and exits 1 |
| `silent-fail` (catch block) | Add log + exit | In the catch path, add `console.error(...)` describing the error and `process.exit(1)` (or `trace({error: ...})` + exit) |
| `silent-fail` (mkdir) | Add recursive mkdir | Insert `mkdirSync(dirname(path), { recursive: true })` before the `writeFileSync` |
| `silent-fail` (non-zero exit w/o stderr) | Add stderr write | Insert `console.error(...)` describing the block reason before the `process.exit(1\|2)` |
| `observability` (no trace) | Add trace() | Add a `trace({ event, sessionId, ...detail })` call before every exit path |
| `observability` (incomplete trace) | Add missing fields | Update the existing `trace(...)` call to include `event` and `sessionId` (or just `event` when sessionId isn't available at that lifecycle point) |
| `correctness` (exit code) | Replace with valid code | Replace `process.exit(N)` (N outside {0,1,2}) with the appropriate code per the spec |
| `correctness` (exit(2) on wrong event) | Replace exit(2) with exit(1) | If the hook is not PreToolUse, change exit(2) → exit(1); add explanatory stderr if missing |
| `slop` (empty stdout) | Delete the call | Remove `console.log('')` / `console.log()` / `process.stdout.write('')` |
| `dead-output` | Add consumer OR remove output | If the output should be live: add the consumer (often another hook or the observability UI). If the output is genuinely unused: delete the write call. Surface as a per-finding decision — the user picks |
| `pii` (logged payload) | Redact | Add a redaction helper wrapping the payload before write; drop fields matching `password\|token\|apiKey\|secret\|authorization` |
| `pair-contract` (untyped) | Add shared type | Define a `types.ts` co-located with the writer; both writer and reader import the type; serialize/parse against it |
| `pair-contract` (undocumented) | Add comment | Add a brief comment on both the writer's and the reader's call sites referencing the pair and handoff timing |
| `dead-hook` | Restore script OR remove registration | If the script was renamed: update the `settings-hooks.json` command path. If the script is gone: remove the registry entry |
| `double-fire` (same registry) | Deduplicate | Remove the duplicate registry entry |
| `double-fire` (cross-registry) | Move to one registry | Per Construct CLAUDE.md "Avoiding duplication": remove from `.claude/settings.json`; keep in `src/core/hooks/settings-hooks.json` |

For findings without a clean tag mapping, treat `properties.fix` as the literal change.

### 3. Plan the edits

Compute the minimal `Edit` per finding. Group by file.

**Hard rules:**

- **Dead-output decisions are per-finding.** Never silently delete a file write — the absence of a consumer might mean a future feature is planned. Surface as a per-finding question.
- **Renaming hook scripts requires confirmation.** A rename invalidates the registry entry; the user must approve.
- **Removed code goes completely.** Per Commandment 7: no `// removed` markers, no orphan registry entries.
- **No scope creep.** Adjacent issues become new findings.
- **PII redaction is conservative.** Drop matching fields entirely; do not attempt to "mask partially" (introduces a leak surface).

### 4. Show the plan

Output the planned edits as a unified diff or per-file edit list.

### 5. Apply edits

Order:

1. **Stdin-safety wrappers first** (touches the top of every hook; lowest risk of conflict with other edits).
2. **Trace() additions** (uniform pattern; safe).
3. **Exit-code corrections + stderr writes** (per-branch; same file).
4. **Output / pair-contract changes** (may touch helper files; do these after intra-hook edits).
5. **Registry edits** (last; JSON file, validate immediately after each edit).
6. **Cross-file edits** (hook ↔ reader pair updates).

### 6. Verify

Run `gate("hooks")` from `VERIFICATION.md`. This confirms hook tests still pass.

Also inline:

- **JSON parses** — validate `settings-hooks.json` and `.claude/settings.json` after registry edits.
- **Re-run `hooks-audit --module <touched-files>`** — confirm the finding closed without introducing a new one.
- **`gate("code")`** — full test suite, catches cross-cutting regressions.

If a fix introduces a new finding, revert and surface the regression as a new finding.

### 7. Summarize

One paragraph: which findings were resolved, which hook files were touched, what new observability calls were added.

## Output

```
[plan]
... edit list, grouped by file (hook scripts, registries, helpers) ...
[/plan]

[applying]
... per-edit lines, including per-finding re-check ...
[/applying]

[verify]
scope:      <files edited>
method:     gate("hooks") + hooks-audit re-run on touched files + gate("code") + JSON.parse on registries
assertions: zero remaining hooks-audit findings in scope; hook tests pass; full test suite passes; both registries valid JSON
[/verify]

# Summary
- <N> findings resolved
- <M> hook files edited
- <P> traces added / silent-fails closed
- <K> findings skipped (with reasons)
```

## Guardrails

- **Verification is non-negotiable.** Four checks (gate("hooks") + audit-re-run + gate("code") + JSON valid) must show in the turn's tool output.
- **Approved findings only.**
- **PII redaction is conservative — drop, don't partially-mask.**
- **Dead-output deletions need explicit per-finding approval.** The absence of a consumer may be an in-flight feature.
- **No scope creep.** Adjacent issues are new findings.
- **No `Skill()` calls.** The omnibus dispatches; we apply.

## Cross-references

- Rule source: `src/rules/hooks/RULES.md`
- Finding contract: `src/skills/_shared/finding.md`
- Audit counterpart: `src/skills/hooks-audit/SKILL.md`
- Broader audit: `src/skills/config-audit/SKILL.md`
- Trace helper: `src/trace.ts`
- Orchestrator: `src/skills/omnibus/SKILL.md`
- Verification gate table: `VERIFICATION.md`
