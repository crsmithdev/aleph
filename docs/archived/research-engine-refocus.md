# Loop engine — bounded iterative-work spec

A spec for a generic iterative-loop engine that replaces today's research-specific engine in a single hard cutover. The engine takes a seed input, runs it through cycles of `process → derive → process → derive → …` against a budget envelope, and produces a typed artifact at the end. Research is one template that plugs into this engine. Monitors are another. Code-development and image-iteration are future templates.

No migration, no backwards-compat, no coexistence period.

## Why generic

The current engine is research-shaped and bolts monitors on. But the underlying pattern — seed input + iterative refinement against a budget — is the same for several real use cases:

| Use case | Cycle shape | Derivation between cycles |
|---|---|---|
| Research | search + extract findings | next sub-question / perturbation / gap-fill |
| Monitor | sleep until cadence, then run inner loop, diff against prior | wait + re-run saved query |
| Code dev | agent makes a change, tests run, diff is the artifact | next agent prompt derived from test results + prior diff |
| Art / generative | model generates an image, critique runs | next prompt derived from prior image + critique |

Building the engine generic from the start avoids re-inventing the envelope / scheduler / crash-resume / fanout / milestone machinery four times. The cost is one clean template boundary.

## Goal

Produce a finished, persisted artifact from a seed input within a user-specified envelope. The artifact is the deliverable; telemetry, events, intermediate cycle state are a debug surface.

## What this engine serves

- **30-min focused runs** — bounded by time.
- **Overnight runs** — same engine, larger envelope.
- **Heavy-modality runs** — bounded by a source list and a cost ceiling; wall-clock may run 6–20 h.
- **Long-running monitors** — bounded only by "until cancelled," with most cycles being wait-cycles and occasional run-cycles. Implemented as a parent loop whose cycles spawn bounded inner loops.
- **Future: iterative software / art / generative work** — bounded by cycle count, cost, or "until convergence."

## What this engine does **not** serve

- **Indefinite single-shot runs.** A query that benefits from a week of continuous work is rejected as a use case.
- **Pure batch processing.** Map-only workloads don't iterate; use something else.
- **Work that doesn't have a clean cycle boundary.** If you can't say "what's the input, what's the output, how is the next input derived," this engine isn't the right shape.

## Core primitives

| Primitive | Shape | Notes |
|---|---|---|
| **Loop** | A run from seed → final artifact, bounded by an envelope. | The top-level unit. One DB row, one OS child process. |
| **Cycle** | One iteration: input → processor → output. Has `priority: number`. | Within-loop priority ordering preserved (`priority DESC, created_at ASC`). |
| **Artifact** | Typed output of a cycle: `{ kind: 'finding' | 'source' | 'code_diff' | 'image' | 'wait' | 'text' | 'digest', payload: … }`. | One uniform table; templates own the payload shape. |
| **Derivation** | Function from `(prior_inputs, prior_outputs) → next_input`. | The engine of progress. Perturbation strategies live here. |
| **Envelope** | `{ time?: minutes, cost?: usd, cycles?: count, sources?: SourceRef[] }`. At least one set. | Multiple stack: stops at first consumed. |
| **Template** | `{ processor, derivation, renderer, stop_rule }` — the four hooks a template implements. | The only abstraction boundary. Everything else is engine. |
| **Cycle ledger** | Per-cycle completion record keyed by content hash of input. | Crash recovery reads this and skips digested cycles. |
| **Milestone** | Summary written at 25 / 50 / 75 % envelope consumption. | Cheap; gives early-exit option and makes watching tolerable. |
| **Final artifact view** | Template-rendered display of the cycle artifacts. | The deliverable: report, gallery, commit log, monitor digest — same engine, different renderer. |

## Lifecycle of a loop

1. **Submit.** User picks a template, posts a seed input + envelope.
2. **Pre-flight clarification.** Template's processor may ask 1–2 disambiguation questions with a short timeout (e.g. 60 s). On timeout, the loop proceeds with the model's best guess; the clarification is recorded as an artifact so the user sees what the engine assumed.
3. **Plan.** 10–15 % of the envelope is spent producing a `LoopSchedule`: branching factor, expected cycles per branch, derivation rules per cycle, milestone checkpoints. The planner sees the envelope and the template and pre-allocates against both.
4. **Execute.** In-process fanout. Branches run concurrently up to `max_concurrent_branches`. Each branch runs its cycles sequentially (or with sub-fanout, if the template requests it). Within-loop priority ordering honored when slots free.
5. **Milestones.** At checkpoints, a summary cycle runs against accumulated artifacts. The summary is itself an artifact. The user can promote a milestone to the final artifact if the answer is already there.
6. **Synthesize.** When the schedule completes OR the envelope is consumed (whichever first), the template's renderer produces the final artifact from accumulated cycle artifacts.
7. **Done.** Loop exits. All artifacts, the ledger, milestones, and the final artifact persist.

