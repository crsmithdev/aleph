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
import { createArtifact, listArtifacts } from './db.js';
import type { LLMProvider } from './llm.js';
import type { Artifact, LoopId, OutputShape, SchedulePayload } from './types.js';

const DEFAULT_DETECT_MODEL = 'openai/gpt-5-nano';
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
    'Examples:',
    '  Prompt: "How does a sourdough starter develop?"',
    '  → {"kind":"prose"}',
    '',
    '  Prompt: "What are the best places in Berkeley to volunteer?"',
    '  → {"kind":"list","min_items":5}',
    '',
    '  Prompt: "Compare HSV and HPV: transmission, symptoms, treatment, vaccine."',
    '  → {"kind":"table","columns":["transmission","symptoms","treatment","vaccine"]}',
    '',
    '  Prompt: "Major events in the development of the smashed-burger style, plus 5 best places to get one."',
    '  → {"kind":"mixed","components":[{"kind":"prose"},{"kind":"list","min_items":5}]}',
    '',
    '  Prompt: "Major events in the history of the printing press"',
    '  → {"kind":"timeline","min_events":3}',
    '',
    `Prompt: ${JSON.stringify(userPrompt)}`,
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
    return shape ?? { kind: 'prose' };
  } catch {
    return { kind: 'prose' };
  }
}

/**
 * Idempotent: returns the existing schedule artifact's payload if one is
 * already on the loop; otherwise runs `detectOutputShape` and writes a new
 * `kind: 'schedule'` artifact. Called at child-process start so that crash
 * resume doesn't re-run detection (and doesn't risk a different shape on
 * the second LLM call). Returns the SchedulePayload either way.
 */
export async function ensureScheduleArtifact(
  sqlite: Sqlite,
  loop_id: LoopId,
  prompt: string,
  llm: LLMProvider,
  detectModel?: string,
): Promise<SchedulePayload> {
  const existing = listArtifacts(sqlite, loop_id, 'schedule');
  if (existing.length > 0) {
    return existing[0].payload as unknown as SchedulePayload;
  }
  const output_shape = await detectOutputShape(prompt, llm, detectModel);
  const payload: SchedulePayload = { output_shape };
  createArtifact(sqlite, {
    loop_id,
    cycle_id: null,
    kind: 'schedule',
    payload: payload as unknown as Record<string, unknown>,
  });
  return payload;
}

/**
 * Read the schedule payload off a LoopState's artifact list. Templates call
 * this from inside their renderer / stop_rule so they don't need a separate
 * DB read — the engine already loads all artifacts into LoopState.
 *
 * Returns null if no schedule artifact is present (e.g. for the noop
 * template, which doesn't get one written).
 */
export function readScheduleFromArtifacts(artifacts: Artifact[]): SchedulePayload | null {
  const schedule = artifacts.find(a => a.kind === 'schedule');
  if (!schedule) return null;
  return schedule.payload as unknown as SchedulePayload;
}
