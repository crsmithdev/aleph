/**
 * Research template — Phase 2 of the v1 build plan.
 *
 * Four-hook implementation that exercises the engine boundary against a real
 * (or fake) LLM provider:
 *
 *  - processor   — one search round. Cycle 0 searches the original prompt;
 *                  later cycles use the first follow-up from the previous
 *                  cycle's derivation output. Returns synthesized text +
 *                  source URLs.
 *  - derivation  — asks the LLM for 2 follow-up queries (JSON array). Falls
 *                  back to a heuristic if the LLM response is malformed —
 *                  templates must never throw because of a bad LLM response;
 *                  the engine treats that as a step failure and the whole
 *                  loop dies. Heuristic = re-use the search query (loop pins
 *                  on one topic, harmless degradation).
 *  - renderer    — walks all `cycle_output` artifacts and assembles a single
 *                  `kind: 'render'` artifact with combined findings + a
 *                  deduplicated source list. Re-runs every cycle (and at
 *                  milestones) — the most recent render is the "current
 *                  answer" of the loop.
 *  - stop_rule   — completes once `cycles_target` cycle_output artifacts
 *                  exist. Output-shape gating (renderer-as-gate) lands in
 *                  Phase 3; Phase 2 uses a fixed cycle count.
 *
 * The template factory closes over `deps.llm`. Tests pass a `FakeLLMProvider`;
 * production passes `OpenRouterProvider` constructed by `run.ts` from env.
 */

import type { Sqlite } from '@construct/data';
import { emitDecisionEvent, recordDecision } from '../decisions.js';
import type {
  Template,
  LoopState,
  Artifact,
  OutputShape,
  IterationCheckPayload,
  PostMortemPayload,
  DecisionPayload,
} from '../types.js';
import type { LLMProvider } from '../llm.js';
import { readScheduleFromArtifacts, rePlanSchedule, validateShape, type ShapeMissing } from '../shape.js';

export interface ResearchTemplateOptions {
  cycles_target?: number;
  search_model?: string;
  complete_model?: string;
  /** Model for the optional milestone iteration-check hook. */
  iteration_check_model?: string;
  /** Model for the optional natural-completion post-mortem hook. */
  post_mortem_model?: string;
  /**
   * Hard cap on cycles. The stop_rule gates "done" on (cycles_target reached
   * AND shape_satisfied); if the shape gate never satisfies — e.g. the LLM
   * can't produce a table for a table-shape query — the loop terminates
   * anyway at this many cycles with `shape_unreachable` as the reason.
   * Default = 2 * cycles_target. Phase 5 will replace this with the
   * marginal-value-stop check.
   */
  max_cycles?: number;
}

export interface ResearchTemplateDeps {
  llm: LLMProvider;
  /**
   * Optional sqlite handle. When supplied, the derivation hook's
   * `followup_pick` decisions are appended to the loop's `decision_log`
   * artifact in addition to firing on the event bus. Without it the
   * decisions are event-only — they still flow through the SSE stream and
   * land in the NDJSON log, but the post-hoc artifact is incomplete.
   *
   * `run.ts` (production) currently passes only `{ llm }`; the orchestrator
   * needs to thread sqlite through `buildDeps` for derivation-side artifact
   * appends to land in prod. Tests pass it explicitly.
   */
  sqlite?: Sqlite;
}

/** Default models. Phase 5 will move per-loop model selection onto the
 *  schedule artifact; until then these are the engine-wide defaults. Both
 *  point at Gemini Flash — reasoning models (openai/gpt-5-nano, o1-mini)
 *  exhaust max_tokens on hidden reasoning and return empty content for
 *  prompts over ~200 chars, which silently kills the follow-up parser. */
const DEFAULT_SEARCH_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_COMPLETE_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_ITERATION_CHECK_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_POST_MORTEM_MODEL = 'google/gemini-2.0-flash-001';
const ITERATION_CHECK_MAX_TOKENS = 400;
const POST_MORTEM_MAX_TOKENS = 800;

