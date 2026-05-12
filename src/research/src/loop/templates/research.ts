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

import type { Template, LoopState, Artifact, OutputShape } from '../types.js';
import type { LLMProvider } from '../llm.js';
import { readScheduleFromArtifacts, validateShape, type ShapeMissing } from '../shape.js';

export interface ResearchTemplateOptions {
  cycles_target?: number;
  search_model?: string;
  complete_model?: string;
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
}

/** Default models. Phase 5 will move per-loop model selection onto the
 *  schedule artifact; until then these are the engine-wide defaults. Both
 *  point at Gemini Flash — reasoning models (openai/gpt-5-nano, o1-mini)
 *  exhaust max_tokens on hidden reasoning and return empty content for
 *  prompts over ~200 chars, which silently kills the follow-up parser. */
const DEFAULT_SEARCH_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_COMPLETE_MODEL = 'google/gemini-2.0-flash-001';

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

interface RenderOutput {
  kind: 'render';
  findings: Array<{ cycle: number; query: string; text: string }>;
  sources: Array<{ url: string; title: string }>;
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

  return {
    id: 'research',

    async processor(input, state) {
      const { cycle_index } = input as { cycle_index: number };
      const query = pickQuery(prompt, cycle_index, state.artifacts);
      const result = await deps.llm.searchWeb(searchModel, query);
      return {
        kind: 'research_proc',
        query,
        text: result.text,
        source_urls: result.sourceUrls,
        source_meta: result.sourceUrlMeta ?? [],
        tokens: { prompt: result.promptTokens, completion: result.completionTokens },
        model: result.model,
      };
    },

    async derivation(_state, processor_output) {
      const completion = await deps.llm.complete(
        completeModel,
        buildFollowupPrompt(prompt, processor_output),
        300,
      );
      const followups = parseFollowups(completion.text, processor_output.query);
      return { kind: 'research_deriv', followups };
    },

    async renderer(state) {
      const findings: RenderOutput['findings'] = [];
      const seen = new Set<string>();
      const sources: RenderOutput['sources'] = [];
      const cycleOutputs = state.artifacts
        .filter(a => a.kind === 'cycle_output')
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      for (const art of cycleOutputs) {
        const proc = art.payload.processor as ProcessorOutput | undefined;
        if (!proc || proc.kind !== 'research_proc') continue;
        findings.push({ cycle: findings.length, query: proc.query, text: proc.text });
        for (const m of proc.source_meta) {
          if (seen.has(m.url)) continue;
          seen.add(m.url);
          sources.push({ url: m.url, title: m.title });
        }
      }
      const shape = readShape(state);
      const validation = validateShape(state, shape);
      return {
        kind: 'render',
        findings,
        sources,
        cycles_rendered: findings.length,
        shape_kind: validation.shape_kind,
        shape_satisfied: validation.satisfied,
        shape_missing: validation.missing,
      };
    },

    async stop_rule(state) {
      const completed = countCycleOutputs(state);
      const shape = readShape(state);
      const satisfied = validateShape(state, shape).satisfied;

      // Best-effort escape hatch: if the loop has burned through max_cycles
      // without satisfying the shape, accept the partial result and stop
      // (`shape_unreachable`). Without this the engine's max_iterations
      // safety belt would eventually trip — but as a `failed` status, not
      // a graceful `completed`. The render artifact still records
      // shape_satisfied=false so the UI can flag the incomplete output.
      if (completed >= maxCycles) {
        return {
          done: true,
          reason: satisfied
            ? `research_target_reached:${target}`
            : `shape_unreachable:${shape.kind}:${maxCycles}`,
        };
      }
      if (completed >= target && satisfied) {
        return { done: true, reason: `research_target_reached:${target}` };
      }
      return { done: false };
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

/** Parse a JSON array of strings from the model response. Tolerant: strips
 *  code fences, accepts 1-or-more entries, falls back to the previous query
 *  on any failure so a malformed response never tanks the loop.
 *
 *  Commandment 1: the fallback is now observable on stderr — a regression
 *  here looks like "every cycle searches the same query," which used to be
 *  invisible because both the planner and this parser silently degraded. */
function parseFollowups(text: string, fallbackQuery: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (strings.length > 0) return strings.slice(0, 2);
    }
  } catch (err) {
    const sample = text.slice(0, 200).replace(/\s+/g, ' ').trim();
    process.stderr.write(`[research-template] derivation parse failed, reusing query. err=${(err as Error).message} text="${sample}"\n`);
    return [fallbackQuery];
  }
  // Reached the bottom without returning — response wasn't a non-empty array
  // of strings. Log the shape we did get so the fall-back is observable.
  const sample = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  process.stderr.write(`[research-template] derivation returned unusable shape, reusing query. text="${sample}"\n`);
  return [fallbackQuery];
}
