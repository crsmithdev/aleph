/**
 * Output-shape detection — Phase 3 of the v1 build plan.
 *
 * One cheap LLM call at session-create time inspects the prompt and decides
 * what shape the answer should take: prose, list, table, timeline, or mixed.
 * The result is persisted as a `kind: 'schedule'` artifact (see
 * `SchedulePayload` in `./types.ts`); the renderer reads it back to gate
 * "done" on shape satisfaction (renderer-as-gate) and `stop_rule` consults
 * it before declaring the loop complete.
 *
 * Failure modes are taken seriously here because shape mis-detection is F2 in
 * the documented failure-mode list — the whole point of Phase 3 is to stop
 * giving prose answers to table queries. The parser is tolerant (strips code
 * fences, accepts looser JSON), but on any unrecoverable issue we fall back
 * to `prose` — a narrative answer is always renderable, so the loop degrades
 * to "Phase 2 behavior with a render gate that never fires" rather than
 * crashing. Mis-detection is observable: the schedule artifact records what
 * shape the LLM chose, and the renderer emits `shape_satisfied` on every
 * pass, so a regression shows up in the artifact stream rather than as a
 * silent shape mismatch (the F2 failure).
 *
 * The detector is callable directly for unit tests; `ensureScheduleArtifact`
 * is the production entry point — idempotent (skips re-detection if a
 * schedule artifact already exists for the loop), so child-process respawns
 * after a crash don't burn a second LLM call.
 */

import type { Sqlite } from '@construct/data';
import { bumpUsage, createArtifact, getLoop, listArtifacts } from './db.js';
import type { LLMProvider } from './llm.js';
import { withCostTracker } from './cost.js';
import { planLoop } from './planner.js';
import { MODE_PROFILES, isMode } from './modes.js';
import type {
  Artifact, LoopId, LoopState, OutputShape,
  ScheduleModels, SchedulePayload,
} from './types.js';

// See planner.ts for why we don't use a reasoning model here — same issue
// (empty content when max_tokens is consumed by reasoning).
const DEFAULT_DETECT_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_LIST_MIN_ITEMS = 5;
const DEFAULT_TIMELINE_MIN_EVENTS = 3;

/**
 * Build the classification prompt. Few-shot examples cover the four
 * deliverable cases from the build plan plus a prose baseline, so the LLM
 * has concrete anchors for each variant. The schema is a strict JSON object
 * — the parser tolerates surrounding code fences but rejects anything else.
 */
function buildDetectionPrompt(userPrompt: string): string {
  return [
    'Classify the output shape this research prompt is asking for.',
    '',
    'Return JSON. Schemas (one of):',
    '  { "kind": "prose" }',
    '  { "kind": "list", "min_items": N }                          // N >= 1',
    '  { "kind": "table", "columns": ["col1", "col2", ...] }       // 2+ columns',
    '  { "kind": "timeline", "min_events": N }                     // N >= 1',
    '  { "kind": "mixed", "components": [<shape>, <shape>, ...] }  // 2+ inner shapes',
    '',
    'Examples (illustrative — do not classify these):',
    '  Example -> {"kind":"prose"}',
    '  Example -> {"kind":"list","min_items":5}',
    '  Example -> {"kind":"table","columns":["col1","col2","col3","col4"]}',
    '  Example -> {"kind":"mixed","components":[{"kind":"prose"},{"kind":"list","min_items":5}]}',
    '  Example -> {"kind":"timeline","min_events":3}',
    '',
    // Use a unique marker so HTTP-fake test infrastructure can extract the
    // target prompt without false matches against any earlier text.
    `Target prompt: ${userPrompt}`,
    'Return only the JSON object — no prose, no markdown.',
  ].join('\n');
}

/**
 * Tolerant JSON parse: strips a single layer of markdown code fences, walks
 * the value through a per-variant validator. Anything malformed → null;
 * callers fall back to prose.
 */
function parseShape(text: string): OutputShape | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    return null;
  }
  return coerceShape(value);
}