interface ProcessorOutput {
  kind: 'research_proc';
  query: string;
  text: string;
  source_urls: string[];
  source_meta: Array<{ url: string; title: string; snippet: string }>;
  tokens: { prompt: number; completion: number };
  model: string;
}

interface DerivationOutput {
  kind: 'research_deriv';
  followups: string[];
}

/**
 * Per-source extraction status. Plumbed so the Activity > Source Extraction
 * panel can show failure rates and top failing domains — even when richer
 * per-URL failure data isn't available yet from the websearch provider.
 *
 *   - `extracted`    — fetch succeeded and the source returned with metadata.
 *   - `snippet_only` — partial: source came back without title/snippet
 *                      (websearch.ts doesn't surface this case today, but
 *                      the field is plumbed for when it does).
 *   - `failed`       — URL was attempted but didn't make it into the
 *                      processor's `source_meta`. v0 signal: any URL in
 *                      `proc.source_urls` missing from `proc.source_meta`
 *                      is marked failed with reason 'no metadata returned'.
 */
export type SourceExtractionStatus = 'extracted' | 'snippet_only' | 'failed';

export interface RenderSourceEntry {
  url: string;
  title: string;
  extraction_status: SourceExtractionStatus;
  /** Number of fetch attempts. v0 always 1 — websearch.ts has no retry
   *  loop. Field exists so a future provider with retry can populate it
   *  without a schema migration. */
  attempts: number;
  /** Human-readable failure reason. Set when `extraction_status === 'failed'`;
   *  undefined for the success path. */
  error?: string;
}

interface RenderOutput {
  kind: 'render';
  findings: Array<{ cycle: number; query: string; text: string }>;
  sources: RenderSourceEntry[];
  cycles_rendered: number;
  /**
   * Phase 3 — the renderer is the gate. It validates the accumulated findings
   * against the schedule's detected output_shape and surfaces the result on
   * the render artifact for the UI + stop_rule. Defaults to `prose` shape
   * (always satisfied) when no schedule artifact exists.
   */
  shape_kind: OutputShape['kind'];
  shape_satisfied: boolean;
  shape_missing: ShapeMissing;
}

