Using research-system-design.md as the reference, suggest features for the next version of research with the following goals and constraints:

# Scope
- Personal project, single-operator scale. No enterprise concerns (auth, multi-tenancy, SLAs, horizontal scaling).
- Capabilities and output quality broadly comparable to the comparator systems surveyed.

# AI as primary maintainer
- Code, tests, and docs are written and iterated on primarily by AI agents. Structure, naming, and conventions favor AI navigation: small modules, no clever indirection, no hidden state.
- Typed contracts end-to-end. Frontend and backend share types. API boundaries, database schema, and artifact payloads are all typed. AI agents navigate by types more reliably than by reading implementations.
- Behavior is code, tuning is config. (Matches the "templates ship as code, not as data" principle. AI maintenance changes one or the other, not both at once.)
- Workflows and behavior are documented well enough that an unfamiliar reader (human or AI) can understand them without reading the implementation.

# Architecture for change
- Adding or iterating on features post-MVP should not require a refactor.
- Module boundaries are explicit; cross-module coupling is visible from types alone.

# Verification
- The system is verified by exercising it through the UI the way a user would, end-to-end. Automated UI flows count; backend-only tests are necessary but not sufficient.
- New UI and UI changes follow the existing reference designs.
- Mockable LLM boundary: the system runs end-to-end against a fake or recorded LLM for tests and UI verification. Real model calls go through one provider abstraction. This is what makes "verify through the UI" cheap in CI.
- At least two full end-to-end tests run against real LLMs: one with the cheapest models that produce usable output (smoke / basic correctness), one with optimal selections (quality evaluation).

# Observability

**Live inspectability is essential, not optional.** The current system's Activity tab — a real-time view into a running search showing cycles, events, decisions, intermediate outputs, and errors as they happen — is what makes the system trustworthy and debuggable. A user watching a run unfold can see what the engine is doing right now, what it just decided, and what it's about to do next, without refreshing or opening dev tools. The new system must preserve this as a primary UI surface, not relegate it to a "debug" expander.

- The Activity-equivalent live view is a first-class UI surface in v1 — co-equal with the artifact view, not a power-user expander. It's the default live view of a running loop.
- Every discrete step — events, decisions, evaluations, intermediate outputs, errors — is written to a single event log, and that log streams to the UI in real time. The Activity view is the rendered form of this stream.
- The event log is also downloadable for offline debugging and replayable for post-hoc analysis.
- Telemetry feeds the UI by default: per-run performance, cost, and self-analytical metrics are visible without per-feature dashboard work. New features get observability essentially for free.
- Cost is a first-class observable: per-run, per-cycle, and per-feature cost are surfaced in the UI and in the event log.
- Failure modes have stable typed identifiers (e.g., `topic_drift`, `shape_mismatch`, `yield_collapse`), not free-form strings. The self-healing layer pattern-matches against these; the UI can filter by them.
- The system can answer "why did you spawn this branch / pick this source / stop here?" from the event log with the inputs that drove the decision.

# Self-managing and self-healing
- The system evaluates its own outputs against the design goals declared for each run (shape, coverage, intent alignment) and flags when they aren't met.
- Operational management is automatic where possible; manual intervention is the exception.
- Background work is event-triggered, not time-triggered. Monitors, cleanups, and periodic tasks fire in response to logged triggers. No opaque cron schedules. "What is the system doing right now?" is always answerable from the event log.

# Configurability

- Modes are named starting templates for the schedule artifact, not runtime config bundles. A mode at submit time selects which template constructs the initial schedule; after construction the schedule is what runs, and the mode label survives as metadata only.
- The schedule artifact is the **complete editable surface** for every per-loop setting (envelope, models, perturbation, run flags, canon, branches, milestones). The Schedule view in the UI is the universal editor — no separate "advanced" / "expert" / "power-user" panel exists or is needed.
- Per-run knobs are inferred from the question by default (`question_shape`, `output_shape`, `role`), exposed in the `InferredPanel` for manual tuning, and recorded in the event log when they take effect.
- Controls are always present in the UI regardless of mode. Mode affects default *prominence* of the Activity / Schedule / Artifact views, not their availability.
- User interventions during a run (pause-and-edit, free-form directives, fork-from-cycle) flow through one unified API as user-authored checks — same vocabulary as the system's own evaluation, remediation, and watcher mechanisms.

# Perturbation as a core mechanism
- The system takes non-deterministic leaps in how it answers, where it searches, and how it branches. Deliberate exploration is a primary engine behavior, not a defensive fallback — diversity of approach is a core feature.

# Forkable runs
- Any completed or paused run can be branched from any cycle to explore "what if the plan had been different here." Extends pause-and-edit with retrospective analysis. Mostly free if state is artifact-based.