## Concurrency model

In-process. Each loop runs as a child process spawned by the API server when the loop is created — one OS process per loop, not a pool. Within the process, concurrent fanout uses a semaphore-bounded async tree (the existing `mapWithConcurrency` helper at `src/research/src/engine.ts:409` is sufficient).

- No shared job queue, no claim tokens, no heartbeats.
- Within-loop priority survives: when a slot frees, the next cycle is `ORDER BY priority DESC, created_at ASC` (matching today's `claimNextThread` ordering at `src/research/src/services/threads.ts:128`).
- Cross-loop priority arbitration goes away. If two loops are active, the OS schedules them.

The API server tracks running loops by PID. If a loop process dies, the API either restarts it (the cycle ledger lets it resume at the next un-digested cycle) or marks the loop failed, per template config.

## Templates (the abstraction boundary)

A template implements four hooks. Everything else — envelope tracking, fanout, persistence, retry/back-off, milestones, crash-resume — is engine.

```
Template:
  processor:   (input, context) → CycleOutput
  derivation:  (prior_inputs, prior_outputs, schedule) → NextInput[]
  renderer:    (artifacts, loop_meta) → FinalArtifact
  stop_rule:   (artifacts, envelope) → 'continue' | 'stop'
```

`processor` is what makes a cycle do work. `derivation` is what makes the loop iterate (this is where perturbation lives, promoted from defensive to primary). `renderer` is how the artifact is displayed. `stop_rule` is the template's own "is this done" — typically "schedule complete OR envelope consumed," but templates can add coverage-style criteria (e.g. research's question-shape completeness lens).

Templates ship as code, not as data. Adding a new template means a new file plus four hook implementations.

## Budget-aware planning

The planner is the single biggest quality lever. It takes the envelope, the template, and the seed input, and produces a `LoopSchedule` that respects the envelope.

- **Time-bounded** — planner picks branching factor, cycle depth, model mix.
- **Cost-bounded** — planner converts to expected token spend per branch.
- **Cycle-bounded** — planner picks N cycles, decides how to spend each.
- **Source-list-bounded** — planner allocates one branch per source (or per source-group).

The schedule is committed at loop start and re-evaluated at milestone checkpoints. Mid-cycle drift correction (which today drives the perturbation rate-limiter) is replaced by milestone re-plans.

## Data model

Tables that exist in the new engine:

- `loops` — top-level run metadata (envelope, template, status, started_at).
- `cycles` — one row per cycle, with `priority`, `input_hash`, `output_artifact_id`, `branch_id`, `derived_from_cycle_ids`.
- `artifacts` — typed payloads, `kind` discriminator, JSON payload. One uniform table; templates own the payload shape.
- `cycle_ledger` — completion record keyed by `input_hash`. Crash resume reads this.
- `milestones` — 25 / 50 / 75 % checkpoint summaries; each is also an artifact with `kind: 'milestone'`.
- `steps` — telemetry / event stream (kept, but a debug surface, not primary).

Tables that go away from today's engine:

- `research_jobs`, `research_workers` — no dispatcher, no daemon.
- `research_perturbation_state` — perturbation is now `derivation`, owned by the template.
- `research_post_mortems` — *kept for now as development feedback; revisit before declaring the spec done.*
- `research_monitor_*` — folded into the loop engine (see § Monitors extension).

Tables that become template-payload extensions of `artifacts`:

- `findings` → `artifact.payload` where `kind = 'finding'`.
- `sources` → `artifact.payload` where `kind = 'source'`.
- `monitor_snapshots`, `monitor_alerts` → `artifact.payload` where `kind in ('snapshot', 'change', 'digest')`.

## Failure model

- **Process crash mid-loop.** Restart consults the cycle ledger; skips cycles with completed outputs; resumes at the next un-completed cycle. In-flight model calls are not preserved; re-issue.
- **Provider rate-limit.** In-process retry / back-off, reusing today's `src/research/src/providers/openrouter.ts` logic.
- **Envelope exceeded mid-cycle.** Engine stops issuing new work, lets in-flight cycles finish, calls the template's renderer with whatever's accumulated, marks the loop "incomplete."
- **Pre-flight clarification timeout.** Loop proceeds with model's best guess; the assumption is recorded as the first artifact so it's visible in the final view.

## UX

**Entry surface (primary).**

