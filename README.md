# aleph-next — Phase 1 spine

Chris's personal AI operating system: a TypeScript daemon hosting a
Claude-Agent-SDK agent, with Telegram + CLI channels, topic-based long-lived
sessions, an Obsidian vault as memory, an append-only event log, and OTel →
self-hosted Langfuse. Successor to [`crsmithdev/aleph`](https://github.com/crsmithdev/aleph).

**This repository currently contains Phase 1 only** — the spine described in
`docs/design/phase-1.md`. Heartbeat, capture, librarian, approvals, the
verification kernel, the cockpit and research are Phases 2–4 and are *not* here.

## Quick start

```bash
bun install
cp .env.example .env                       # names only; fill in what you use
bun src/cli/os.ts vault init --dir ./vault
bun src/cli/os.ts doctor                   # every precondition, one line each
bun src/daemon.ts &
bun src/cli/os.ts send "hello"
```

`config/aleph.toml` is the committed default; per-host overrides go in
`config/hosts/<hostname>.toml`; secrets are `${ENV_VAR}` references resolved from
the process environment at boot, and an unresolved one is a boot failure rather
than an empty string.

## What is verified, and what is not

Claims here are backed by observed output in **`docs/RUNBOOK-phase1-slice.md`**.
Anything not in that file is unproven.

**Verified by running it:** daemon boot/shutdown, on the host and in the
container from `compose/daemon.yml` with the §10.3 mount plan probed; the full caused event chain for
a turn; a real Agent SDK turn answering from a resumed session; one message → one
joined trace tree with the event log's `trace_id` equal to the trace **fetched
back out of a self-hosted Langfuse**, deep link included; the same SDK turn and
resume running inside the container from `compose/daemon.yml`;
SQLite index rebuildable from JSONL; window meter moving on real usage; the
starvation ladder refusing a background lane above the reserve while interactive
flows; vault prohibitions refusing writes to `human/`, `VAULT.md` and over-budget
`MEMORY.md`; Telegram topic creation, binding, authorization, 429 handling and
offset durability across a restart — against a real fake Bot API server, and
then against a real bot and a real forum group, including a phone-sent message
driving a full turn and an unauthorized sender being refused.

**Not verified:** operation over days (the soak started 2026-08-21T20:05Z);
rehydration of a week-old topic, which is a judgement for Chris and is due
2026-08-28.

CI runs unit + integration. A green badge does not mean the live paths work; the
workflow says so out loud in its last step.

## Layout

| Path | What |
|---|---|
| `src/core/` | ids, clock, config, event envelope + kind registry, `emit()`, event log, bus, meter |
| `src/obs/` | OTel provider, Langfuse attribute mapping, join audit |
| `src/sessions/` | store, lifecycle (resume vs rehydrate), SDK + echo runners, `session-brief.md` |
| `src/channels/` | Telegram forum-topic adapter, CLI socket channel |
| `src/vault/` | bootstrap, write path, git, templates |
| `src/routing/` | tier table, class ceilings, ±1 flex, escalation |
| `src/daemon.ts` | composition root |
| `src/cli/os.ts` | the `os` CLI |
| `docs/design/phase-1.md` | the design this implements |
| `docs/EVENTS.md` | generated from the kind registry |
| `docs/RUNBOOK-phase1-slice.md` | observed output |

## Commands

```bash
bun test                        # unit + integration (real files, sockets, subprocesses)
bun test tests/unit
bun test tests/integration
ALEPH_LIVE=1 bun test tests/live    # real SDK / Telegram / Langfuse; spends real usage
bun run typecheck
bun run docs:check              # EVENTS.md fresh, configs valid, design doc file refs real
bun scripts/gen-events-doc.ts   # regenerate docs/EVENTS.md
bun scripts/otlp-sink.ts 4318 /tmp/spans.jsonl   # stand-in for Langfuse
```

## Running it as a service

The soak on `Lightbox2` runs under a systemd **user** unit with lingering
enabled, so it survives logout and reboot:

```ini
# ~/.config/systemd/user/aleph-next.service
[Service]
WorkingDirectory=/home/crsmi/aleph-next
EnvironmentFile=/home/crsmi/aleph-next/.env
Environment=PATH=/home/crsmi/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/crsmi/.bun/bin/bun src/daemon.ts
KillSignal=SIGTERM
TimeoutStopSec=180          # shutdown_grace_seconds is 120
Restart=on-failure
```

```bash
loginctl enable-linger "$USER"
systemctl --user enable --now aleph-next
```

Runtime state lives outside the checkout — `~/.local/share/aleph-next/{data,vault}`
— so a `git clean` or a worktree cannot take the event log with it. Host paths,
Telegram and the Langfuse ingestion header come from
`config/hosts/<hostname>.toml`, which is gitignored and which the loader picks up
by hostname with no flag.

`TimeoutStopSec` must exceed `daemon.shutdown_grace_seconds` or systemd will
SIGKILL a daemon that is still draining the bus.

## Phase 1 security posture

The agent has **no tools** (`allowedTools: []`) and no egress. It reads what the
daemon puts in its prompt and returns text; the daemon performs every side
effect on paths it chooses. That is why the approval broker can wait for Phase
2a without leaving a hole: there is no path from a message to a shell command, an
arbitrary file write, or an outbound request. Inbound Telegram messages are
checked twice (chat *and* sender). Event payloads pass a redaction filter before
they are written. The socket is 0600. Nothing binds a public interface.

## Open questions for Chris

The §16.4 confirmations are **settled** as of 2026-08-21 — timezone
`America/Los_Angeles`, briefs at 07:00 daily and 18:00 Sunday, 30 % / 25 %
reserves, Bun, TOML, and archiving *closes* a Telegram topic rather than
deleting it.

What remains open is not a question but a measurement: the window capacity
numbers in `config/aleph.toml` are estimates and will be wrong until real
`meter.window_exhausted` events calibrate them. `docs/design/phase-1.md` §16.1–3
carries the other two standing risks — forum-topic bindings desyncing, and
rehydration quality across the 24 h boundary.
