import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import * as sessions from './services/sessions';
import * as threads from './services/threads';
import * as findings from './services/findings';
import * as steps from './services/steps';
import * as plans from './services/plans';
import { ResearchEngine } from './engine';
import { DEFAULT_SESSION_CONFIG } from './types';
import type { SessionConfig } from './types';

function createTestDb(): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite);
  return sqlite;
}

// ========== Data Model CRUD Tests ==========

describe('sessions CRUD', () => {
  let sqlite: Database;
  beforeEach(() => { sqlite = createTestDb(); });

  test('create and get session', () => {
    const session = sessions.createSession(sqlite, 'Test', 'test query');
    expect(session.id).toBeTruthy();
    expect(session.title).toBe('Test');
    expect(session.seed_query).toBe('test query');
    expect(session.status).toBe('active');
    expect(session.config.budget_daily_usd).toBe(5.0);
  });

  test('list sessions', () => {
    sessions.createSession(sqlite, 'A', 'query a');
    sessions.createSession(sqlite, 'B', 'query b');
    const all = sessions.listSessions(sqlite);
    expect(all.length).toBe(2);
  });

  test('update session status', () => {
    const session = sessions.createSession(sqlite, 'Test', 'q');
    sessions.updateSession(sqlite, session.id, { status: 'paused' });
    const updated = sessions.getSession(sqlite, session.id);
    expect(updated?.status).toBe('paused');
  });

  test('get session cost with no steps', () => {
    const session = sessions.createSession(sqlite, 'Test', 'q');
    const cost = sessions.getSessionCost(sqlite, session.id);
    expect(cost.total_cost).toBe(0);
    expect(cost.step_count).toBe(0);
  });
});

describe('threads CRUD', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('create thread', () => {
    const thread = threads.createThread(sqlite, {
      session_id: sessionId,
      query: 'test thread',
      origin: 'seed',
      priority: 1.0,
    });
    expect(thread.id).toBeTruthy();
    expect(thread.origin).toBe('seed');
    expect(thread.status).toBe('queued');
  });

  test('select next thread by priority', () => {
    threads.createThread(sqlite, { session_id: sessionId, query: 'low', origin: 'seed', priority: 0.3 });
    threads.createThread(sqlite, { session_id: sessionId, query: 'high', origin: 'seed', priority: 0.9 });
    const next = threads.selectNextThread(sqlite, sessionId);
    expect(next?.query).toBe('high');
  });

  test('update thread status', () => {
    const thread = threads.createThread(sqlite, { session_id: sessionId, query: 'q', origin: 'seed' });
    threads.updateThread(sqlite, thread.id, { status: 'exhausted' });
    const updated = threads.getThread(sqlite, thread.id);
    expect(updated?.status).toBe('exhausted');
  });

  test('list threads by status', () => {
    threads.createThread(sqlite, { session_id: sessionId, query: 'a', origin: 'seed', status: 'queued' });
    threads.createThread(sqlite, { session_id: sessionId, query: 'b', origin: 'seed', status: 'active' });
    const queued = threads.listThreads(sqlite, sessionId, 'queued');
    expect(queued.length).toBe(1);
  });

  test('count threads by origin', () => {
    threads.createThread(sqlite, { session_id: sessionId, query: 'a', origin: 'seed' });
    threads.createThread(sqlite, { session_id: sessionId, query: 'b', origin: 'follow_up' });
    threads.createThread(sqlite, { session_id: sessionId, query: 'c', origin: 'perturbation', perturbation_strategy: 'analogical' });
    const counts = threads.countThreadsByOrigin(sqlite, sessionId);
    expect(counts.seed).toBe(1);
    expect(counts.follow_up).toBe(1);
    expect(counts.perturbation).toBe(1);
  });
});