Single page: pick a template, write a seed input, set the envelope. Three envelope presets per template (e.g. for Research: 30 min / overnight / custom). "Custom" reveals time, cost cap, cycle count, optional source-list attach. Model / branching / depth are template-internal and not surfaced in the primary entry.

**Live surface (during a loop).**

A progress bar against the envelope, milestone summaries as they post, the running artifact-in-progress rendered by the template. No cycle tree, no event firehose by default — those live on a debug tab. The user reads what the engine has produced so far, not what it's doing.

**Done surface (after a loop).**

The final artifact, rendered by the template. Sources, cycles, telemetry collapsed below by default. The Reviews tab from today's research UI goes away; what it was showing folds into the final artifact (user-facing) and the debug tab (developer-facing).

**Sidebar IA.**

- Loops (list of all loops, filterable by template)
- Monitors (saved monitor-template loops with cadence + digest view)
- Telemetry (debug)

`WorkersPage` is removed — no daemon to observe.

## Research extension

The first template, and the one that drives most of the initial engine work.

| Hook | Implementation |
|---|---|
| **processor** | Web-search via Jina + LLM extraction. Reuses today's `executeSearches`, extraction, and citation logic. |
| **derivation** | Next sub-question generation, follow-up generation, gap-analysis cycles, perturbation strategies (today's 21 strategies move here verbatim, but as derivation rules, not as a defensive state machine). |
| **renderer** | Markdown report: sections, inline citations, an explicit "gaps / what I couldn't answer and why" section, references appendix. |
| **stop_rule** | `schedule_complete OR envelope_consumed OR shape_completeness_satisfied` — the last clause is research-specific (e.g. "list shape: at least 10 items found"). |

**Artifact kinds owned by the research template:**

- `finding` — extracted claim + citation (payload shape unchanged from today).
- `source` — URL/title/snippet/full-text (payload shape unchanged from today).
- `branch_summary` — per-branch synthesis written before the final report.
- `clarification` — pre-flight Q+A from the user.

**Research-specific schedule shape:**

- Branches map to today's "threads" — sub-questions explored in parallel.
- Each branch's cycles are: search → extract → optionally follow-up → optionally gap-fill.
- Branch priority float (today's `research_threads.priority`) remains the within-loop ordering key.

**What today's research code maps to:**

- `engine.ts:runIterations` → template processor + derivation, with the envelope check moving up to the engine.
- `engine.ts:runIteration` → one cycle.
- `services/threads.ts` ordering → engine cycle scheduling.
- `perturbation.ts` strategy_weights + selectors → derivation rules.
- `services/findings.ts` → artifact payload for `kind = 'finding'`.
- `engine.ts:enumerateCanon`, `detectQuestionShape`, `pickAgentRole` → planner inputs.

## Monitors extension

A monitor is a saved loop with a cadence whose cycles are themselves bounded inner loops. Monitors stop being a separate product because the loop engine already does everything they need.

| Hook | Implementation |
|---|---|
| **processor** | Two cycle kinds, dispatched by branch: (a) `wait` cycle — sleeps until the next cadence tick, produces a `wait` artifact; (b) `run` cycle — spawns a bounded inner loop using the research template against the monitor's saved query, then runs a diff cycle against the prior run's artifacts. |
| **derivation** | Trivial — next cycle is determined by the cadence: tick due → `run` cycle; otherwise → `wait` cycle. Re-uses the saved query as the inner loop's seed. |
| **renderer** | Weekly digest by default: a rollup over the run artifacts (new items, changed items, removed items, alerts triggered). Optional per-cycle change list. |
| **stop_rule** | `cancelled_by_user` — monitors run until the user halts them. Envelope is "until cancelled," with per-inner-loop sub-envelopes (each inner research loop has its own time + cost cap). |

**Monitor data model:**

- One `loop` row per saved monitor, `template = 'monitor'`, no time-bounded envelope on the parent loop.
- One `cycle` per cadence tick (`wait` cycles) or per check (`run` cycles).
- One `artifact` per `run` cycle of `kind = 'snapshot'`, plus `kind = 'change'` artifacts when diffs are detected.
- Periodic `kind = 'digest'` artifacts produced by the renderer.

**Cadence:**

A monitor's saved `cadence` (`daily | weekly | hourly | cron-string`) is stored on the parent loop. The API server's scheduler checks pending monitor loops every minute; due monitors get their next cycle dispatched. Between cycles the monitor process can either persist (cheap, sleeps most of the time) or exit and be re-spawned on tick (cleaner). Default: re-spawn-on-tick. The cycle ledger lets a re-spawned monitor pick up where it left off.

**Match criteria + alerts:**

The monitor's "did anything important change" logic moves into the renderer's diff function: a `kind = 'change'` artifact is created when criteria match; severity classification lives there. No separate `monitor_alerts` table.

**What today's monitor code maps to:**

- `monitor-engine.ts:runCycle` → monitor template's processor for `run` cycles.
- `services/monitors.ts:isAlertDuplicate` → diff logic inside the renderer.
- `MonitorsPage` → sidebar entry showing all loops with `template = 'monitor'`.
- `MonitorDetailPage` → the standard loop-detail page, rendered with the monitor template's renderer.

## What survives unchanged from today's code

- LLM provider abstraction (`providers/openrouter.ts`, `providers/router.ts`).
- Web search (Jina).
- Findings extraction shape and citation logic (becomes the research template's payload).
- Telemetry / event stream (relegated to a debug tab).
- UI primitives (`StatCard`, `DataTable`, `ChartContainer`, design tokens).
- Within-loop priority float.
- `mapWithConcurrency` helper.

## Build order

The cutover is a single hard switch, but the build leading up to it is staged so the abstraction stays honest:

1. **Loop engine skeleton.** Loops, cycles, artifacts, cycle ledger, envelope tracking, milestone scaffolding, child-process spawn from API. No templates yet — just the core.
2. **Research template + monitor template — together.** Shipping both at once is what keeps the engine boundary honest. The monitor template is small (the four hooks are mostly trivial); the research template is most of the work. Doing them in parallel forces the engine surface to be template-agnostic rather than research-shaped-with-monitor-bolted-on.
3. **Budget-aware planner.** Produces a `LoopSchedule`. First implementation can be research-template-specific; generalize once a second non-monitor template lands.
4. **Pre-flight clarification.** The 1–2 question flow with timeout, in front of the planner.
5. **Source ledger + heavy-modality cycles** for the research template (books / PDFs / images as cycles).
6. **Artifact-as-deliverable UI.** Final artifact is the primary view on the loop-detail page; collapse Reviews into it.
7. **Cutover.** Delete `research_jobs`, `worker.ts`, `services/jobs.ts`, `scheduler.ts`, the standalone perturbation state machine, `WorkersPage`, `ResearchReviewsView`. Drop session-level "modes" (default / scheduled / priority); the envelope is the only knob.

Steps 1–6 are additive; the current engine keeps running alongside them. Step 7 is the one-pass deletion. Code-dev and art templates, if pursued, land after step 7 as new files implementing the four hooks.

## Honest scope of the abstraction

The engine boundary is exactly four hooks per template (`processor`, `derivation`, `renderer`, `stop_rule`) plus the typed `artifact` table. Everything outside that is template logic and lives in the template's file.

What this means in practice:

- Citations, gap analysis, shape detection, role priming, canon enumeration → all research-template logic. They live in the research template's file. Calling them "generic" would be a lie.
- Diff / match criteria / alert severity → all monitor-template logic. Same.
- A future code template would own its own diff logic, test-runner integration, agent loop. The engine doesn't help with those; it just provides the loop infrastructure.

If we ship only the research template and skip the monitor one, we'll get an abstraction shaped for one use case and discover the boundary is wrong when the second template lands. That's why steps 2 ships both together.

## Open questions

- **Initial templates.** Research + monitor is the proposed minimum. Is there a third (code or art) that should ship at cutover, or do they wait?
- **Template registration.** Templates as code modules in `src/loop-engine/templates/`, picked up at build time? Or registered dynamically? Static registration is simpler and almost certainly right.
- **Schedule re-planning policy.** At milestones, always re-plan, or only re-plan when artifacts contain a surprise? Event-driven feels right but is harder to implement.
- **Monitor process lifetime.** Persistent process that mostly sleeps, vs. re-spawn-on-tick. Re-spawn-on-tick is cleaner; persistent is simpler when cadences are short.
- **Cycle ledger granularity.** Hash of input is the simplest key. Does heavy-modality need finer-grained sub-cycle ledger entries (e.g. per-chapter within a book)?
- **Pre-flight clarification UX.** How many questions max (2 feels like the ceiling), how long the timeout (60 s? 5 min?), what's the default-answer policy when the user is asleep?
- **Post-mortems' eventual fate.** Currently kept as development feedback. Spec assumes they're transient; if they prove load-bearing for trust, they should survive as the final artifact's "gaps" section, not as a separate artifact kind.
- **Source-list ingestion entry surface.** Is "attach sources" a separate template, or a parameter on the research template? Probably a parameter, since the cycle shape is the same — just per-source cycles instead of per-sub-question.