function coerceShape(value: unknown): OutputShape | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === 'prose') return { kind: 'prose' };
  if (kind === 'list') {
    const min = typeof obj.min_items === 'number' && obj.min_items >= 1
      ? Math.floor(obj.min_items)
      : DEFAULT_LIST_MIN_ITEMS;
    return { kind: 'list', min_items: min };
  }
  if (kind === 'table') {
    if (!Array.isArray(obj.columns)) return null;
    const cols = obj.columns.filter((c): c is string => typeof c === 'string' && c.length > 0);
    if (cols.length < 2) return null;       // single-column "table" is just a list
    return { kind: 'table', columns: cols };
  }
  if (kind === 'timeline') {
    const min = typeof obj.min_events === 'number' && obj.min_events >= 1
      ? Math.floor(obj.min_events)
      : DEFAULT_TIMELINE_MIN_EVENTS;
    return { kind: 'timeline', min_events: min };
  }
  if (kind === 'mixed') {
    if (!Array.isArray(obj.components)) return null;
    const comps = obj.components
      .map(c => coerceShape(c))
      .filter((c): c is OutputShape => c !== null);
    if (comps.length < 2) return null;      // mixed with <2 components is just that one shape
    return { kind: 'mixed', components: comps };
  }
  return null;
}

/**
 * Classify a prompt's output shape via one LLM call. On malformed response
 * or LLM error, returns `{ kind: 'prose' }` — the renderer's prose gate is
 * a no-op, so a detection failure degrades the loop to Phase 2 behavior
 * rather than crashing it.
 */
export async function detectOutputShape(
  prompt: string,
  llm: LLMProvider,
  model: string = DEFAULT_DETECT_MODEL,
): Promise<OutputShape> {
  try {
    const result = await llm.complete(model, buildDetectionPrompt(prompt), 300);
    const shape = parseShape(result.text);
    if (shape) return shape;
    // Commandment 1: detection falling back to prose is observable now —
    // the renderer's prose gate is a no-op so a regression here looks like
    // "loop completes but shape never satisfies." Logging fixes that.
    const sample = result.text.slice(0, 200).replace(/\s+/g, ' ').trim();
    process.stderr.write(`[shape] detector returned unparseable response, defaulting to prose. model=${model} text="${sample}"\n`);
    return { kind: 'prose' };
  } catch (err) {
    process.stderr.write(`[shape] detector LLM call failed, defaulting to prose. model=${model} err=${(err as Error).message}\n`);
    return { kind: 'prose' };
  }
}

/**
 * Idempotent: returns the existing schedule artifact's payload if one is
 * already on the loop; otherwise runs `detectOutputShape` AND `planLoop` and
 * writes a new `kind: 'schedule'` artifact carrying both. Called at child-
 * process start so that crash resume doesn't re-run either step (and doesn't
 * risk a different shape or plan on the second LLM pass). Returns the
 * SchedulePayload either way.
 *
 * Two sequential LLM calls — detection feeds planning, so they don't
 * parallelise. Both target the cheap nano model by default; per-step
 * overrides are available for tests.
 */
export async function ensureScheduleArtifact(
  sqlite: Sqlite,
  loop_id: LoopId,
  prompt: string,
  llm: LLMProvider,
  detectModel?: string,
  planModel?: string,
  mode?: string | null,
  models?: ScheduleModels,
): Promise<SchedulePayload> {
  const existing = listArtifacts(sqlite, loop_id, 'schedule');
  if (existing.length > 0) {
    return existing[0].payload as unknown as SchedulePayload;
  }
  // Wrap the LLM so detectOutputShape + planLoop's LLM calls accumulate cost
  // into the loop's envelope. Without this, the detect+plan pair (~2 cheap
  // completions per loop) consumes real USD invisibly.
  const tracker = withCostTracker(llm);
  const output_shape = await detectOutputShape(prompt, tracker.llm, detectModel);
  // Pass loop_id + sqlite so the planner emits `decision` events for each
  // canon entry / branch pick AND appends them to the loop's decision_log
  // artifact. Without these, the planner stays event-silent (unit-test mode).
  const plan = await planLoop(prompt, output_shape, tracker.llm, planModel, { loop_id, sqlite });
  if (tracker.total() > 0) bumpUsage(sqlite, loop_id, { cost_usd: tracker.total() });

  // Phase 5a — capture envelope + models + flags onto the schedule payload.
  // The engine still reads envelope from `loops.envelope` at runtime (fast path);
  // this is the durable record of "what was configured when the schedule was
  // built." Mode-derived flags (e.g. `dev` → `fake_llm: true`) come from
  // MODE_PROFILES so the engine has a single read path for opt-in behaviours.
  const loop = getLoop(sqlite, loop_id);
  const envelope = loop?.envelope;
  const modeFlags = mode && isMode(mode) ? MODE_PROFILES[mode].flags : undefined;
  const payload: SchedulePayload = {
    output_shape,
    plan,
    ...(envelope ? { envelope } : {}),
    ...(models ? { models } : {}),
    ...(modeFlags ? { flags: modeFlags } : {}),
    ...(mode ? { created_with_mode: mode } : {}),
  };
  createArtifact(sqlite, {
    loop_id,
    cycle_id: null,
    kind: 'schedule',
    payload: payload as unknown as Record<string, unknown>,
  });
  return payload;
}

