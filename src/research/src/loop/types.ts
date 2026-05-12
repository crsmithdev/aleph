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

/**
 * Payload of the `kind: 'schedule'` artifact written once at session-create
 * time. Phase 3 carries only `output_shape`. Phase 5 collapses the rest of the
 * per-loop knobs (envelope, models, perturbation_config, canon, branches,
 * milestones, flags) onto this same payload — anticipating that move now
 * avoids a DDL migration when the planner lands.
 */
export interface SchedulePayload {
  output_shape: OutputShape;
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
 * Four-hook template interface. Each hook is async to allow LLM / network /
 * fs calls, but pure-function templates (like noop) are fine too.
 *
 * - processor   — runs the unit of work for this cycle (e.g. one search round).
 * - derivation  — decides what to spawn / explore next based on processor output.
 * - renderer    — produces the in-progress artifact (`kind: 'render'` etc.).
 * - stop_rule   — returns { done: true, reason } when the loop should finish.
 *
 * Templates are pure TypeScript modules; ship-as-code, not as data.
 */
export interface Template<P = unknown, D = unknown, R = unknown> {
  id: string;
  processor: (input: unknown, state: LoopState) => Promise<P>;
  derivation: (state: LoopState, processor_output: P) => Promise<D>;
  renderer: (state: LoopState) => Promise<R>;
  stop_rule: (state: LoopState) => Promise<StopDecision>;
}
