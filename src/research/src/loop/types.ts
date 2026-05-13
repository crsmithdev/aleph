/**
 * Loop-engine types — the v1 rewrite per docs/plans/research-engine-build-plan.md.
 *
 * Engine-deterministic, planner-adaptive: the engine plumbing (envelope ticking,
 * cycle dispatch, ledger dedup, render-from-artifacts) is deterministic. Per-loop
 * adaptive behavior lives in templates and (in v2) in the Check primitive.
 */

export type LoopId = string;
export type CycleId = string;
export type ArtifactId = string;
export type MilestoneId = string;

// ---- Envelope ----------------------------------------------------------------

/**
 * Multi-stack envelope: any of these can be set; the loop stops at the first one
 * that's consumed. All optional — a loop with no envelope set runs until its
 * stop_rule says done (useful for tests that aren't budget-driven).
 */
export interface Envelope {
  time?: { minutes: number };
  cost?: { usd: number };
  cycles?: { count: number };
  sources?: { count: number };
}

export interface EnvelopeUsage {
  time_minutes: number;
  cost_usd: number;
  cycles_count: number;
  sources_count: number;
}

// ---- Loop --------------------------------------------------------------------

export type LoopStatus =
  | 'pending'    // row created, child not yet spawned
  | 'running'    // child process active
  | 'paused'     // v2: user paused
  | 'completed'  // stop_rule satisfied
  | 'failed'     // unrecoverable error
  | 'cancelled'; // user cancelled