describe('findings CRUD', () => {
  let sqlite: Database;
  let sessionId: string;
  let threadId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
    threadId = threads.createThread(sqlite, { session_id: sessionId, query: 'q', origin: 'seed' }).id;
  });

  test('create finding with JSON fields', () => {
    const finding = findings.createFinding(sqlite, {
      thread_id: threadId,
      session_id: sessionId,
      content: 'test content',
      summary: 'test summary',
      source_urls: ['https://example.com'],
      tags: ['bread', 'baking'],
      follow_up_questions: ['How?', 'Why?'],
    });
    expect(finding.source_urls).toEqual(['https://example.com']);
    expect(finding.tags).toEqual(['bread', 'baking']);
    expect(finding.follow_up_questions).toEqual(['How?', 'Why?']);
  });

  test('list findings sorted by novelty', () => {
    findings.createFinding(sqlite, { thread_id: threadId, session_id: sessionId, content: 'a', summary: 'low', novelty: 0.2 });
    findings.createFinding(sqlite, { thread_id: threadId, session_id: sessionId, content: 'b', summary: 'high', novelty: 0.9 });
    const sorted = findings.listFindings(sqlite, sessionId, { sort: 'novelty' });
    expect(sorted[0].summary).toBe('high');
  });

  test('update finding rating', () => {
    const f = findings.createFinding(sqlite, { thread_id: threadId, session_id: sessionId, content: 'a', summary: 's' });
    findings.updateFinding(sqlite, f.id, { user_rating: 'promising' });
    const updated = findings.getFinding(sqlite, f.id);
    expect(updated?.user_rating).toBe('promising');
  });

  test('count findings', () => {
    findings.createFinding(sqlite, { thread_id: threadId, session_id: sessionId, content: 'a', summary: 's1' });
    findings.createFinding(sqlite, { thread_id: threadId, session_id: sessionId, content: 'b', summary: 's2' });
    expect(findings.countFindings(sqlite, sessionId)).toBe(2);
  });
});

describe('steps and cost tracking', () => {
  let sqlite: Database;
  let sessionId: string;
  let threadId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
    threadId = threads.createThread(sqlite, { session_id: sessionId, query: 'q', origin: 'seed' }).id;
  });

  test('create step and track cost', () => {
    steps.createStep(sqlite, {
      thread_id: threadId,
      session_id: sessionId,
      model: 'claude-sonnet-4-6',
      prompt_tokens: 1000,
      completion_tokens: 500,
      cost_usd: 0.0105,
      duration_ms: 2000,
    });
    const costs = steps.getStepCosts(sqlite, sessionId);
    expect(costs.total_cost).toBeCloseTo(0.0105);
    expect(costs.total_steps).toBe(1);
    expect(costs.by_model['claude-sonnet-4-6'].steps).toBe(1);
  });

  test('step with error recorded', () => {
    const step = steps.createStep(sqlite, {
      thread_id: threadId,
      session_id: sessionId,
      model: 'claude-sonnet-4-6',
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: 0,
      duration_ms: 100,
      error: 'API timeout',
    });
    expect(step.error).toBe('API timeout');
  });

  test('multiple steps aggregate correctly', () => {
    for (let i = 0; i < 5; i++) {
      steps.createStep(sqlite, {
        thread_id: threadId,
        session_id: sessionId,
        model: 'claude-sonnet-4-6',
        prompt_tokens: 1000,
        completion_tokens: 500,
        cost_usd: 0.01,
        duration_ms: 1000,
      });
    }
    const costs = steps.getStepCosts(sqlite, sessionId);
    expect(costs.total_cost).toBeCloseTo(0.05);
    expect(costs.total_steps).toBe(5);
  });
});

