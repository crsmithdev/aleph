/**
 * Monitor template — Phase 2 of the v1 build plan.
 *
 * Lighter than research: cycles alternate between "wait" (do nothing) and
 * "run" (poll the source). The point of this template in v1 is to prove the
 * engine + four-hook contract handles a poll/diff workload as well as a
 * search/extract one, keeping the engine boundary honest.
 *
 * Phase 2 shape (build plan ~line 150 — "wait-cycles, run-cycles, diff-
 * renderer"):
 *
 *  - processor   — on a run-cycle, calls deps.llm.searchWeb(query) to get
 *                  fresh data. On a wait-cycle, returns a noop output.
 *                  cycle_index % poll_every === 0 → run-cycle.
 *  - derivation  — on a run-cycle, diffs the current poll against the most
 *                  recent prior poll's text and emits `{ changed, diff }`.
 *                  On a wait-cycle, emits `{ skipped: true }`.
 *  - renderer    — walks all monitor_run cycle_output artifacts and
 *                  assembles a `kind: 'monitor_report'` artifact listing
 *                  each poll + its diff descriptor.
 *  - stop_rule   — completes once `cycles_target` cycle_output artifacts
 *                  exist. Real time-based scheduling (event-triggered
 *                  background work) lands at v3.
 *
 * The "diff" is a length-based heuristic for Phase 2 — comparing strings for
 * meaningful semantic change is a Phase 3+ feature (renderer-as-gate uses
 * the same primitive). The boundary that matters here is the renderer being
 * the place where cycle-comparison logic lives.
 */

import type { Template, Artifact } from '../types.js';
import type { LLMProvider } from '../llm.js';

export interface MonitorTemplateOptions {
  cycles_target?: number;
  /** Every Nth cycle is a run-cycle (0-indexed). Default 2: alternating run/wait. */
  poll_every?: number;
  search_model?: string;
}

export interface MonitorTemplateDeps {
  llm: LLMProvider;
}

const DEFAULT_SEARCH_MODEL = 'google/gemini-2.0-flash-001';

type ProcessorOutput =
  | {
      kind: 'monitor_run';
      query: string;
      text: string;
      source_urls: string[];
      polled_at: string;
      model: string;
    }
  | {
      kind: 'monitor_wait';
      cycle: number;
    };

type DerivationOutput =
  | {
      kind: 'monitor_diff';
      changed: boolean;
      current_length: number;
      prior_length: number | null;
      summary: string;
    }
  | {
      kind: 'monitor_skipped';
    };

interface MonitorReport {
  kind: 'monitor_report';
  polls: Array<{ cycle: number; query: string; text: string; polled_at: string }>;
  diffs: Array<{ from_cycle: number; to_cycle: number; changed: boolean; summary: string }>;
  total_polls: number;
}

export function makeMonitorTemplate(
  prompt: string,
  opts: MonitorTemplateOptions,
  deps: MonitorTemplateDeps,
): Template<ProcessorOutput, DerivationOutput, MonitorReport> {
  const target = opts.cycles_target ?? 4;
  const pollEvery = Math.max(1, opts.poll_every ?? 2);
  const searchModel = opts.search_model ?? DEFAULT_SEARCH_MODEL;

  return {
    id: 'monitor',

    async processor(input, _state) {
      const { cycle_index } = input as { cycle_index: number };
      const isRunCycle = cycle_index % pollEvery === 0;
      if (!isRunCycle) {
        return { kind: 'monitor_wait', cycle: cycle_index };
      }
      const result = await deps.llm.searchWeb(searchModel, prompt);
      return {
        kind: 'monitor_run',
        query: prompt,
        text: result.text,
        source_urls: result.sourceUrls,
        polled_at: new Date().toISOString(),
        model: result.model,
      };
    },

    async derivation(state, processor_output) {
      if (processor_output.kind === 'monitor_wait') {
        return { kind: 'monitor_skipped' };
      }
      const prior = findPriorRun(state.artifacts);
      const currentLen = processor_output.text.length;
      const priorLen = prior?.text.length ?? null;
      const changed = prior === null
        ? true
        : processor_output.text !== prior.text;
      const summary = priorLen === null
        ? `first poll: ${currentLen} chars`
        : `${priorLen} -> ${currentLen} chars${changed ? ' (changed)' : ' (unchanged)'}`;
      return { kind: 'monitor_diff', changed, current_length: currentLen, prior_length: priorLen, summary };
    },

    async renderer(state) {
      const cycleOutputs = state.artifacts
        .filter(a => a.kind === 'cycle_output')
        .sort((a, b) => a.created_at.localeCompare(b.created_at));

      const polls: MonitorReport['polls'] = [];
      const diffs: MonitorReport['diffs'] = [];
      let priorRunCycleIdx: number | null = null;

      cycleOutputs.forEach((art, idx) => {
        const proc = art.payload.processor as ProcessorOutput | undefined;
        const deriv = art.payload.derivation as DerivationOutput | undefined;
        if (!proc || proc.kind !== 'monitor_run') return;
        polls.push({ cycle: idx, query: proc.query, text: proc.text, polled_at: proc.polled_at });
        if (deriv && deriv.kind === 'monitor_diff' && priorRunCycleIdx !== null) {
          diffs.push({
            from_cycle: priorRunCycleIdx,
            to_cycle: idx,
            changed: deriv.changed,
            summary: deriv.summary,
          });
        }
        priorRunCycleIdx = idx;
      });

      return { kind: 'monitor_report', polls, diffs, total_polls: polls.length };
    },

    async stop_rule(state) {
      const completed = state.artifacts.filter(a => a.kind === 'cycle_output').length;
      if (completed >= target) {
        return { done: true, reason: `monitor_target_reached:${target}` };
      }
      return { done: false };
    },
  };
}

/** Find the text of the most recent monitor_run output across cycle_output
 *  artifacts. Returns null if no prior run-cycle has finalized yet. */
function findPriorRun(artifacts: Artifact[]): { text: string } | null {
  const sorted = artifacts
    .filter(a => a.kind === 'cycle_output')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const proc = sorted[i].payload.processor as ProcessorOutput | undefined;
    if (proc?.kind === 'monitor_run') return { text: proc.text };
  }
  return null;
}
