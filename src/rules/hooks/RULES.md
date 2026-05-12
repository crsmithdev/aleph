# Hooks Rules

Authoritative rules for Claude Code hooks under `src/core/hooks/` and their registration in `settings-hooks.json`. Read by `hooks-audit` and applied by `hooks-author`.

**Status: stub.** Will be populated in Phase 6. Hooks domain is largely net-new; today's checks live partially in `config-audit` Phase 2.

## Planned sections

- **A. stdin safety** — `try`/`catch` around `JSON.parse(await Bun.stdin.text())`; exit 1 with stderr on malformed
- **B. Trace** — every hook calls `trace()` from `src/trace.ts` with at least `{event, sessionId}`
- **C. Exit codes** — `0` (continue) / `1` (internal error) / `2` (block, PreToolUse only); explicit `process.exit()` at every return path; no implicit 0
- **D. stdout discipline** — advisory text only when meaningful; no empty writes
- **E. File outputs** — every `writeFileSync` target must have a grep-visible consumer in another hook or the observability UI
- **F. Pair contracts** — writer→reader pairs (e.g., PreCompact → SessionStart) must use typed JSON when shared across session boundaries
- **G. Registration** — every script referenced by `settings-hooks.json` exists; every event/matcher pair is unique
- **H. No silent failure** — every error path either exits non-zero or writes to stderr with a clear message
