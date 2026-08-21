# Verification gates

Per-domain verification commands, in the aleph tradition: skills and agents call
`gate("<domain>")` and the resolution happens **here**, never hardcoded at the
call site. When you change how a domain is verified, change this table and
nothing else.

Phase 1 seeds the table; the verification kernel that consumes it programmatically
is Phase 2b (`docs/design/phase-1.md` §1.2).

## Gates

| Domain | Gate command | Notes |
|---|---|---|
| `types` | `bun run typecheck` | Required for any `src/` or `tests/` change. Necessary, never sufficient. |
| `code` | `bun test tests/unit` | Pure logic: envelope, redaction, router, meter, ladder, config, boundaries. |
| `integration` | `bun test tests/integration` | Boots the real daemon binary as a subprocess and talks to its real socket; real OTLP sink; real fake Bot API server. Required for anything touching the daemon, channels, event log, vault or meter. |
| `docs` | `bun run docs:check` | `docs/EVENTS.md` matches the kind registry; both config files validate; every file named in the design doc's layout exists. |
| `live-sdk` | `ALEPH_LIVE=1 bun test tests/live/sdk.test.ts` | Real Agent SDK. **Required before claiming any change to `sdk-runner.ts` or session lifecycle works.** Spends real plan usage. |
| `live-telegram` | `ALEPH_LIVE=1 TELEGRAM_BOT_TOKEN=… bun test tests/live/telegram.test.ts` | Real bot, real forum group. Required before claiming a Telegram change works. |
| `live-langfuse` | `ALEPH_LIVE=1 LANGFUSE_PUBLIC_KEY=… bun test tests/live/langfuse.test.ts` | Proves *ingestion*, which the local sink cannot. Required before claiming an observability change works end to end. |
| `slice` | manual, recorded in `docs/RUNBOOK-phase1-slice.md` | The end-to-end demonstration. Update the runbook with real output when the slice changes. |

## Combined gates

1. `types` and `code` first — fast, fail early.
2. `integration` next.
3. `docs` in parallel with integration.
4. `live-*` only for the surface actually touched, and never in CI.

## What each claim requires

| Claim | Requires | Not sufficient |
|---|---|---|
| "the daemon works" | `integration` green | `typecheck` passing |
| "the SDK path works" | `live-sdk` green | the echo runner passing |
| "Telegram works" | `live-telegram` green | the fake Bot API server passing |
| "traces reach Langfuse" | `live-langfuse` green | spans arriving at the local OTLP sink |
| "the event schema is fine" | `code` + `docs` green | "it compiles" |
| "config change took effect" | the `routing.decided` / `daemon.config_loaded` event shows it | reading the TOML |

## Resolution semantics

- A gate for a domain that does not exist logs a warning and proceeds — a
  documented gap, not a feature.
- A gate that exits non-zero blocks the claim of done.
- A live gate that cannot run in the current environment (no bot, no Docker) is
  **not** a pass. Say it did not run.
