/**
 * Adaptive planner — Phase 4 of the v1 build plan.
 *
 * Replaces `services/run-plan.ts`'s deterministic
 * `(question_shape × topic_cluster) → RunPlan` lookup with an LLM call. The
 * planner sees the prompt + detected output shape and emits a typed
 * `LoopSchedule` — `{ canon, branches, per_branch_budget,
 * perturbation_weights, milestone_plan }` — that the research template's
 * derivation hook seeds cycle queries from. The 6-cluster topic taxonomy
 * (the documented root of F1 topic drift) goes away entirely; the planner
 * grounds canon directly off the prompt and any URLs it contains.
 *
 * Mirrors `detectOutputShape`'s shape: positional args, one cheap LLM call,
 * a tolerant JSON parser, and a fallback path on any failure. The fallback
 * is a minimal single-branch schedule on the prompt itself — degrades the
 * loop to "Phase 3 behavior plus a no-op plan" rather than crashing it.
 *
 * Phase 4 ships the structural slice. Phase 5 collapses envelope, models,
 * perturbation_config, flags, and mode metadata onto the same artifact.
 */
import type { Sqlite } from '@aleph/data';
import { emitDecisionEvent, recordDecision } from './decisions.js';
import type { LLMProvider } from './llm.js';
import type { Branch, LoopId, LoopSchedule, OutputShape } from './types.js';

// Non-reasoning cheap JSON-friendly model. Reasoning models like
// openai/gpt-5-nano exhaust their max_tokens on hidden reasoning and return
// empty `content` for prompts longer than ~200 chars — the planner prompt
// is well over that, so the planner would silently fall back every run.
// Gemini Flash produces direct JSON output reliably.
const DEFAULT_PLAN_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_PER_BRANCH_BUDGET = 3;
const DEFAULT_MILESTONES: readonly number[] = [0.25, 0.5, 0.75, 1.0];
const PLAN_MAX_TOKENS = 1500;

/**
 * Build the planner prompt. The schema block is explicit because the LLM
 * has to emit nested objects (branches with optional budgets, weights map)
 * that don't survive a free-form completion well. URL contents — when the
 * prompt names one — get fed in via the `Target prompt` line; URL fetching
 * is the caller's job, not the planner's.
 */
function buildPlannerPrompt(prompt: string, output_shape: OutputShape): string {
  return [
    'Plan a research loop for the following prompt.',
    '',
    'Emit a JSON object with this schema:',
    '  {',
    '    "canon": ["entity1", "entity2", ...],',
    '    "branches": [',
    '      { "id": "kebab-slug", "query": "search query for this thread", "budget": N }',
    '    ],',
    '    "per_branch_budget": N,',
    '    "perturbation_weights": { "strategy_id": 0.5, ... },',
    '    "milestone_plan": [0.25, 0.5, 0.75, 1.0]',
    '  }',
    '',
    'Rules:',
    '- `canon` lists the authoritative entities or concepts the loop should investigate. Order by importance.',
    '- `branches` decomposes the prompt into 1..N investigation threads. Each branch becomes one cycle topic.',
    '- `branch.id` is a lowercase kebab slug, unique within the schedule.',
    '- `branch.query` is the seed search query for the first cycle on that branch.',
    '- `branch.budget` is optional; omit to inherit `per_branch_budget`.',
    '- `per_branch_budget` is an integer cycle count (typical: 2-5).',
    '- `perturbation_weights` may be empty `{}`. If non-empty, values are 0..1.',
    '- `milestone_plan` lists envelope fractions (0..1) at which to re-plan.',
    '',
    `Detected output shape: ${JSON.stringify(output_shape)}.`,
    'Plan branches that will produce findings matching the requested shape.',
    'If the prompt contains URLs, treat them as grounding sources and seed canon from them.',
    '',
    // Same unique marker as detectOutputShape — keeps the HTTP fake server's
    // prompt extractor unambiguous when both calls share a transport.
    `Target prompt: ${prompt}`,
    'Return only the JSON object — no prose, no markdown.',
  ].join('\n');
}

/**
 * Tolerant JSON parse: strips a single layer of markdown fences, walks the
 * value through coercePlan. Anything malformed → null; caller falls back to
 * the minimal plan.
 */
function parsePlan(text: string): LoopSchedule | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    return null;
  }
  return coercePlan(value);
}

function coercePlan(value: unknown): LoopSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  const branchesRaw = Array.isArray(obj.branches) ? obj.branches : [];
  const branches = branchesRaw
    .map(b => coerceBranch(b))
    .filter((b): b is Branch => b !== null);
  if (branches.length === 0) return null;  // a planner output with no branches is unusable

  const canon = Array.isArray(obj.canon)
    ? obj.canon.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];

  const per_branch_budget = typeof obj.per_branch_budget === 'number' && obj.per_branch_budget >= 1
    ? Math.floor(obj.per_branch_budget)
    : DEFAULT_PER_BRANCH_BUDGET;

  const perturbation_weights = coerceWeights(obj.perturbation_weights);

  const milestoneRaw = Array.isArray(obj.milestone_plan) ? obj.milestone_plan : null;
  const milestone_plan = milestoneRaw
    ? milestoneRaw.filter((m): m is number => typeof m === 'number' && m > 0 && m <= 1)
    : DEFAULT_MILESTONES.slice();

  return { canon, branches, per_branch_budget, perturbation_weights, milestone_plan };
}