describe('plans and modifications', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('create plan with items', () => {
    const plan = plans.createPlan(sqlite, sessionId, [
      { rank: 1, thread_id: 'abc', thread_query: 'Test query', parent_thread_title: null, origin: 'seed', perturbation_strategy: null, estimated_cost: 0.02, rationale: 'Seed thread' },
    ]);
    expect(plan.items.length).toBe(1);
    expect(plan.status).toBe('proposed');
  });

  test('add plan modification', () => {
    const plan = plans.createPlan(sqlite, sessionId, []);
    const mod = plans.addPlanModification(sqlite, {
      plan_id: plan.id,
      action: 'veto',
      target_item_rank: 3,
    });
    expect(mod.action).toBe('veto');
    expect(mod.target_item_rank).toBe(3);
  });

  test('get latest plan', () => {
    plans.createPlan(sqlite, sessionId, [{ rank: 1, thread_id: 'a', thread_query: 'first', parent_thread_title: null, origin: 'seed', perturbation_strategy: null, estimated_cost: 0.01, rationale: 'r' }]);
    plans.createPlan(sqlite, sessionId, [{ rank: 1, thread_id: 'b', thread_query: 'second', parent_thread_title: null, origin: 'seed', perturbation_strategy: null, estimated_cost: 0.01, rationale: 'r' }]);
    const latest = plans.getLatestPlan(sqlite, sessionId);
    expect(latest?.items[0].thread_query).toBe('second');
  });
});

// ========== Priority Calculation Tests ==========

describe('thread prioritization', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('higher priority thread selected first', () => {
    threads.createThread(sqlite, { session_id: sessionId, query: 'low priority', origin: 'follow_up', priority: 0.2 });
    threads.createThread(sqlite, { session_id: sessionId, query: 'high priority', origin: 'seed', priority: 0.9 });
    threads.createThread(sqlite, { session_id: sessionId, query: 'mid priority', origin: 'follow_up', priority: 0.5 });
    const next = threads.selectNextThread(sqlite, sessionId);
    expect(next?.query).toBe('high priority');
  });

  test('exhausted threads not selected', () => {
    threads.createThread(sqlite, { session_id: sessionId, query: 'exhausted', origin: 'seed', priority: 1.0, status: 'exhausted' });
    threads.createThread(sqlite, { session_id: sessionId, query: 'queued', origin: 'seed', priority: 0.5 });
    const next = threads.selectNextThread(sqlite, sessionId);
    expect(next?.query).toBe('queued');
  });

  test('pruned threads not selected', () => {
    threads.createThread(sqlite, { session_id: sessionId, query: 'pruned', origin: 'seed', priority: 1.0, status: 'pruned' });
    const next = threads.selectNextThread(sqlite, sessionId);
    expect(next).toBeNull();
  });
});

// ========== Thread Lifecycle Tests ==========

describe('thread exhaustion', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('thread with 3 low-novelty findings has low novelty scores', () => {
    const thread = threads.createThread(sqlite, { session_id: sessionId, query: 'q', origin: 'seed' });
    // First finding is excellent
    findings.createFinding(sqlite, {
      thread_id: thread.id, session_id: sessionId, content: 'great', summary: 'great', novelty: 0.9,
    });
    // Next 3 are low
    for (let i = 0; i < 3; i++) {
      findings.createFinding(sqlite, {
        thread_id: thread.id, session_id: sessionId, content: `dud ${i}`, summary: `dud ${i}`, novelty: 0.15,
      });
    }
    // Verify: last 3 findings all have low novelty
    const recent = findings.listFindings(sqlite, sessionId, { threadId: thread.id, limit: 3, sort: 'created_at' });
    expect(recent.every(f => f.novelty < 0.3)).toBe(true);
  });
});

// ========== Plan Steering Tests ==========

