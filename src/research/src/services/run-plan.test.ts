/**
 * Tests for suggestRunPlan — deterministic (QuestionShape × TopicCluster)
 * lookup powering the landing-page compose box. The function MUST be total:
 * every shape, every topic, both null inputs, and partial-null inputs all
 * return a valid RunPlan. No `undefined` / no thrown errors.
 */
import { describe, test, expect } from 'bun:test';
import { suggestRunPlan, QUESTION_SHAPES, TOPIC_CLUSTERS, type RunPlan } from './run-plan';
import type { QuestionShape } from '../types';
import { DEFAULT_SESSION_CONFIG } from '../types';

function isValidPlan(plan: RunPlan | undefined | null): plan is RunPlan {
  if (!plan) return false;
  return (
    typeof plan.model_fast === 'string' && plan.model_fast.length > 0 &&
    typeof plan.budget_total_usd === 'number' && plan.budget_total_usd > 0 &&
    typeof plan.max_thread_depth === 'number' && plan.max_thread_depth >= 1 &&
    typeof plan.role_label === 'string' && plan.role_label.length > 0
  );
}

describe('suggestRunPlan — exhaustiveness', () => {
  test('every (shape × topic) pair returns a valid RunPlan', () => {
    for (const shape of QUESTION_SHAPES) {
      for (const topic of TOPIC_CLUSTERS) {
        const plan = suggestRunPlan(shape, topic);
        expect(isValidPlan(plan)).toBe(true);
      }
    }
  });

  test('every shape with null topic returns a valid RunPlan', () => {
    for (const shape of QUESTION_SHAPES) {
      const plan = suggestRunPlan(shape, null);
      expect(isValidPlan(plan)).toBe(true);
      expect(plan.role_label).toBe('general_researcher');
    }
  });

  test('every topic with null shape returns a valid RunPlan', () => {
    for (const topic of TOPIC_CLUSTERS) {
      const plan = suggestRunPlan(null, topic);
      expect(isValidPlan(plan)).toBe(true);
    }
  });
});

describe('suggestRunPlan — null fallback to system defaults', () => {
  test('both null → returns system defaults', () => {
    const plan = suggestRunPlan(null, null);
    expect(plan.model_fast).toBe(
      DEFAULT_SESSION_CONFIG.model_fast ?? DEFAULT_SESSION_CONFIG.model
    );
    expect(plan.max_thread_depth).toBe(DEFAULT_SESSION_CONFIG.max_thread_depth);
    expect(plan.role_label).toBe('general_researcher');
  });
});

describe('suggestRunPlan — shape budgets escalate with depth', () => {
  test('lookup is the cheapest, shallowest', () => {
    const plan = suggestRunPlan('lookup', 'Misc');
    expect(plan.budget_total_usd).toBe(0.10);
    expect(plan.max_thread_depth).toBe(1);
    expect(plan.model_fast).toBe('claude-haiku-4-5');
  });

  test('audit is mid-tier', () => {
    const plan = suggestRunPlan('audit', 'Misc');
    expect(plan.budget_total_usd).toBe(0.50);
    expect(plan.max_thread_depth).toBe(3);
  });

  test('comparison and dynamics are 4–5 deep, ~$1', () => {
    expect(suggestRunPlan('comparison', 'Misc').budget_total_usd).toBe(1.00);
    expect(suggestRunPlan('comparison', 'Misc').max_thread_depth).toBe(4);
    expect(suggestRunPlan('dynamics', 'Misc').budget_total_usd).toBe(1.00);
    expect(suggestRunPlan('dynamics', 'Misc').max_thread_depth).toBe(5);
  });

  test('survey/timeline/list are deepest, ~$1.50', () => {
    for (const shape of ['survey', 'timeline', 'list'] as QuestionShape[]) {
      const plan = suggestRunPlan(shape, 'Misc');
      expect(plan.budget_total_usd).toBe(1.50);
      expect(plan.max_thread_depth).toBe(5);
    }
  });
});

describe('suggestRunPlan — role label by topic', () => {
  test('AI / LLM tooling → prompt_engineer (default)', () => {
    expect(suggestRunPlan('survey', 'AI / LLM tooling').role_label).toBe('prompt_engineer');
    expect(suggestRunPlan('list', 'AI / LLM tooling').role_label).toBe('prompt_engineer');
  });

  test('AI / LLM tooling + audit → systems_engineer', () => {
    expect(suggestRunPlan('audit', 'AI / LLM tooling').role_label).toBe('systems_engineer');
  });

  test('Music history → music_historian (all shapes)', () => {
    for (const shape of QUESTION_SHAPES) {
      expect(suggestRunPlan(shape, 'Music history').role_label).toBe('music_historian');
    }
  });

  test('Databases → database_engineer, comparison → data_architect', () => {
    expect(suggestRunPlan('survey', 'Databases').role_label).toBe('database_engineer');
    expect(suggestRunPlan('audit', 'Databases').role_label).toBe('database_engineer');
    expect(suggestRunPlan('comparison', 'Databases').role_label).toBe('data_architect');
  });

  test('Audio & DSP → audio_engineer', () => {
    expect(suggestRunPlan('survey', 'Audio & DSP').role_label).toBe('audio_engineer');
  });

  test('Personal infra → systems_engineer', () => {
    expect(suggestRunPlan('survey', 'Personal infra').role_label).toBe('systems_engineer');
  });

  test('Misc → general_researcher', () => {
    expect(suggestRunPlan('survey', 'Misc').role_label).toBe('general_researcher');
  });
});

describe('suggestRunPlan — determinism', () => {
  test('same input → same output (called twice)', () => {
    const a = suggestRunPlan('survey', 'Music history');
    const b = suggestRunPlan('survey', 'Music history');
    expect(a).toEqual(b);
  });

  test('returns a fresh object each call (caller can mutate safely)', () => {
    const a = suggestRunPlan('survey', 'Music history');
    const b = suggestRunPlan('survey', 'Music history');
    expect(a).not.toBe(b);
  });
});