function coerceBranch(value: unknown): Branch | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0) return null;
  if (typeof obj.query !== 'string' || obj.query.length === 0) return null;
  const branch: Branch = { id: obj.id, query: obj.query };
  if (typeof obj.budget === 'number' && obj.budget >= 1) {
    branch.budget = Math.floor(obj.budget);
  }
  return branch;
}

function coerceWeights(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && v >= 0 && v <= 1) result[k] = v;
  }
  return result;
}

/**
 * Minimal valid fallback — one branch, the prompt as its query. Used when
 * the LLM call fails or the response is unparseable. The engine's derivation
 * hook treats this as "no decomposition; investigate the prompt as one
 * thread", which is identical in behaviour to the Phase 3 baseline.
 */
function fallbackPlan(prompt: string): LoopSchedule {
  return {
    canon: [],
    branches: [{ id: 'main', query: prompt }],
    per_branch_budget: DEFAULT_PER_BRANCH_BUDGET,
    perturbation_weights: {},
    milestone_plan: DEFAULT_MILESTONES.slice(),
  };
}

/**
 * Optional context the planner uses to emit `decision` events for canon /
 * branch picks. Both fields are optional so unit tests that call `planLoop`
 * directly (without a loop) keep working — the planner emits no events and
 * appends no artifact in that case, which is fine for a unit-of-parsing
 * test.
 *
 *   - `loop_id` enables event emission (events carry session_id = loop_id).
 *   - `sqlite` enables artifact persistence — without it, decisions are
 *     event-only. `ensureScheduleArtifact` always passes both in
 *     production, so the prod path persists fully.
 */
export interface PlannerObservability {
  loop_id?: LoopId;
  sqlite?: Sqlite;
}

/**
 * Run the adaptive planner. Always returns a valid `LoopSchedule`:
 * - LLM call throws → fallback
 * - Response unparseable → fallback
 * - Response missing branches → fallback (a planner output with zero branches
 *   would produce a no-op loop, which the renderer can't gate against)
 * - Otherwise the parsed plan, with optional fields filled by defaults.
 *
 * When `obs.loop_id` is supplied, the planner emits one `decision` event per
 * canon entity (`canon_pick`) and one per branch (`branch_pick`) so the
 * Activity > Decisions panel can show what the planner *chose*, not just
 * what the artifact carried. When `obs.sqlite` is also supplied, each
 * decision is also appended to the loop's `decision_log` artifact.
 */
export async function planLoop(
  prompt: string,
  output_shape: OutputShape,
  llm: LLMProvider,
  model: string = DEFAULT_PLAN_MODEL,
  obs: PlannerObservability = {},
): Promise<LoopSchedule> {
  const plan = await runPlanner(prompt, output_shape, llm, model);
  emitPlanDecisions(plan, obs);
  return plan;
}

async function runPlanner(
  prompt: string,
  output_shape: OutputShape,
  llm: LLMProvider,
  model: string,
): Promise<LoopSchedule> {
  try {
    const result = await llm.complete(model, buildPlannerPrompt(prompt, output_shape), PLAN_MAX_TOKENS);
    const parsed = parsePlan(result.text);
    if (parsed) return parsed;
    // Commandment 1: surface silent fallbacks. Log a one-liner and a sample
    // of the response so a regression is greppable from stderr.
    const sample = result.text.slice(0, 200).replace(/\s+/g, ' ').trim();
    process.stderr.write(`[planner] LLM response unparseable, using fallback plan. model=${model} text="${sample}"\n`);
    return fallbackPlan(prompt);
  } catch (err) {
    process.stderr.write(`[planner] LLM call failed, using fallback plan. model=${model} err=${(err as Error).message}\n`);
    return fallbackPlan(prompt);
  }
}

/**
 * Fan the resolved plan out as `decision` events (and optionally artifact
 * appends). One event per canon entry, one per branch — Phase 4's planner
 * is the source of truth for both, so they're the natural unit. No events
 * fire when `loop_id` is absent (unit-test mode).
 */
function emitPlanDecisions(plan: LoopSchedule, obs: PlannerObservability): void {
  if (!obs.loop_id) return;
  const loop_id = obs.loop_id;
  const sqlite = obs.sqlite;

  plan.canon.forEach((entity, index) => {
    const decision = {
      type: 'canon_pick' as const,
      entity,
      index,
      total: plan.canon.length,
    };
    if (sqlite) recordDecision(sqlite, loop_id, decision);
    else emitDecisionEvent(loop_id, decision);
  });

  plan.branches.forEach((branch, index) => {
    const decision = {
      type: 'branch_pick' as const,
      branch_id: branch.id,
      query: branch.query,
      index,
      total: plan.branches.length,
      ...(branch.budget !== undefined ? { budget: branch.budget } : {}),
    };
    if (sqlite) recordDecision(sqlite, loop_id, decision);
    else emitDecisionEvent(loop_id, decision);
  });
}