export interface Loop {
  id: LoopId;
  template_id: string;
  status: LoopStatus;
  envelope: Envelope;
  envelope_consumed: EnvelopeUsage;
  child_pid: number | null;
  prompt: string;
  /** Mode preset picked at session-create time. Pure metadata after the
   *  schedule is constructed (see `MODE_PROFILES` in `./modes.ts`); engine
   *  behaviour is governed by the schedule artifact, not the mode label. */
  mode: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Cycle -------------------------------------------------------------------

export type CycleStatus = 'pending' | 'running' | 'finalized' | 'failed';

export interface Cycle {
  id: CycleId;
  loop_id: LoopId;
  index: number;        // 0-based dispatch order within the loop
  priority: number;     // ORDER BY priority DESC, created_at ASC at dispatch
  status: CycleStatus;
  started_at: string | null;
  finalized_at: string | null;
}

// ---- Artifact ----------------------------------------------------------------

/**
 * Artifact kinds. Templates may produce any kind; the engine treats payload
 * as opaque JSON and never introspects it. v1 known kinds:
 *
 * - 'milestone'    — user-facing narrative summary at 25/50/75% envelope.
 * - 'schedule'     — planner output (lands fully in Phase 5).
 * - 'render'       — final rendered output.
 * - 'noop_output'  — placeholder produced by the noop template.
 *
 * v2 will add 'check' and v3 'digest' / 'chart'. Templates own their kinds;
 * the engine never validates them.
 */
export type ArtifactKind = string;

export interface Artifact {
  id: ArtifactId;
  loop_id: LoopId;
  cycle_id: CycleId | null;  // null = loop-level artifact (e.g. final render)
  kind: ArtifactKind;
  payload: Record<string, unknown>;
  created_at: string;
}

// ---- Output shape ------------------------------------------------------------

/**
 * Detected output shape — what the renderer must produce to satisfy the user's
 * question. Inferred from the prompt at session-create time (one cheap LLM
 * call), persisted on the `kind: 'schedule'` artifact, and consumed by the
 * renderer as a gate and by `stop_rule` as a precondition for "done".
 *
 * Per `docs/plans/research-system-design.md` §6 the taxonomy is prose / list /
 * table / timeline / mixed. Each variant carries the parameters its gate needs:
 *
 *  - `prose`       — narrative answer. Always satisfied; no gate.
 *  - `list`        — enumerable answer. Renderer counts items; gate requires
 *                    `>= min_items`. Default min_items=5.
 *  - `table`       — comparison answer with named columns. Renderer parses a
 *                    table from the findings; gate requires every column to be
 *                    populated in at least one row.
 *  - `timeline`    — time-ordered events. Renderer extracts dated events; gate
 *                    requires `>= min_events`. Default min_events=3.
 *  - `mixed`       — composite of two-or-more shapes. Gate AND-combines its
 *                    components' gates.
 *
 * Phase 3 lands `prose`, `list`, `table`, `mixed`. `timeline` rounds out the
 * v1 taxonomy but is not in the build plan's deliverable list — gate ships,
 * detector permits, no dedicated e2e case.
 */
export type OutputShape =
  | { kind: 'prose' }
  | { kind: 'list'; min_items?: number }
  | { kind: 'table'; columns: string[] }
  | { kind: 'timeline'; min_events?: number }
  | { kind: 'mixed'; components: OutputShape[] };

// ---- Adaptive planner (Phase 4) ----------------------------------------------

/**
 * One investigation thread within a loop. The research template's derivation
 * hook seeds cycle queries from the schedule's `branches[]` instead of the
 * Phase-2 "first follow-up" pickup, so the planner controls thread topology
 * up front. Phase 5 will add a `predecessor_id` link for milestone re-plans.
 */
export interface Branch {
  /** Stable identifier within the schedule. Slug form (e.g.
   *  `"react-state-libs"`). Perturbation system links spawned cycles back
   *  via this id. */
  id: string;
  /** Seed query — the first cycle on this branch uses it verbatim;
   *  subsequent cycles derive from accumulated findings. */
  query: string;
  /** Per-branch override of the schedule's `per_branch_budget`. Planner
   *  sets it only when the branch warrants more or less than the default. */
  budget?: number;
}

/**
 * Adaptive planner output. Replaces `run-plan.ts`'s
 * `(question_shape × topic_cluster) → RunPlan` lookup with an LLM call that
 * takes (prompt, question_shape, output_shape, envelope, role) and emits this
 * typed schedule. Per `docs/plans/research-engine-build-plan.md` §Phase 4,
 * the Phase-4 slice is the structural plan only; envelope, models,
 * perturbation_config, flags, mode metadata collapse onto `SchedulePayload`
 * at Phase 5.
 *
 * The defense against F1 (topic / canon drift): the planner sees the prompt
 * directly and can ground canon on URL contents when the prompt contains a
 * URL, rather than routing through a 6-cluster topic lookup whose taxonomy
 * was the documented root of the failure.
 */
export interface LoopSchedule {
  /** Authoritative list of entities / concepts the loop investigates. Order
   *  is significant — earlier entries get earlier cycles. URL-grounded
   *  prompts seed canon from the URL contents; otherwise the planner derives
   *  it from the prompt. */
  canon: string[];
  /** Decomposition of the prompt into investigation threads. */
  branches: Branch[];
  /** Default cycle budget per branch (cycles, not USD — the USD envelope
   *  stays on `SessionConfig` until Phase 5 collapses it onto the
   *  schedule). Individual branches may override via `Branch.budget`. */
  per_branch_budget: number;
  /** Planner's preference for the perturbation strategy menu, expressed as
   *  `strategy_id → weight` (0..1). Strategies not listed inherit the
   *  default weight from the perturbation system. Phase 4 emits this;
   *  engine consumes at Phase 5. */
  perturbation_weights: Record<string, number>;
  /** Milestone re-plan checkpoints as fractions of envelope (0..1). At
   *  each milestone the planner re-fires with accumulated findings;
   *  resulting schedule artifacts chain via `predecessor_id` (Phase 5). */
  milestone_plan: number[];
}

/**
 * Payload of the `kind: 'schedule'` artifact written once at session-create
 * time. Phase 3 carries `output_shape`; Phase 4 adds `plan`. Phase 5 collapses
 * the rest of the per-loop knobs (envelope, models, perturbation_config,
 * flags, mode metadata) onto this same payload — anticipating that move now
 * avoids a DDL migration when the universal-config slice lands.
 */
export interface SchedulePayload {
  output_shape: OutputShape;
  plan: LoopSchedule;
  /** The mode preset that constructed the initial schedule. Metadata only —
   *  the engine doesn't re-derive behaviour from this. Phase 5 will collapse
   *  envelope / models / perturbation_config onto this payload too; for now
   *  the mode label is the durable record of what the user picked. */
  created_with_mode?: string | null;
}

// ---- Decisions ---------------------------------------------------------------

/**
 * One unit of observable engine decision-making. Emitted by the planner
 * (canon + branch picks) and the research template's derivation hook
 * (follow-up accept/reject) so the UI's Activity > Decisions panel can show
 * what the engine *chose* in addition to what it *did*.
 *
 * Storage is dual:
 *   1. Live event — `emitResearchEvent(loop_id, 'decision', DecisionPayload)`.
 *   2. Persisted artifact — a single `kind: 'decision_log'` artifact per loop
 *      (cycle_id = null), whose payload accumulates entries across the run.
 *      The append-as-new-row pattern in db.ts means each decision creates a
 *      new artifact row that supersedes the previous (latest wins for reads).
 *
 * The discriminator is the `type` field; each variant carries the minimum
 * data the UI needs to render the decision in context. Future variants
 * (e.g. perturbation pick, milestone re-plan) extend the union without
 * touching the helper API in `decisions.ts`.
 */
export type DecisionPayload =
  | {
      type: 'canon_pick';
      /** The canon entity the planner chose. */
      entity: string;
      /** Index in the planner's canon array (0-based) so the UI can show
       *  "1st of N picks". */
      index: number;
      /** Total canon size from this planning round. */
      total: number;
      /** Optional human-readable rationale — the planner's prompt doesn't
       *  emit one yet, but the field is plumbed for v1.1. */
      rationale?: string;
    }
  | {
      type: 'branch_pick';
      /** Branch.id from the schedule. */
      branch_id: string;
      /** The seed query the branch will run. */
      query: string;
      /** Index in the planner's branches array. */
      index: number;
      /** Total branches from this planning round. */
      total: number;
      /** Optional per-branch budget override. */
      budget?: number;
      rationale?: string;
    }
  | {
      type: 'followup_pick';
      /** The follow-up query the derivation parsed from the LLM response. */
      query: string;
      /** True when this follow-up wins the next-cycle seat (i.e. the first
       *  in the parsed array); false when it was returned but bookkept (the
       *  second/Nth follow-up in the array). */
      accepted: boolean;
      /** Index in the parsed-follow-ups array (0-based). */
      index: number;
      /** Total follow-ups parsed in this derivation round. */
      total: number;
      /** Cycle id this derivation belongs to — lets the UI co-locate the
       *  decision with its cycle in the timeline. */
      cycle_id: CycleId;
      /** Optional reason for the accept/reject classification (e.g.
       *  "fallback reused query" when the LLM response was malformed). */
      reason?: string;
    };

/**
 * Persisted artifact payload for `kind: 'decision_log'`. One artifact per
 * append: re-fetch the latest, push a new entry, write a new artifact.
 * Latest-by-created_at is the authoritative log.
 */
export interface DecisionLogPayload {
  entries: DecisionLogEntry[];
}

export interface DecisionLogEntry {
  decision: DecisionPayload;
  recorded_at: string;
}

// ---- Cycle ledger ------------------------------------------------------------

/**
 * One ledger entry per (cycle, step) pair. The input_hash makes the entry
 * idempotent — if a child process is killed and restarted, replaying a step
 * with the same input finds its prior output in the ledger and skips re-doing
 * the work.
 *
 * Steps map to the four-hook template contract.
 */
export type LedgerStep = 'processor' | 'derivation' | 'renderer' | 'stop_rule';

export interface CycleLedgerEntry {
  loop_id: LoopId;
  cycle_id: CycleId;
  step: LedgerStep;
  input_hash: string;        // stable hash of the step's input
  output: unknown;            // JSON-serialisable
  cost_usd: number;
  recorded_at: string;
}

// ---- Milestone ---------------------------------------------------------------

/**
 * User-facing narrative checkpoint at 25/50/75% envelope consumption.
 * Engine-side digests (v3.2) live as separate artifacts; a milestone row may
 * later point at its digest companion via digest_artifact_id (null in v1).
 */
export interface Milestone {
  id: MilestoneId;
  loop_id: LoopId;
  at_envelope_pct: 25 | 50 | 75;
  artifact_id: ArtifactId;            // points at kind='milestone' artifact
  digest_artifact_id: ArtifactId | null;
  created_at: string;
}

// ---- Template contract -------------------------------------------------------

/**
 * Read-only state a hook sees when it runs. The engine assembles this from the
 * authoritative artifact set + envelope usage; hooks never mutate it directly.
 * State changes happen via the values hooks return, which the engine writes
 * to the ledger and (where appropriate) emits as artifacts.
 */
export interface LoopState {
  loop: Loop;
  cycles: Cycle[];
  artifacts: Artifact[];
  envelope_consumed: EnvelopeUsage;
}

export interface StopDecision {
  done: boolean;
  reason?: string;
}

/**
 * Result envelope for the three cost-bearing hooks. Each hook returns its
 * `output` plus the USD cost of any LLM calls it made. The engine sums
 * cost_usd into `loops.envelope_consumed.cost_usd` via bumpUsage so the
 * envelope cap fires correctly and the UI's Cost KPI reflects real spend.
 * stop_rule has no `output` and is currently pure policy (no LLM call),
 * so it doesn't use this shape.
 */
export interface HookResult<T> {
  output: T;
  cost_usd: number;
}

/**
 * Iteration-check verdict written at each milestone (25/50/75% envelope).
 *
 * An LLM call asks "is the loop on track or drifting?" given accumulated
 * findings. The Activity tab's Iteration Checks panel renders these in order.
 * Persisted as a `kind: 'iteration_check'` artifact and emitted via the
 * existing `artifact` event (createArtifact handles that). Optional hook —
 * templates that opt in implement `Template.iterationCheck`.
 *
 * `correction` is the planner-facing payload: when verdict is
 * `'needs_correction'` future planner re-plans may consume this to bias the
 * next round of branches. Phase-current uses only `verdict` + `notes`; the
 * field is present so the contract doesn't change when re-plans land.
 */
export interface IterationCheckPayload {
  at_envelope_pct: 25 | 50 | 75;
  verdict: 'on_track' | 'drifting' | 'needs_correction';
  notes: string;
  correction?: Record<string, unknown>;
  model: string;
}

/**
 * Post-mortem summary written once on natural completion of a loop.
 *
 * One LLM call analyses the terminal state and produces a final verdict for
 * the Activity tab's Post-Mortem panel. Persisted as a `kind: 'post_mortem'`
 * artifact and emitted via the existing `artifact` event. Optional hook;
 * fires from `run.ts` only when the loop ended with `result.status ===
 * 'completed'` (envelope_exhausted does not trigger). Failure here does not
 * fail the loop — observable via stderr per Commandment 1.
 */
export interface PostMortemPayload {
  verdict: 'success' | 'partial' | 'failure';
  flags: string[];
  recommendations: string[];
  metrics_snapshot: Record<string, unknown>;
  model: string;
}

/**
 * Four-hook template interface plus two OPTIONAL observability hooks.
 *
 * Required hooks:
 *  - processor   — runs the unit of work for this cycle (e.g. one search round).
 *  - derivation  — decides what to spawn / explore next based on processor output.
 *  - renderer    — produces the in-progress artifact (`kind: 'render'` etc.).
 *  - stop_rule   — returns { done: true, reason } when the loop should finish.
 *
 * Optional hooks:
 *  - iterationCheck — fires at each milestone after the renderer. Writes an
 *    `iteration_check` artifact with a drift verdict. Templates that don't
 *    implement it skip the LLM call entirely. Failure does NOT fail the loop.
 *  - postMortem     — fires once on natural completion (run.ts). Writes a
 *    `post_mortem` artifact with the final verdict. Templates that don't
 *    implement it skip the call. Failure does NOT fail the loop.
 *
 * Templates are pure TypeScript modules; ship-as-code, not as data.
 */
export interface Template<P = unknown, D = unknown, R = unknown> {
  id: string;
  processor: (input: unknown, state: LoopState) => Promise<HookResult<P>>;
  derivation: (state: LoopState, processor_output: P) => Promise<HookResult<D>>;
  renderer: (state: LoopState) => Promise<HookResult<R>>;
  stop_rule: (state: LoopState) => Promise<StopDecision>;
  iterationCheck?: (state: LoopState, milestonePct: 25 | 50 | 75) => Promise<HookResult<IterationCheckPayload>>;
  postMortem?: (state: LoopState) => Promise<HookResult<PostMortemPayload>>;
}