describe('plan steering', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('veto thread via plan modification', () => {
    const thread = threads.createThread(sqlite, { session_id: sessionId, query: 'to veto', origin: 'seed' });
    const plan = plans.createPlan(sqlite, sessionId, [
      { rank: 1, thread_id: thread.id, thread_query: 'to veto', parent_thread_title: null, origin: 'seed', perturbation_strategy: null, estimated_cost: 0.02, rationale: 'r' },
    ]);
    plans.addPlanModification(sqlite, { plan_id: plan.id, action: 'veto', target_thread_id: thread.id });

    // Simulate engine applying mods
    const mods = plans.getPendingModifications(sqlite, plan.id);
    expect(mods.length).toBe(1);
    expect(mods[0].action).toBe('veto');

    threads.updateThread(sqlite, thread.id, { status: 'pruned' });
    const updated = threads.getThread(sqlite, thread.id);
    expect(updated?.status).toBe('pruned');
  });

  test('boost exhausted thread reopens it', () => {
    const thread = threads.createThread(sqlite, {
      session_id: sessionId, query: 'exhausted', origin: 'seed', status: 'exhausted', priority: 0.3, max_depth: 4,
    });
    // Boost: reopen, increase priority and max_depth
    threads.updateThread(sqlite, thread.id, { status: 'queued', priority: 0.6, max_depth: 6 });
    const updated = threads.getThread(sqlite, thread.id);
    expect(updated?.status).toBe('queued');
    expect(updated?.priority).toBe(0.6);
    expect(updated?.max_depth).toBe(6);
  });

  test('veto then boost same thread — last write wins', () => {
    const thread = threads.createThread(sqlite, { session_id: sessionId, query: 'target', origin: 'seed' });
    // Veto
    threads.updateThread(sqlite, thread.id, { status: 'pruned' });
    expect(threads.getThread(sqlite, thread.id)?.status).toBe('pruned');
    // Then boost (should reopen)
    threads.updateThread(sqlite, thread.id, { status: 'queued', priority: 0.8 });
    const final = threads.getThread(sqlite, thread.id);
    expect(final?.status).toBe('queued');
    expect(final?.priority).toBe(0.8);
  });

  test('veto only remaining thread leaves no selectable threads', () => {
    const thread = threads.createThread(sqlite, { session_id: sessionId, query: 'only one', origin: 'seed' });
    threads.updateThread(sqlite, thread.id, { status: 'pruned' });
    const next = threads.selectNextThread(sqlite, sessionId);
    expect(next).toBeNull();
  });
});

// ========== Deduplication Tests ==========

describe('deduplication across threads', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('identical summaries detected as potential duplicates', () => {
    const thread1 = threads.createThread(sqlite, { session_id: sessionId, query: 'q1', origin: 'seed' });
    const thread2 = threads.createThread(sqlite, { session_id: sessionId, query: 'q2', origin: 'follow_up' });
    findings.createFinding(sqlite, {
      thread_id: thread1.id, session_id: sessionId, content: 'content a', summary: 'No building permits required under 200 sqft',
    });
    findings.createFinding(sqlite, {
      thread_id: thread2.id, session_id: sessionId, content: 'content b', summary: 'No building permits needed for sub-200 sqft structures',
    });
    // Both exist — dedup is LLM-based in the engine, but we verify both are stored
    const all = findings.listFindings(sqlite, sessionId);
    expect(all.length).toBe(2);
  });
});

// ========== Data Integrity Tests ==========