export function makeResearchTemplate(
  prompt: string,
  opts: ResearchTemplateOptions,
  deps: ResearchTemplateDeps,
): Template<ProcessorOutput, DerivationOutput, RenderOutput> {
  const target = opts.cycles_target ?? 3;
  const maxCycles = opts.max_cycles ?? target * 2;
  const searchModel = opts.search_model ?? DEFAULT_SEARCH_MODEL;
  const completeModel = opts.complete_model ?? DEFAULT_COMPLETE_MODEL;
  const iterationCheckModel = opts.iteration_check_model ?? DEFAULT_ITERATION_CHECK_MODEL;
  const postMortemModel = opts.post_mortem_model ?? DEFAULT_POST_MORTEM_MODEL;

  return {
    id: 'research',

    async processor(input, state) {
      const { cycle_index } = input as { cycle_index: number };
      const query = pickQuery(prompt, cycle_index, state.artifacts);
      const result = await deps.llm.searchWeb(searchModel, query);
      return {
        output: {
          kind: 'research_proc',
          query,
          text: result.text,
          source_urls: result.sourceUrls,
          source_meta: result.sourceUrlMeta ?? [],
          tokens: { prompt: result.promptTokens, completion: result.completionTokens },
          model: result.model,
        },
        cost_usd: result.cost_usd,
      };
    },

    async derivation(state, processor_output) {
      const completion = await deps.llm.complete(
        completeModel,
        buildFollowupPrompt(prompt, processor_output),
        300,
      );
      const parsed = parseFollowupsRich(completion.text, processor_output.query);
      // Emit one `followup_pick` decision per parsed follow-up. The first
      // entry is the one pickQuery will use on the next cycle — accepted;
      // the rest are bookkept for the UI / future use — not accepted. When
      // the parser fell back (malformed response), the single returned
      // entry is the reused query with `reason: 'fallback'`.
      emitFollowupDecisions(state, parsed, deps);
      return {
        output: { kind: 'research_deriv', followups: parsed.followups },
        cost_usd: completion.cost_usd,
      };
    },

    async renderer(state) {
      const findings: RenderOutput['findings'] = [];
      const seen = new Set<string>();
      const sources: RenderSourceEntry[] = [];
      const cycleOutputs = state.artifacts
        .filter(a => a.kind === 'cycle_output')
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const art of cycleOutputs) {
        const proc = art.payload.processor as ProcessorOutput | undefined;
        if (!proc || proc.kind !== 'research_proc') continue;
        findings.push({ cycle: findings.length, query: proc.query, text: proc.text });
        // Every URL the processor returned metadata for is a successful
        // extraction. v0 sets attempts=1 because websearch.ts has no retry
        // loop — when it grows one, attempts can climb without breaking the
        // wire format.
        const metaByUrl = new Map<string, { title: string; snippet: string }>();
        for (const m of proc.source_meta) {
          metaByUrl.set(m.url, { title: m.title, snippet: m.snippet });
        }
        for (const m of proc.source_meta) {
          if (seen.has(m.url)) continue;
          seen.add(m.url);
          sources.push({
            url: m.url,
            title: m.title,
            extraction_status: 'extracted',
            attempts: 1,
          });
        }
        // URLs the processor *attempted* but the provider didn't return
        // metadata for. v0 signal: any source_urls entry missing from
        // source_meta is a failed extraction with reason 'no metadata
        // returned'. When websearch.ts grows per-URL failure data the
        // reason string can carry it through.
        for (const url of proc.source_urls) {
          if (metaByUrl.has(url)) continue;
          if (seen.has(url)) continue;
          seen.add(url);
          sources.push({
            url,
            title: '',
            extraction_status: 'failed',
            attempts: 1,
            error: 'no metadata returned',
          });
        }
      }
      const shape = readShape(state);
      const validation = validateShape(state, shape);
      return {
        output: {
          kind: 'render',
          findings,
          sources,
          cycles_rendered: findings.length,
          shape_kind: validation.shape_kind,
          shape_satisfied: validation.satisfied,
          shape_missing: validation.missing,
        },
        cost_usd: 0,
      };
    },

    async stop_rule(state) {
      const completed = countCycleOutputs(state);
      const shape = readShape(state);
      const satisfied = validateShape(state, shape).satisfied;

      // Effective target floors at branches.length so every planned branch
      // gets a cycle. Without this, a 6-branch plan against the API's
      // default cycles_target=3 would stop after 3 cycles — leaving half the
      // planner's investigation threads unran. Surfaced by the V8 dogfood
      // loop where the `predecessor-comparison` and `memory-management`
      // branches never executed; the polished document was rated misleading
      // by omission as a direct consequence.
      // Defensive option-chaining: shape-only schedule artifacts (used in
      // some tests and in degenerate prod paths where the planner didn't
      // emit a plan) omit `plan`, so branches is treated as zero.
      const schedule = readScheduleFromArtifacts(state.artifacts);
      const branchCount = schedule?.plan?.branches?.length ?? 0;
      const effectiveTarget = Math.max(target, branchCount);
      const effectiveMaxCycles = Math.max(maxCycles, effectiveTarget * 2);

      // Best-effort escape hatch: if the loop has burned through the
      // effective max_cycles without satisfying the shape, accept the
      // partial result and stop (`shape_unreachable`). Without this the
      // engine's max_iterations safety belt would eventually trip — but as
      // a `failed` status, not a graceful `completed`. The render artifact
      // still records shape_satisfied=false so the UI can flag the
      // incomplete output.
      if (completed >= effectiveMaxCycles) {
        return {
          done: true,
          reason: satisfied
            ? `research_target_reached:${effectiveTarget}`
            : `shape_unreachable:${shape.kind}:${effectiveMaxCycles}`,
        };
      }
      if (completed >= effectiveTarget && satisfied) {
        return { done: true, reason: `research_target_reached:${effectiveTarget}` };
      }
      return { done: false };
    },

    async iterationCheck(state, milestonePct) {
      const completion = await deps.llm.complete(
        iterationCheckModel,
        buildIterationCheckPrompt(prompt, state, milestonePct),
        ITERATION_CHECK_MAX_TOKENS,
      );
      const verdict = parseIterationCheck(completion.text, milestonePct, iterationCheckModel);
      return { output: verdict, cost_usd: completion.cost_usd };
    },

    /**
     * Milestone re-planner. Fires the planner with the prior schedule's
     * output_shape (kept stable across re-plans) and the accumulated
     * findings; splices the result so finished branches stay at their
     * original positions and only the tail is re-arranged.
     *
     * Without sqlite, this is a no-op — unit tests that instantiate the
     * template directly don't get a re-plan side effect, which matches the
     * iteration_check / post_mortem pattern.
     */
    async rePlan(state) {
      if (!deps.sqlite) return { output: undefined, cost_usd: 0 };
      const sched = state.artifacts.find(a => a.kind === 'schedule');
      if (!sched) return { output: undefined, cost_usd: 0 };
      const prior = sched.payload as unknown as import('../types.js').SchedulePayload;
      const completed = countCycleOutputs(state);
      const before = state.envelope_consumed.cost_usd;
      await rePlanSchedule(
        deps.sqlite, state.loop.id, prompt, deps.llm,
        prior, sched.id, completed,
      );
      // rePlanSchedule writes cost via bumpUsage; report 0 here so the engine
      // doesn't double-count.
      void before;
      return { output: undefined, cost_usd: 0 };
    },

    async postMortem(state) {
      const completion = await deps.llm.complete(
        postMortemModel,
        buildPostMortemPrompt(prompt, state),
        POST_MORTEM_MAX_TOKENS,
      );
      const verdict = parsePostMortem(completion.text, state, postMortemModel);
      return { output: verdict, cost_usd: completion.cost_usd };
    },
  };
}

