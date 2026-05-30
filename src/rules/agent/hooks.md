# Hooks Rules

Authoritative rules for Claude Code hooks under `src/core/hooks/` (and equivalent paths in non-Aleph projects) plus their registration in `settings-hooks.json` / `.claude/settings.json`. Read by:

- `src/skills/hooks-audit/SKILL.md` — flags violations in existing hooks (post-hoc)
- CLAUDE.md (project-local + global) — applies these rules silently at write-time

Every rule is **checkable**: it can be evaluated against a real hook script and produce a plain-markdown finding citing this file's section anchor. Many rules overlap with `config/RULES.md` §B — that section is the cross-cutting view; this file is the hook-internals view.

Scope: `src/core/hooks/*.ts` plus any script referenced from a hook registry (`settings-hooks.json`, `.claude/settings.json` `hooks` array). Shared hook helpers (`src/trace.ts`, `src/reportHook.ts`, etc.) count when consumed by hooks.

---

## A. stdin safety

*Sources: Aleph CLAUDE.md "Commandments" §1 (nothing fails silently), `src/skills/code-audit/SKILL.md` H.1.*

### A.1 Wrap stdin JSON parse in try/catch with non-zero exit on failure

Every hook reads JSON from `await Bun.stdin.text()`. A bare `JSON.parse` throws on malformed input — the hook crashes silently and Claude Code never knows why.

- **Detect:** hook scripts containing `JSON.parse(await Bun.stdin.text())` (or equivalent) outside a try/catch whose catch path calls `process.exit(N)` with `N !== 0`
- **Severity:** `important`
- **Tag:** `silent-fail`

### A.2 stdin readers handle empty input

A hook fired with no payload (some event types pass empty) must not assume stdin has content. Empty input is a valid state.

- **Detect:** stdin reader code that uses the parsed result without first checking `Object.keys(parsed).length` or similar
- **Severity:** `nit`
- **Tag:** `silent-fail`

---

## B. Tracing

*Sources: `src/trace.ts`, Aleph CLAUDE.md "Avoiding duplication".*

### B.1 Every hook calls `trace()` at completion

Aleph hooks must call `trace()` (from `src/trace.ts`) before exiting. Hooks that skip tracing become invisible to the observability UI and to any post-hoc eval harness.

- **Detect:** hook scripts under `src/core/hooks/` without a `trace(` call before any `process.exit` path
- **Severity:** `important`
- **Tag:** `observability`

### B.2 trace() includes at minimum `{event, sessionId}`

The trace payload's base fields are required for cross-hook correlation. Hooks may add domain-specific fields (`decision`, `tier`, `detail`) on top.

- **Detect:** `trace(...)` calls whose first argument doesn't include both `event` and `sessionId` keys (or `event` only when sessionId is unavailable at that lifecycle point)
- **Severity:** `nit`
- **Tag:** `observability`

---

## C. Exit codes

*Sources: Claude Code hooks spec; Aleph CLAUDE.md "Commandments" §1.*

### C.1 Every return path has an explicit `process.exit(N)`

Hooks without an explicit `process.exit` fall off the end and implicitly exit 0. For advisory hooks that's OK; for hooks with branching logic, implicit exit can mask a failed code path that should have exited 1.

- **Detect:** hook scripts whose top-level function or main path has at least one branch that doesn't reach a `process.exit(...)` call (heuristic — flag functions ending without exit when other branches have one)
- **Severity:** `nit`
- **Tag:** `silent-fail`

### C.2 Exit codes use the spec values

`0` = continue; `1` = internal error (write to stderr); `2` = block (PreToolUse only — prevents the tool call). Any other code is undefined behavior.

- **Detect:** `process.exit(N)` with `N` outside `{0, 1, 2}`
- **Severity:** `important`
- **Tag:** `correctness`

### C.3 Exit code 2 only on PreToolUse hooks

`exit 2` blocks the tool call — meaningless on `Stop` / `PostToolUse` / `SessionStart` etc. Using it on the wrong event is a bug.

- **Detect:** `process.exit(2)` in a hook registered to an event other than `PreToolUse`
- **Severity:** `important`
- **Tag:** `correctness`

---

## D. Stdout / stderr discipline

*Sources: Claude Code hooks spec; Aleph CLAUDE.md "Testing Philosophy".*

### D.1 stdout only carries advisory text Claude should read

Empty stdout writes (`console.log('')`, `process.stdout.write('')`) are noise. Don't print unless there's a meaningful message.

- **Detect:** `console.log('')` / `console.log()` / `process.stdout.write('')` calls
- **Severity:** `nit`
- **Tag:** `slop`

### D.2 stderr carries hard-block reasons or error text

When a hook exits non-zero, stderr should contain enough text for the user to act on. Silent non-zero exits are a debugging nightmare.

- **Detect:** `process.exit(1)` / `process.exit(2)` calls without a preceding `console.error` / `process.stderr.write` in the same branch
- **Severity:** `important`
- **Tag:** `silent-fail`

---

## E. File outputs

*Sources: `src/skills/config-audit/SKILL.md` Phase 2b (legacy semantic audit).*

### E.1 Every `writeFileSync` target has a consumer

A hook writing to `signals/<file>.jsonl`, `~/.aleph/<file>`, or similar must have at least one grep-visible reader (in another hook, an API route, or the observability UI). A file nothing reads is dead output — maintenance burden with no payoff.

- **Detect:** for each `writeFileSync` / `appendFileSync` / `reportHook` target in a hook script, grep `src/` for a reader; flag if zero
- **Severity:** `important`
- **Tag:** `dead-output`

### E.2 Output directories exist or are created with `mkdirSync({recursive: true})`

Writing to a path whose parent directory doesn't exist throws — silently crashes the hook.