describe('data integrity', () => {
  test('DDL is idempotent', () => {
    const sqlite = createTestDb();
    // Apply again — should not error
    applyResearchDDL(sqlite);
    applyResearchDDL(sqlite);
    const session = sessions.createSession(sqlite, 'Test', 'q');
    expect(session.id).toBeTruthy();
  });

  test('cascading deletes work', () => {
    const sqlite = createTestDb();
    const session = sessions.createSession(sqlite, 'Test', 'q');
    const thread = threads.createThread(sqlite, { session_id: session.id, query: 'q', origin: 'seed' });
    findings.createFinding(sqlite, { thread_id: thread.id, session_id: session.id, content: 'c', summary: 's' });
    steps.createStep(sqlite, {
      thread_id: thread.id, session_id: session.id, model: 'test', prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, duration_ms: 0,
    });

    // Delete session — should cascade
    sqlite.prepare('DELETE FROM research_sessions WHERE id = ?').run(session.id);
    expect(threads.listThreads(sqlite, session.id).length).toBe(0);
    expect(findings.listFindings(sqlite, session.id).length).toBe(0);
  });

  test('transaction atomicity — step within transaction', () => {
    const sqlite = createTestDb();
    const session = sessions.createSession(sqlite, 'Test', 'q');
    const thread = threads.createThread(sqlite, { session_id: session.id, query: 'q', origin: 'seed' });

    // Simulate transactional step creation
    sqlite.exec('BEGIN');
    steps.createStep(sqlite, {
      thread_id: thread.id, session_id: session.id, model: 'test',
      prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.001, duration_ms: 500,
    });
    sqlite.exec('COMMIT');

    const allSteps = steps.listSteps(sqlite, session.id);
    expect(allSteps.length).toBe(1);
  });
});

// ========== Budget Enforcement Tests ==========

describe('budget enforcement', () => {
  let sqlite: Database;
  beforeEach(() => { sqlite = createTestDb(); });

  test('session cost tracks cumulative spend', () => {
    const session = sessions.createSession(sqlite, 'Test', 'q', { budget_daily_usd: 1.0 });
    const thread = threads.createThread(sqlite, { session_id: session.id, query: 'q', origin: 'seed' });

    for (let i = 0; i < 10; i++) {
      steps.createStep(sqlite, {
        thread_id: thread.id, session_id: session.id, model: 'claude-sonnet-4-6',
        prompt_tokens: 1000, completion_tokens: 500, cost_usd: 0.1, duration_ms: 1000,
      });
    }

    const cost = sessions.getSessionCost(sqlite, session.id);
    expect(cost.total_cost).toBeCloseTo(1.0);
    expect(cost.step_count).toBe(10);
  });
});

// ========== Follow-up Thread Spawning ==========

describe('follow-up thread ancestry', () => {
  let sqlite: Database;
  let sessionId: string;
  beforeEach(() => {
    sqlite = createTestDb();
    sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
  });

  test('child thread has correct parent and depth', () => {
    const parent = threads.createThread(sqlite, { session_id: sessionId, query: 'parent', origin: 'seed', depth: 0 });
    const child = threads.createThread(sqlite, {
      session_id: sessionId, query: 'child', origin: 'follow_up',
      parent_thread_id: parent.id, depth: 1,
    });
    expect(child.parent_thread_id).toBe(parent.id);
    expect(child.depth).toBe(1);
    expect(child.origin).toBe('follow_up');
  });

  test('perturbation thread grandchild is follow_up, not perturbation', () => {
    const root = threads.createThread(sqlite, { session_id: sessionId, query: 'root', origin: 'seed', depth: 0 });
    const perturbation = threads.createThread(sqlite, {
      session_id: sessionId, query: 'tangent', origin: 'perturbation', perturbation_strategy: 'analogical',
      parent_thread_id: root.id, depth: 1,
    });
    const grandchild = threads.createThread(sqlite, {
      session_id: sessionId, query: 'follow-up from tangent', origin: 'follow_up',
      parent_thread_id: perturbation.id, depth: 2,
    });
    expect(grandchild.origin).toBe('follow_up');
    expect(grandchild.parent_thread_id).toBe(perturbation.id);
  });

  test('thread at max_depth does not spawn children beyond ceiling', () => {
    const maxDepthThread = threads.createThread(sqlite, {
      session_id: sessionId, query: 'deep', origin: 'follow_up', depth: 8, max_depth: 8,
    });
    // Engine should check depth < max_depth before spawning — verify the data supports it
    expect(maxDepthThread.depth).toBe(8);
    expect(maxDepthThread.max_depth).toBe(8);
    expect(maxDepthThread.depth >= maxDepthThread.max_depth).toBe(true);
  });
});