/**
 * Pre-write a minimal schedule artifact at session-create time for Custom
 * mode — no LLM calls. The user lands on the Plan tab with an editable
 * draft (prose shape, fallback single-branch, no canon) and clicks Start
 * once they're happy. `ensureScheduleArtifact` is idempotent, so the
 * child's run.ts loop respects the draft (or whatever the user edited it
 * into) without re-running detection/planning.
 */
export function createDraftSchedule(
  sqlite: Sqlite,
  loop_id: LoopId,
  prompt: string,
  mode?: string | null,
): SchedulePayload {
  const loop = getLoop(sqlite, loop_id);
  const envelope = loop?.envelope;
  const modeFlags = mode && isMode(mode) ? MODE_PROFILES[mode].flags : undefined;
  const payload: SchedulePayload = {
    output_shape: { kind: 'prose' },
    plan: {
      canon: [],
      branches: [{ id: 'main', query: prompt }],
      per_branch_budget: 3,
      perturbation_weights: {},
      milestone_plan: [0.25, 0.5, 0.75, 1.0],
    },
    ...(envelope ? { envelope } : {}),
    ...(modeFlags ? { flags: modeFlags } : {}),
    ...(mode ? { created_with_mode: mode } : {}),
  };
  createArtifact(sqlite, {
    loop_id, cycle_id: null, kind: 'schedule',
    payload: payload as unknown as Record<string, unknown>,
  });
  return payload;
}

/**
 * Overwrite the latest schedule artifact's payload — Phase 5b's edit path.
 * Append-as-new-row so the change is auditable; the latest-by-created_at
 * read semantics in `readScheduleFromArtifacts` pick it up automatically.
 * Carries forward fields the patch didn't touch.
 */
export function updateScheduleArtifact(
  sqlite: Sqlite,
  loop_id: LoopId,
  patch: Partial<SchedulePayload>,
): SchedulePayload | null {
  const all = listArtifacts(sqlite, loop_id, 'schedule');
  if (all.length === 0) return null;
  const latest = all.reduce((a, b) => a.created_at > b.created_at ? a : b);
  const prior = latest.payload as unknown as SchedulePayload;
  const next: SchedulePayload = {
    output_shape: patch.output_shape ?? prior.output_shape,
    plan: patch.plan
      ? { ...prior.plan, ...patch.plan }
      : prior.plan,
    ...(patch.envelope ?? prior.envelope ? { envelope: patch.envelope ?? prior.envelope } : {}),
    ...(patch.models ?? prior.models ? { models: patch.models ?? prior.models } : {}),
    ...(patch.flags ?? prior.flags ? { flags: patch.flags ?? prior.flags } : {}),
    ...(prior.created_with_mode ? { created_with_mode: prior.created_with_mode } : {}),
  };
  createArtifact(sqlite, {
    loop_id, cycle_id: null, kind: 'schedule',
    payload: next as unknown as Record<string, unknown>,
  });
  return next;
}

/**
 * Read the schedule payload off a LoopState's artifact list. Templates call
 * this from inside their renderer / stop_rule so they don't need a separate
 * DB read — the engine already loads all artifacts into LoopState.
 *
 * Phase 5c — multiple schedule artifacts may exist on a loop once milestone
 * re-planning fires. Each re-plan writes a new `kind: 'schedule'` artifact
 * with `predecessor_id` linking to the prior. This function returns the
 * **latest** by `created_at` so engine reads automatically pick up the new
 * plan after a re-plan; replay readers can walk `predecessor_id` to see the
 * history.
 *
 * Returns null if no schedule artifact is present (e.g. for the noop
 * template, which doesn't get one written).
 */
export function readScheduleFromArtifacts(artifacts: Artifact[]): SchedulePayload | null {
  const schedules = artifacts.filter(a => a.kind === 'schedule');
  if (schedules.length === 0) return null;
  // Latest by created_at; SQLite ROWID ties broken by listArtifacts's ORDER BY created_at.
  let latest = schedules[0];
  for (const a of schedules) {
    if (a.created_at > latest.created_at) latest = a;
  }
  return latest.payload as unknown as SchedulePayload;
}