- **Detect:** `writeFileSync` calls whose target path has a parent directory created elsewhere AND no `mkdirSync({ recursive: true })` precedes it
- **Severity:** `nit`
- **Tag:** `silent-fail`

### E.3 No PII / secret values in hook outputs

Hooks logging or storing `req.body` / env values / parsed-prompt content must not write password fields, token fields, or PII to files that aren't access-controlled.

- **Detect:** `writeFileSync` / `appendFileSync` calls whose payload includes field names matching `password|token|apiKey|secret|authorization` (or values matching secret patterns from `security/RULES.md` §C.1)
- **Severity:** `blocking`
- **Tag:** `pii`

---

## F. Pair contracts

*Sources: cross-session hook chains documented in Aleph README hook table.*

### F.1 Writer-reader pairs use a typed shape

When a hook writes a file that another hook reads later (same session or across session via `/compact` or `SessionStart`), the on-disk shape should be either a documented JSON schema or a shared TypeScript type imported by both ends. Untyped JSON breaks silently when either side drifts.

- **Detect:** pairs where the writer hook serializes `JSON.stringify(<expr>)` and the reader parses `JSON.parse(...)` with no shared type import / no schema file alongside
- **Severity:** `nit`
- **Tag:** `pair-contract`

### F.2 Pair handoff timing is documented

Hook pairs that span session boundaries (e.g., PreCompact → SessionStart) should have a comment on the writer noting the expected reader and the timing (next session vs. same session). Undocumented pairs rot quickly.

- **Detect:** `writeFileSync` / `appendFileSync` calls whose target path is read by a hook in a different lifecycle event, without a comment on either side referencing the pair
- **Severity:** `nit`
- **Tag:** `pair-contract`

---

## G. Registration

*Sources: `src/core/hooks/settings-hooks.json` (Aleph), `.claude/settings.json` `hooks` array (standard).*

### G.1 Every script referenced by the registry exists

A hook entry pointing at a script that doesn't exist silently fires nothing.

- **Detect:** for each hook entry's `command` path, resolve relative to the registry; flag missing files
- **Severity:** `blocking`
- **Tag:** `dead-hook`

### G.2 (event, matcher) pairs are unique

Two hooks registered for the same event with the same matcher fire in registration order. Usually this is unintended duplication.

- **Detect:** same `(event, matcher)` appearing in two registry entries; flag both
- **Severity:** `important`
- **Tag:** `double-fire`

### G.3 No hook registered in both `.claude/settings.json` and `src/core/hooks/settings-hooks.json`

Double registration across the project / Aleph hook registries fires the hook twice. Aleph hooks belong in `src/core/hooks/`, not `.claude/settings.json` (per Aleph CLAUDE.md "Avoiding duplication").

- **Detect:** same hook command path appearing in both files
- **Severity:** `important`
- **Tag:** `double-fire`

---

## H. No silent failure

*Sources: Aleph CLAUDE.md "Commandments" §1 ("Nothing may fail silently").*

### H.1 Every error path either exits non-zero or writes to stderr

A caught exception that's neither logged nor exited becomes invisible. The Stop hook is especially prone to this — fails to write its summary, Claude moves on, no signal anywhere.

- **Detect:** catch blocks in hooks that contain no `console.error` / `process.stderr.write` / `process.exit(N !== 0)` / `trace({error: ...})` call
- **Severity:** `important`
- **Tag:** `silent-fail`

### H.2 Shared helpers (`reportHook`, etc.) handle their own errors

Helpers called by hooks must not throw silently. If a helper fails, the calling hook should be able to detect it (via return value or thrown error).

- **Detect:** functions in `src/reportHook.ts` / `src/trace.ts` / similar with try/catch blocks whose catch paths do not re-throw, log, or return a tagged failure
- **Severity:** `important`
- **Tag:** `silent-fail`

---

## I. Usage signals

*Sources: `~/.aleph/signals/hook-events.jsonl` (field: `hook`). Each hook reports via `reportHook()`, so absence from the log is a meaningful signal — not just missing data.*

### I.1 Hook fires at least once in recent sessions

A hook registered and deployed but absent from `hook-events.jsonl` across the last 20 sessions either has a broken event matcher, fires for events that never occur in practice, or is legacy — registered but never cleaned up.

- **Detect:** for each hook's registered name (from `settings-hooks.json`), `grep "\"hook\":\"<name>\"" ~/.aleph/signals/hook-events.jsonl | wc -l`; zero lines AND the hook is older than 5 sessions (check git log creation date) = suspect; flag with the registered event type so the reader knows what conditions were expected to fire it
- **Severity:** `suggestion`
- **Tag:** `unused-hook`

### I.2 Hook pair reader sees output from its writer

For hook pairs (writer fires in one lifecycle, reader picks up the file in a later one), verify the reader-side hook has actually executed after the writer in the session log. A writer with trace events but no corresponding reader trace events suggests the reader is broken, registered incorrectly, or consuming a stale path.

- **Detect:** identify writer-reader pairs (from F.1/F.2 analysis); for each, check `hook-events.jsonl` for the writer's entries followed by the reader's entries within the same `sessionId`; flag pairs where the writer fires but the reader never does
- **Severity:** `important`
- **Tag:** `dead-output`

---

## Negative-filter list (uniform with other review leaves)

- Style preferences not in this file → drop
- Pre-existing issues outside scope → record under "Pre-existing Issues"
- Pedantic nitpicks → drop
- Issues a linter would catch — cite the linter
- Lint-ignored lines → drop

---

## Approval policy

At the leaf's approval gate, hook findings default to apply-all / pick / discard. Exceptions promoted to per-finding prompting:

- `tag: secret` — security-adjacent
- `tag: pii` — security-adjacent
