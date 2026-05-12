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

import type { Template, LoopState, Artifact } from '../types.js';
import type { LLMProvider } from '../llm.js';

export interface ResearchTemplateOptions {
  cycles_target?: number;
  search_model?: string;
  complete_model?: string;
}

export interface ResearchTemplateDeps {
  llm: LLMProvider;
}

/** Default models for Phase 2. The Phase 4+ adaptive planner will override
 *  these per-loop; Phase 2 just needs sensible defaults so the template runs
 *  out of the box. Cheap-but-usable selections — Gemini Flash for synthesis
 *  (cheap + decent web search), gpt-5-nano for the JSON follow-up call. */
const DEFAULT_SEARCH_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_COMPLETE_MODEL = 'openai/gpt-5-nano';

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
}

export function makeResearchTemplate(
  prompt: string,
  opts: ResearchTemplateOptions,
  deps: ResearchTemplateDeps,
): Template<ProcessorOutput, DerivationOutput, RenderOutput> {
  const target = opts.cycles_target ?? 3;
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
      return { kind: 'render', findings, sources, cycles_rendered: findings.length };
    },

    async stop_rule(state) {
      const completed = countCycleOutputs(state);
      if (completed >= target) {
        return { done: true, reason: `research_target_reached:${target}` };
      }
      return { done: false };
    },
  };
}

function countCycleOutputs(state: LoopState): number {
  return state.artifacts.filter(a => a.kind === 'cycle_output').length;
}

/** Cycle 0 searches the original prompt. Cycle N uses the first follow-up
 *  from the previous cycle's derivation. If derivation didn't surface any
 *  follow-ups, fall back to the prompt — the loop degrades to "re-search
 *  the same thing" rather than crashing, and the stop_rule still terminates
 *  on cycles_target. */
function pickQuery(prompt: string, cycle_index: number, artifacts: Artifact[]): string {
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
 *  on any failure so a malformed response never tanks the loop. */
function parseFollowups(text: string, fallbackQuery: string): string[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (strings.length > 0) return strings.slice(0, 2);
    }
  } catch {
    // intentional — heuristic fallback
  }
  return [fallbackQuery];
}