/**
 * Re-plan a loop's schedule at a milestone checkpoint. Fires the planner
 * with the prior plan's output_shape and the accumulated findings (read
 * indirectly via `planLoop`'s caller-visible prompt), splices the result so
 * the first `completed_branches` entries are preserved verbatim from the
 * prior plan (cycle index → branch mapping stays stable for already-finalized
 * cycles), and writes the new schedule as a `kind: 'schedule'` artifact
 * chained to the prior via `predecessor_id`.
 *
 * `planLoop` is total — on any LLM failure it returns its minimal fallback
 * plan (single branch on the prompt). The fallback's id may collide with a
 * preserved branch, in which case the de-dupe drops it and the re-plan
 * produces zero new branches; that's an acceptable outcome (loop continues
 * against the preserved prefix).
 */
export async function rePlanSchedule(
  sqlite: Sqlite,
  loop_id: LoopId,
  prompt: string,
  llm: LLMProvider,
  prior: SchedulePayload,
  prior_artifact_id: string,
  completed_branches: number,
  planModel?: string,
): Promise<SchedulePayload> {
  const tracker = withCostTracker(llm);
  const nextPlan = await planLoop(prompt, prior.output_shape, tracker.llm, planModel, { loop_id, sqlite });
  if (tracker.total() > 0) bumpUsage(sqlite, loop_id, { cost_usd: tracker.total() });

  // Splice: preserve the first `completed_branches` entries of the prior plan
  // verbatim so cycle index N (already finalized against prior.branches[N])
  // continues to map to the same branch. Append the planner's fresh
  // suggestions after the preserved prefix, de-duped by branch id.
  const preserved = prior.plan.branches.slice(0, completed_branches);
  const preservedIds = new Set(preserved.map(b => b.id));
  const fresh = nextPlan.branches.filter(b => !preservedIds.has(b.id));
  const splicedBranches = [...preserved, ...fresh];

  const payload: SchedulePayload = {
    output_shape: prior.output_shape,
    plan: { ...nextPlan, branches: splicedBranches },
    ...(prior.envelope ? { envelope: prior.envelope } : {}),
    ...(prior.models ? { models: prior.models } : {}),
    ...(prior.flags ? { flags: prior.flags } : {}),
    ...(prior.created_with_mode ? { created_with_mode: prior.created_with_mode } : {}),
    predecessor_id: prior_artifact_id,
  };

  createArtifact(sqlite, {
    loop_id,
    cycle_id: null,
    kind: 'schedule',
    payload: payload as unknown as Record<string, unknown>,
  });
  return payload;
}

// ---- Shape validation (renderer-as-gate) -------------------------------------

/**
 * Outcome of validating findings against the detected output shape. `missing`
 * carries shape-specific diagnostic structure so the renderer can surface
 * what's blocking the gate; null when satisfied. The renderer attaches this
 * to the render artifact and stop_rule consults it before declaring "done".
 *
 * For diagnostic structure per variant:
 *   - prose:    null (always satisfied)
 *   - list:     { needed_items: N, found_items: M }
 *   - table:    { columns: string[] } — names not found in any table header
 *   - timeline: { needed_events: N, found_events: M }
 *   - mixed:    { components: ShapeValidation[] }  // one per component
 */
export type ShapeMissing =
  | null
  | { columns: string[] }
  | { needed_items: number; found_items: number }
  | { needed_events: number; found_events: number }
  | { components: ShapeValidation[] };

export interface ShapeValidation {
  satisfied: boolean;
  shape_kind: OutputShape['kind'];
  missing: ShapeMissing;
}

/**
 * Validate the loop's findings against the detected output shape.
 *
 * Findings text = the concatenation of every `cycle_output[].payload.processor.text`
 * in artifact creation order. Templates that store synthesized prose elsewhere
 * would need a different collector; the research template stores text on the
 * processor output so this works directly.
 *
 * Validators are heuristic-default — Markdown table syntax, list-marker
 * counting, date-prefix detection. The design doc's principle (§6, §11) is
 * heuristic-first with optional LLM modulation later. Phase 3 ships the
 * heuristics; an opt-in LLM validator can swap in via the schedule artifact
 * in a later phase if cases reveal false positives/negatives.
 */
export function validateShape(state: LoopState, shape: OutputShape): ShapeValidation {
  const findingsText = collectFindingsText(state);
  return validateAgainstText(findingsText, shape);
}

function validateAgainstText(text: string, shape: OutputShape): ShapeValidation {
  switch (shape.kind) {
    case 'prose':
      return { satisfied: true, shape_kind: 'prose', missing: null };
    case 'table':
      return validateTable(text, shape.columns);
    case 'list':
      return validateList(text, shape.min_items ?? 5);
    case 'timeline':
      return validateTimeline(text, shape.min_events ?? 3);
    case 'mixed':
      return validateMixed(text, shape.components);
  }
}

