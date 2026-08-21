# aleph-next — agent entry point

Phase 1 spine of Chris's personal AI OS. Bun + TypeScript, one daemon process.
Read `docs/design/phase-1.md` first; it is the specification this code implements
and it is more detailed than this file.

## The rule that matters

**Never claim something works without having run it and observed the output.**
This repository *is* the machinery for enforcing that rule elsewhere; building it
sloppily would be self-refuting. `docs/RUNBOOK-phase1-slice.md` is the evidence
file — if a claim is not backed there or by a test, it is unproven, and saying
"unproven" is always available.

## Where things are

| Path | Contents |
|---|---|
| `src/platform/` | the only Bun-specific code (`bun:sqlite`, migrations) |
| `src/core/` | ids, clock, config, envelope + kind registry, `emit()`, event log, bus, meter |
| `src/obs/` | OTel, Langfuse mapping, join audit |
| `src/sessions/` | store, lifecycle, runners, brief |
| `src/channels/` | telegram/, cli/ |
| `src/vault/` | bootstrap, writer, git, templates |
| `src/routing/` | router |
| `src/daemon.ts` | composition root — nothing imports it |
| `src/cli/os.ts` | CLI |

## Invariants — breaking one is a defect, not a style choice

1. **`emit()` is the only way an event is created.** It fans out to the JSONL,
   the SQLite index and OTel in one call (cockpit-spec F7). Never write an
   envelope by hand, never open a span without emitting.
2. **The JSONL is the ground truth; the `events` table is a derived index.**
   `os events reindex` must always be able to rebuild it. Do not put anything in
   the table that is not in the line.
3. **`caused_by` and `cause` are mandatory.** A root event uses `caused_by: null`
   and a `cause.kind` of `user` or `computed`. Kernel-computed causes are written
   by code; a model never authors a cause. `self-reported` is for text that
   already exists in a transcript, captured at zero marginal cost.
4. **The tuple's `trace_id` is the Langfuse trace.** Spans open under
   `remoteParentContext(trace_id)` (`src/core/tracectx.ts`). If you start a span
   without it, the deep link rots and the join audit will tell you.
5. **`session_id` is present iff `origin === "channel"`.** No pseudo-sessions for
   background work.
6. **All side effects on the vault go through `VaultWriter`.** It refuses rather
   than sanitizes.
7. **Adapters normalize and hand off.** No session resolution, routing or vault
   access inside `src/channels/`.
8. **Lane admission is enforced in exactly three places** (`bus.submit`,
   `meter.record`, the daemon tick). A fourth is a bug.

## Adding an event kind

1. Add it to `KINDS` in `src/core/envelope.ts` with a Zod payload schema.
2. `bun scripts/gen-events-doc.ts` (CI fails if `docs/EVENTS.md` is stale).
3. Emit it with a real `cause` and a real `caused_by`.

## Verifying a change

See `docs/VERIFICATION.md` for the gate table. The short form: `bun run
typecheck && bun run docs:check && bun test`. If the change touches a channel,
the SDK runner, or observability export, that is *not* sufficient — run the
matching `tests/live` gate and say so, or say explicitly that you did not.

## What not to do

- Do not import `daemon.ts` from anywhere (a test enforces it).
- Do not use `bun:sqlite` outside `src/platform/` (a test enforces it).
- Do not call `Date.now()` outside `src/core/clock.ts` — the resume/rehydrate
  boundaries are clock arithmetic and tests advance a fake clock.
- Do not give the Phase 1 agent tools or egress. That posture is what makes the
  missing approval broker safe.
- Do not add a lane producer without adding its lane to the ladder config.