function countCycleOutputs(state: LoopState): number {
  return state.artifacts.filter(a => a.kind === 'cycle_output').length;
}

/** Pull the detected output_shape off the schedule artifact, defaulting to
 *  `prose` (always-satisfied gate) when none exists — e.g. unit tests that
 *  construct the template directly without going through `ensureScheduleArtifact`. */
function readShape(state: LoopState): OutputShape {
  return readScheduleFromArtifacts(state.artifacts)?.output_shape ?? { kind: 'prose' };
}

/** Pick the seed query for the cycle.
 *
 *  Phase 4: when the schedule artifact carries a planner-emitted
 *  `branches[]`, cycle `N` uses `branches[N].query` directly — the planner
 *  owns thread topology, not the derivation chain. Branches are exhausted
 *  once `cycle_index >= branches.length`, at which point the loop falls
 *  through to the Phase-2 derivation pickup.
 *
 *  Phase-2 fallback (also used when no schedule exists, e.g. unit tests
 *  that instantiate the template directly): cycle 0 searches the prompt;
 *  cycle N walks the most recent derivation output for its first follow-up.
 *  If neither path produces a query, the prompt is the safe default —
 *  re-searching the same thing degrades the loop rather than crashing it,
 *  and the stop_rule still terminates on `cycles_target`. */
function pickQuery(prompt: string, cycle_index: number, artifacts: Artifact[]): string {
  const plan = readScheduleFromArtifacts(artifacts)?.plan;
  if (plan && cycle_index < plan.branches.length) {
    return plan.branches[cycle_index].query;
  }
  if (cycle_index === 0) return prompt;
  const cycleOutputs = artifacts
    .filter(a => a.kind === 'cycle_output')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (let i = cycleOutputs.length - 1; i >= 0; i--) {
    const deriv = cycleOutputs[i].payload.derivation as DerivationOutput | undefined;
    if (deriv?.followups?.length) return deriv.followups[0];
  }
  return prompt;
}

