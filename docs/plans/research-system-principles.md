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
- Every discrete step — events, decisions, evaluations, intermediate outputs, errors — is written to a single event log.
- The event log streams to the UI in real time (same pattern as the current system) and is downloadable for offline debugging.
- Telemetry feeds the UI by default: per-run performance, cost, and self-analytical metrics are visible without per-feature dashboard work. New features get observability essentially for free.
- Cost is a first-class observable: per-run, per-cycle, and per-feature cost are surfaced in the UI and in the event log.
- Failure modes have stable typed identifiers (e.g., `topic_drift`, `shape_mismatch`, `yield_collapse`), not free-form strings. The self-healing layer pattern-matches against these; the UI can filter by them.
- The system can answer "why did you spawn this branch / pick this source / stop here?" from the event log with the inputs that drove the decision.

# Self-managing and self-healing
- The system evaluates its own outputs against the design goals declared for each run (shape, coverage, intent alignment) and flags when they aren't met.
- Operational management is automatic where possible; manual intervention is the exception.
- Background work is event-triggered, not time-triggered. Monitors, cleanups, and periodic tasks fire in response to logged triggers. No opaque cron schedules. "What is the system doing right now?" is always answerable from the event log.

# Configurability
- Per-run knobs are inferred from the question by default, exposed in the UI for manual tuning, and recorded in the event log when they take effect.

# Perturbation as a core mechanism
- The system takes non-deterministic leaps in how it answers, where it searches, and how it branches. Deliberate exploration is a primary engine behavior, not a defensive fallback — diversity of approach is a core feature.

# Forkable runs
- Any completed or paused run can be branched from any cycle to explore "what if the plan had been different here." Extends pause-and-edit with retrospective analysis. Mostly free if state is artifact-based.