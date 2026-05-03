import type { QuestionShape, TopicCluster } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';

/** Subset of `SessionConfig` the suggester proposes as defaults. The compose
 *  box on the research landing page applies these as the defaults the user
 *  sees before they hit submit; if they accept, the values get merged into
 *  the query's `SessionConfig` at create time. */
export interface RunPlan {
  model_fast: string;
  budget_total_usd: number;
  max_thread_depth: number;
  role_label: string;
}

const SHAPE_DEFAULTS: Record<QuestionShape, Omit<RunPlan, 'role_label'>> = {
  lookup:     { model_fast: 'claude-haiku-4-5', budget_total_usd: 0.10, max_thread_depth: 1 },
  audit:      { model_fast: 'claude-sonnet-4-6', budget_total_usd: 0.50, max_thread_depth: 3 },
  comparison: { model_fast: 'claude-sonnet-4-6', budget_total_usd: 1.00, max_thread_depth: 4 },
  dynamics:   { model_fast: 'claude-sonnet-4-6', budget_total_usd: 1.00, max_thread_depth: 5 },
  survey:     { model_fast: 'claude-sonnet-4-6', budget_total_usd: 1.50, max_thread_depth: 5 },
  timeline:   { model_fast: 'claude-sonnet-4-6', budget_total_usd: 1.50, max_thread_depth: 5 },
  list:       { model_fast: 'claude-sonnet-4-6', budget_total_usd: 1.50, max_thread_depth: 5 },
};

/** Role label is keyed primarily by topic, with shape as a secondary
 *  refinement (e.g. an `audit` of AI/LLM tooling reads as a systems-engineer
 *  task, not a prompt-engineer task). Returns the topic's default label
 *  when no shape-specific override applies. */
function roleLabelFor(shape: QuestionShape | null, topic: TopicCluster): string {
  switch (topic) {
    case 'AI / LLM tooling':
      return shape === 'audit' ? 'systems_engineer' : 'prompt_engineer';
    case 'Music history':
      return 'music_historian';
    case 'Databases':
      return shape === 'comparison' ? 'data_architect' : 'database_engineer';
    case 'Audio & DSP':
      return 'audio_engineer';
    case 'Personal infra':
      return 'systems_engineer';
    case 'Misc':
      return 'general_researcher';
  }
}

function fallbackPlan(): RunPlan {
  return {
    model_fast: DEFAULT_SESSION_CONFIG.model_fast ?? DEFAULT_SESSION_CONFIG.model,
    budget_total_usd: DEFAULT_SESSION_CONFIG.budget_total_usd ?? 1.00,
    max_thread_depth: DEFAULT_SESSION_CONFIG.max_thread_depth,
    role_label: 'general_researcher',
  };
}

/** Deterministic `(shape × topic) → RunPlan` lookup. Used by the create-query
 *  response so the compose box can render sensible defaults under the
 *  textarea without a second LLM call. Total: every input — including
 *  `null` shape or `null` topic — returns a valid `RunPlan`. */
export function suggestRunPlan(
  shape: QuestionShape | null,
  topic: TopicCluster | null,
): RunPlan {
  // Both null → fall back to the system defaults.
  if (shape === null && topic === null) return fallbackPlan();

  // Only topic known → use system defaults for budget/depth/model, but
  // pick the topic-appropriate role.
  if (shape === null && topic !== null) {
    const base = fallbackPlan();
    return { ...base, role_label: roleLabelFor(null, topic) };
  }

  // Only shape known → use the shape's caps with the misc/general role.
  if (shape !== null && topic === null) {
    const caps = SHAPE_DEFAULTS[shape];
    return { ...caps, role_label: 'general_researcher' };
  }

  // Both known.
  const caps = SHAPE_DEFAULTS[shape as QuestionShape];
  return { ...caps, role_label: roleLabelFor(shape, topic as TopicCluster) };
}

/** Exhaustive list of topics — used by tests and any UI that wants to
 *  preview the lookup. Keeping it next to the type means adding a topic
 *  surfaces a TypeScript error here if the union is widened without
 *  updating the constant. */
export const TOPIC_CLUSTERS: readonly TopicCluster[] = [
  'AI / LLM tooling',
  'Music history',
  'Databases',
  'Audio & DSP',
  'Personal infra',
  'Misc',
] as const;

export const QUESTION_SHAPES: readonly QuestionShape[] = [
  'survey', 'timeline', 'list', 'dynamics', 'comparison', 'lookup', 'audit',
] as const;