function buildFollowupPrompt(prompt: string, proc: ProcessorOutput): string {
  return [
    `Research prompt: ${prompt}`,
    ``,
    `Most recent search query: ${proc.query}`,
    ``,
    `Findings (truncated):`,
    proc.text.slice(0, 1500),
    ``,
    `Propose 2 follow-up search queries that explore unanswered angles of the original prompt.`,
    `Return a JSON array of strings, e.g. ["query 1", "query 2"]. No prose, no markdown — JSON only.`,
  ].join('\n');
}

/**
 * Parse-result envelope. `followups` is what the derivation hook hands the
 * engine; `from_fallback` tells the decision emitter whether the LLM
 * produced something usable or we degraded to the prior query — which the
 * UI surfaces as `reason: 'fallback'` on the decision event.
 */
interface ParsedFollowups {
  followups: string[];
  from_fallback: boolean;
}

/** Parse a JSON array of strings from the model response. Tolerant: strips
 *  code fences, accepts 1-or-more entries, falls back to the previous query
 *  on any failure so a malformed response never tanks the loop.
 *
 *  Commandment 1: the fallback is now observable on stderr — a regression
 *  here looks like "every cycle searches the same query," which used to be
 *  invisible because both the planner and this parser silently degraded. */
function parseFollowupsRich(text: string, fallbackQuery: string): ParsedFollowups {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (strings.length > 0) {
        return { followups: strings.slice(0, 2), from_fallback: false };
      }
    }
  } catch (err) {
    const sample = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    process.stderr.write(`[research-template] derivation parse failed, reusing query. err=${(err as Error).message} text="${sample}"\n`);
    return { followups: [fallbackQuery], from_fallback: true };
  }
  // Reached the bottom without returning — response wasn't a non-empty array
  // of strings. Log the shape we did get so the fall-back is observable.
  const sample = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  process.stderr.write(`[research-template] derivation returned unusable shape, reusing query. text="${sample}"\n`);
  return { followups: [fallbackQuery], from_fallback: true };
}

/**
 * Emit one `followup_pick` decision per parsed follow-up. The first wins
 * the next-cycle seat (`accepted: true`); the rest are bookkept
 * (`accepted: false`). When the parser fell back (malformed response), the
 * single entry carries `reason: 'fallback'` so the UI can flag it.
 *
 * sqlite-when-available: deps.sqlite enables the persisted decision_log
 * artifact append. Without it the decisions are event-only — see the
 * comment on `ResearchTemplateDeps.sqlite`.
 */
function emitFollowupDecisions(
  state: LoopState,
  parsed: ParsedFollowups,
  deps: ResearchTemplateDeps,
): void {
  const cycle = findRunningCycle(state);
  if (!cycle) return;  // derivation called outside a cycle — defensive, shouldn't happen.
  const loop_id = state.loop.id;
  const total = parsed.followups.length;
  parsed.followups.forEach((query, index) => {
    const decision: DecisionPayload = {
      type: 'followup_pick',
      query,
      accepted: index === 0,
      index,
      total,
      cycle_id: cycle.id,
      ...(parsed.from_fallback ? { reason: 'fallback' as const } : {}),
    };
    if (deps.sqlite) recordDecision(deps.sqlite, loop_id, decision);
    else emitDecisionEvent(loop_id, decision);
  });
}

/** The cycle the engine is mid-flight on when derivation runs is the only
 *  one in `running` state. Returns null defensively (the hook itself would
 *  short-circuit). */
function findRunningCycle(state: LoopState) {
  return state.cycles.find(c => c.status === 'running') ?? null;
}

/** Strip ```json fences / trailing prose and return a parsed JSON object, or
 *  null if the body isn't recoverable. Shared by both iteration-check and
 *  post-mortem parsers. */
function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to brace-extraction
  }
  // Last-ditch: find the outermost { ... } in the text and try that.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  return null;
}