function collectFindingsText(state: LoopState): string {
  return state.artifacts
    .filter(a => a.kind === 'cycle_output')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(a => {
      const proc = a.payload.processor as { text?: string } | undefined;
      return proc?.text ?? '';
    })
    .join('\n\n');
}

/**
 * Table validation — find a Markdown table whose header row contains every
 * required column (case-insensitive) AND has at least one data row beneath
 * the divider. Tolerates extra columns and varying whitespace. Reports the
 * required columns not found in the best-matched header as `missing.columns`.
 */
function validateTable(text: string, columns: string[]): ShapeValidation {
  const required = columns.map(c => c.toLowerCase().trim()).filter(c => c.length > 0);
  if (required.length === 0) {
    return { satisfied: true, shape_kind: 'table', missing: null };
  }

  const lines = text.split('\n');
  let bestMatched = new Set<string>();
  let satisfied = false;

  for (let i = 0; i < lines.length - 1; i++) {
    const headerLine = lines[i];
    const dividerLine = lines[i + 1];
    if (!isTableHeader(headerLine) || !isTableDivider(dividerLine)) continue;

    const headers = parseCells(headerLine);
    const matched = new Set<string>();
    for (const r of required) if (headers.includes(r)) matched.add(r);

    if (matched.size > bestMatched.size) bestMatched = matched;

    if (matched.size === required.length) {
      // Header covers every required column — check for at least one data row.
      const dataRow = lines[i + 2];
      if (dataRow && isTableHeader(dataRow) && parseCells(dataRow).some(c => c.length > 0)) {
        satisfied = true;
        break;
      }
    }
  }

  if (satisfied) return { satisfied: true, shape_kind: 'table', missing: null };
  const missing = required.filter(c => !bestMatched.has(c));
  return { satisfied: false, shape_kind: 'table', missing: { columns: missing } };
}

function isTableHeader(line: string): boolean {
  return line.trim().includes('|');
}

function isTableDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  return /^[\s|\-:]+$/.test(trimmed);
}

function parseCells(line: string): string[] {
  return line
    .split('|')
    .map(c => c.trim().toLowerCase())
    .filter(c => c.length > 0);
}

/**
 * List validation — count list markers in the findings text. Recognises
 * Markdown unordered (`- `, `* `, `+ `) and ordered (`1. `, `2. `, ...)
 * markers at the start of a line. Satisfied when count >= min_items.
 *
 * Phase 3.3 implements + tests this surface; Phase 3.2 ships it as part of
 * the validator API so the renderer signature can stabilise.
 */
function validateList(text: string, min_items: number): ShapeValidation {
  const count = countListItems(text);
  if (count >= min_items) {
    return { satisfied: true, shape_kind: 'list', missing: null };
  }
  return {
    satisfied: false,
    shape_kind: 'list',
    missing: { needed_items: min_items, found_items: count },
  };
}

function countListItems(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    if (/^\s*(?:[-*+]\s+|\d+\.\s+)\S/.test(line)) count++;
  }
  return count;
}

/**
 * Timeline validation — count date-prefixed events. Recognises common
 * patterns: leading year (`1750`, `**1750**`, `1750:`), or `Date: ` prefix.
 * Not in the deliverable case list, but the gate ships for completeness.
 */
function validateTimeline(text: string, min_events: number): ShapeValidation {
  const count = countTimelineEvents(text);
  if (count >= min_events) {
    return { satisfied: true, shape_kind: 'timeline', missing: null };
  }
  return {
    satisfied: false,
    shape_kind: 'timeline',
    missing: { needed_events: min_events, found_events: count },
  };
}

function countTimelineEvents(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\*{0,2}\d{3,4}\*{0,2}\s*[-:–—]/.test(trimmed)) count++;
    else if (/^date:\s*\d/i.test(trimmed)) count++;
  }
  return count;
}

/**
 * Mixed validation — AND-combine each component's validation. Phase 3.4
 * exercises this with the smashed-burgers deliverable case (prose + list).
 */
function validateMixed(text: string, components: OutputShape[]): ShapeValidation {
  const compResults = components.map(c => validateAgainstText(text, c));
  const allSatisfied = compResults.every(r => r.satisfied);
  if (allSatisfied) return { satisfied: true, shape_kind: 'mixed', missing: null };
  return { satisfied: false, shape_kind: 'mixed', missing: { components: compResults } };
}
