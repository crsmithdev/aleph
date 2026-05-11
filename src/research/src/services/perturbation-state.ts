import type { Sqlite } from '@construct/data';
import type {
  PerturbationStrategy,
  PerturbationConfig,
} from '../types.js';
import {
  type PerturbationState,
  ALL_STRATEGIES,
  createPerturbationState,
} from '../perturbation.js';
import * as findings from './findings.js';

export interface PerturbationStrategyStat {
  strategy: PerturbationStrategy;
  attempts: number;
  successes: number;
  avg_novelty: number;
  avg_confidence: number;
  /** Multiplier currently being applied to this strategy's selection weight
   *  (0.7–1.3). Identical formula to selectStrategy in perturbation.ts so the
   *  Telemetry tab and the engine agree on what's "fruitful." */
  fruitfulness: number;
}

/** Load per-session strategy counters and reconstruct in-memory state used by
 *  selectStrategy. recentStrategies is derived from the most recent
 *  perturbation threads so cooldown survives engine restarts; lastDomains
 *  stays empty until B3 wires the cluster trigger. iterationCount mirrors
 *  total findings (drives early/late phase bias in selectStrategy). */
export function loadPerturbationState(
  sqlite: Sqlite,
  sessionId: string,
  config: PerturbationConfig
): PerturbationState {
  const state = createPerturbationState();

  const rows = sqlite.prepare(
    'SELECT strategy, attempts, successes FROM research_perturbation_state WHERE session_id = ?'
  ).all(sessionId) as Array<{ strategy: string; attempts: number; successes: number }>;

  for (const row of rows) {
    state.strategyUseCounts[row.strategy] = row.attempts;
    state.strategySuccessCounts[row.strategy] = row.successes;
  }

  const cooldown = Math.max(1, config.strategy_cooldown);
  const recent = sqlite.prepare(
    `SELECT perturbation_strategy FROM research_threads
     WHERE session_id = ? AND origin = 'perturbation' AND perturbation_strategy IS NOT NULL
     ORDER BY created_at DESC LIMIT ?`
  ).all(sessionId, cooldown) as Array<{ perturbation_strategy: string }>;
  state.recentStrategies = recent
    .map(r => r.perturbation_strategy as PerturbationStrategy)
    .reverse();

  state.iterationCount = findings.countFindings(sqlite, sessionId);

  return state;
}

/** Records that a strategy was attempted (selected by selectStrategy and a
 *  perturbation thread was successfully spawned). Must be paired with a later
 *  recordOutcome call when the resulting finding emerges. */
export function recordAttempt(
  sqlite: Sqlite,
  sessionId: string,
  strategy: PerturbationStrategy
): void {
  sqlite.prepare(`
    INSERT INTO research_perturbation_state (session_id, strategy, attempts, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(session_id, strategy) DO UPDATE SET
      attempts = attempts + 1,
      updated_at = datetime('now')
  `).run(sessionId, strategy);
}

/** Records the outcome of a perturbation: a finding with this novelty and
 *  confidence emerged from a thread spawned with this strategy. successes is
 *  always incremented (any finding counts as a success); the running sums let
 *  fruitfulness weighting amplify high-quality strategies more than ones that
 *  produce shallow findings. */
export function recordOutcome(
  sqlite: Sqlite,
  sessionId: string,
  strategy: PerturbationStrategy,
  novelty: number,
  confidence: number
): void {
  sqlite.prepare(`
    INSERT INTO research_perturbation_state
      (session_id, strategy, attempts, successes, novelty_sum, confidence_sum, updated_at)
    VALUES (?, ?, 0, 1, ?, ?, datetime('now'))
    ON CONFLICT(session_id, strategy) DO UPDATE SET
      successes = successes + 1,
      novelty_sum = novelty_sum + ?,
      confidence_sum = confidence_sum + ?,
      updated_at = datetime('now')
  `).run(sessionId, strategy, novelty, confidence, novelty, confidence);
}

/** Aggregated per-strategy outcomes for the Telemetry tab. Returns one row
 *  per strategy that has been attempted in this session. */
export function getStrategyStats(sqlite: Sqlite, sessionId: string): PerturbationStrategyStat[] {
  const rows = sqlite.prepare(
    `SELECT strategy, attempts, successes, novelty_sum, confidence_sum
     FROM research_perturbation_state WHERE session_id = ? ORDER BY attempts DESC`
  ).all(sessionId) as Array<{
    strategy: string;
    attempts: number;
    successes: number;
    novelty_sum: number;
    confidence_sum: number;
  }>;

  return rows.map(r => {
    const successRate = r.attempts > 0 ? r.successes / r.attempts : 0;
    return {
      strategy: r.strategy as PerturbationStrategy,
      attempts: r.attempts,
      successes: r.successes,
      avg_novelty: r.successes > 0 ? r.novelty_sum / r.successes : 0,
      avg_confidence: r.successes > 0 ? r.confidence_sum / r.successes : 0,
      fruitfulness: r.attempts > 0 ? 0.7 + 0.6 * successRate : 1.0,
    };
  });
}

/** Re-export so engine code only imports from this service. */
export { ALL_STRATEGIES };