function summariseFindings(state: LoopState): string {
  const cycleOutputs = state.artifacts
    .filter(a => a.kind === 'cycle_output')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (cycleOutputs.length === 0) return '(no findings yet)';
  return cycleOutputs.map((art, i) => {
    const proc = art.payload.processor as ProcessorOutput | undefined;
    const query = proc?.query ?? '(unknown)';
    const text = (proc?.text ?? '').slice(0, 400);
    return `[cycle ${i}] query=${query}\n${text}`;
  }).join('\n\n');
}

function buildIterationCheckPrompt(prompt: string, state: LoopState, milestonePct: 25 | 50 | 75): string {
  return [
    `Original research prompt: ${prompt}`,
    ``,
    `The loop has consumed approximately ${milestonePct}% of its envelope.`,
    `Accumulated findings so far:`,
    summariseFindings(state),
    ``,
    `Decide whether the loop is on track to answer the original prompt.`,
    `Return JSON only, matching this shape:`,
    `{`,
    `  "verdict": "on_track" | "drifting" | "needs_correction",`,
    `  "notes": "1-3 sentence rationale visible to the user"`,
    `}`,
    `No prose, no markdown — JSON only.`,
  ].join('\n');
}

function parseIterationCheck(
  text: string,
  milestonePct: 25 | 50 | 75,
  model: string,
): IterationCheckPayload {
  const parsed = tryParseJsonObject(text);
  if (parsed) {
    const verdict = parsed.verdict;
    const notes = typeof parsed.notes === 'string' ? parsed.notes : '';
    const correction = (parsed.correction && typeof parsed.correction === 'object' && !Array.isArray(parsed.correction))
      ? parsed.correction as Record<string, unknown>
      : undefined;
    if (verdict === 'on_track' || verdict === 'drifting' || verdict === 'needs_correction') {
      return { at_envelope_pct: milestonePct, verdict, notes, correction, model };
    }
  }
  const sample = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  process.stderr.write(`[research-template] iteration_check parse failed at ${milestonePct}%, defaulting to on_track. text="${sample}"\n`);
  return {
    at_envelope_pct: milestonePct,
    verdict: 'on_track',
    notes: '(LLM response unparseable)',
    model,
  };
}

function buildPostMortemPrompt(prompt: string, state: LoopState): string {
  const cycleCount = state.artifacts.filter(a => a.kind === 'cycle_output').length;
  return [
    `Original research prompt: ${prompt}`,
    ``,
    `The loop completed naturally after ${cycleCount} cycles.`,
    `Envelope consumed: ${JSON.stringify(state.envelope_consumed)}.`,
    ``,
    `Accumulated findings:`,
    summariseFindings(state),
    ``,
    `Produce a post-mortem verdict for the user. Return JSON only:`,
    `{`,
    `  "verdict": "success" | "partial" | "failure",`,
    `  "flags": ["short", "actionable", "issues"],`,
    `  "recommendations": ["concrete", "next", "steps"]`,
    `}`,
    `No prose, no markdown — JSON only.`,
  ].join('\n');
}

function parsePostMortem(text: string, state: LoopState, model: string): PostMortemPayload {
  const metricsSnapshot: Record<string, unknown> = {
    cycles_completed: state.artifacts.filter(a => a.kind === 'cycle_output').length,
    envelope_consumed: state.envelope_consumed,
  };
  const parsed = tryParseJsonObject(text);
  if (parsed) {
    const verdict = parsed.verdict;
    const flags = Array.isArray(parsed.flags)
      ? parsed.flags.filter((s): s is string => typeof s === 'string')
      : [];
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((s): s is string => typeof s === 'string')
      : [];
    if (verdict === 'success' || verdict === 'partial' || verdict === 'failure') {
      return { verdict, flags, recommendations, metrics_snapshot: metricsSnapshot, model };
    }
  }
  const sample = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  process.stderr.write(`[research-template] post_mortem parse failed, defaulting to partial. text="${sample}"\n`);
  return {
    verdict: 'partial',
    flags: ['llm_response_unparseable'],
    recommendations: [],
    metrics_snapshot: metricsSnapshot,
    model,
  };
}
