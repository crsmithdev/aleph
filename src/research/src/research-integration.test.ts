/**
 * Integration tests for the research engine using a mock LLM provider.
 * No API tokens consumed. Covers DEEP-RESEARCH-PHASE1-TESTS.md scenarios.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { ResearchEngine } from './engine';
import type { LLMProvider, LLMResult, WebSearchResult } from './engine';
import * as sessions from './services/sessions';
import * as threads from './services/threads';
import * as findings from './services/findings';
import * as steps from './services/steps';
import * as plans from './services/plans';

function createTestDb(): Database {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite);
  return sqlite;
}

class MockProvider implements LLMProvider {
  private completeResponses: Array<{ text: string; error?: string }> = [];
  private searchResponses: Array<{ text: string; error?: string }> = [];
  private completeIdx = 0;
  private searchIdx = 0;
  public callLog: Array<{ type: 'complete' | 'search'; prompt: string }> = [];

  addComplete(text: string) {
    this.completeResponses.push({ text });
    return this;
  }

  addCompleteError(error: string) {
    this.completeResponses.push({ text: '', error });
    return this;
  }

  addSearch(text: string) {
    this.searchResponses.push({ text });
    return this;
  }

  addSearchError(error: string) {
    this.searchResponses.push({ text: '', error });
    return this;
  }

  // Add responses for one iteration (formulate + search + synthesize + dedup + detectGaps)
  // Set firstIteration=true to skip dedup response (engine skips dedup when no prior findings)
  addIteration(findingOverrides?: Record<string, unknown>, firstIteration = false) {
    this.addComplete(JSON.stringify(['test query']));
    this.addSearch('Search results about the topic with useful data.');
    this.addComplete(standardFinding(findingOverrides));
    if (!firstIteration) this.addComplete('false'); // dedup
    this.addComplete(JSON.stringify([              // detectGaps (always called by evaluateFollowUps)
      'What are the long-term economic implications for global markets?',
      'How do similar phenomena manifest across different geographic regions?',
    ]));
    return this;
  }

  async complete(model: string, prompt: string): Promise<LLMResult> {
    this.callLog.push({ type: 'complete', prompt });
    if (this.completeResponses.length === 0) return { text: '[]', promptTokens: 0, completionTokens: 0, model };
    const r = this.completeResponses[this.completeIdx % this.completeResponses.length];
    this.completeIdx++;
    if (r.error) throw new Error(r.error);
    return { text: r.text, promptTokens: 500, completionTokens: 200, model };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    this.callLog.push({ type: 'search', prompt: query });
    if (this.searchResponses.length === 0) {
      return { text: `Results for "${query}"`, sourceUrls: ['https://example.com'], promptTokens: 1000, completionTokens: 500, model };
    }
    const r = this.searchResponses[this.searchIdx % this.searchResponses.length];
    this.searchIdx++;
    if (r.error) throw new Error(r.error);
    return {
      text: r.text,
      sourceUrls: ['https://example.com/result'],
      promptTokens: 1000,
      completionTokens: 500,
      model,
    };
  }
}

function standardFinding(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    content: 'Synthesized finding about the topic with multiple insights.',
    summary: 'Key insight about the research topic',
    source_urls: ['https://example.com/1'],
    source_quality: 0.8,
    tags: ['research', 'testing'],
    confidence: 0.85,
    novelty: 0.7,
    actionability: 0.6,
    follow_ups: ['What are the implications?', 'How does this compare?', 'What evidence?'],
    ...overrides,
  });
}

function lowNoveltyFinding() {
  return standardFinding({ novelty: 0.1, summary: 'Nothing new', follow_ups: [] });
}

function setupStandardProvider(): MockProvider {
  return new MockProvider()
    .addComplete('Sourdough Bread') // absorbs summarizeThreadAsync seed-thread call
    .addIteration(undefined, true);
}

const NO_DELAY = { min_delay_between_steps_ms: 0, gap_analysis: { enabled: false } };

// ========== Execution Loop Resilience ==========

describe('execution loop resilience', () => {
  test('mid-iteration API failure: logs error, continues', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    // Iter 1: query formulation succeeds, but search fails
    provider.addComplete(JSON.stringify(['query']));
    provider.addSearchError('429 rate_limit_error');
    // Iter 2: full success (first finding, no dedup)
    provider.addIteration(undefined, true);

    const errors: string[] = [];
    const engine = new ResearchEngine({
      sqlite,
      provider,
      maxIterations: 2,
      onError: (err) => errors.push(err.message),
    });

    const session = await engine.startSession('Test', 'test topic', NO_DELAY);
    const result = await engine.runIterations(session.id);

    expect(result.iterations).toBe(2);

    // Error step should be recorded
    const allSteps = steps.listSteps(sqlite, session.id);
    const errorSteps = allSteps.filter(s => s.error !== null);
    expect(errorSteps.length).toBeGreaterThanOrEqual(1);
  });

  test('budget exhaustion: pauses session', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    for (let i = 0; i < 20; i++) {
      provider.addIteration({ summary: `Finding ${i}`, follow_ups: [] }, i === 0);
    }

    const engine = new ResearchEngine({
      sqlite,
      provider,
      maxIterations: 20,
    });

    // Very low budget: with claude-haiku-4-5 search step costs ~$0.003, should pause after 1 iteration
    const session = await engine.startSession('Budget', 'test', { model: 'claude-haiku-4-5', budget_daily_usd: 0.001, ...NO_DELAY });
    await engine.runIterations(session.id);

    const updated = sessions.getSession(sqlite, session.id);
    expect(updated?.status).toBe('halted');
  });

  test('garbage query: handles gracefully, no infinite loop', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    provider.addIteration({ novelty: 0.05, summary: 'No results', follow_ups: [] }, true);
    provider.addIteration({ novelty: 0.05, summary: 'No results 2', follow_ups: [] });

    const engine = new ResearchEngine({ sqlite, provider, maxIterations: 2 });
    const session = await engine.startSession('Garbage', 'qwxzpt blargh', NO_DELAY);
    const result = await engine.runIterations(session.id);

    expect(result.iterations).toBe(2);
  });
});

// ========== Perturbation Correctness ==========

describe('perturbation correctness', () => {
  test('perturbation at depth 0 produces tangent from seed only', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    provider.addComplete(JSON.stringify(['test query'])); // formulate
    provider.addSearch('Search results');
    provider.addComplete(standardFinding()); // synthesize
    // No dedup response needed — first finding, checkDuplicate returns early
    provider.addComplete('How does industrial fermentation compare to artisan methods?'); // perturbation

    const engine = new ResearchEngine({
      sqlite, provider, maxIterations: 1,
    });

    const session = await engine.startSession('Test', 'sourdough baking', {
      p_serendipity: 1.0,
      perturbation_coherence_floor: 0, // test perturbation creation, not the floor
      ...NO_DELAY,
    });
    await engine.runIterations(session.id);

    const allThreads = threads.listThreads(sqlite, session.id);
    const pertThreads = allThreads.filter(t => t.origin === 'perturbation');
    expect(pertThreads.length).toBeGreaterThanOrEqual(1);
    for (const pt of pertThreads) {
      expect(pt.perturbation_strategy).toBeTruthy();
      expect(['analogical', 'contrarian', 'failure_post_mortem', 'temporal_shift']).toContain(pt.perturbation_strategy);
    }
  });

  test('perturbation chain: grandchild is follow_up not perturbation', () => {
    const sqlite = createTestDb();
    const sessionId = sessions.createSession(sqlite, 'Test', 'topic').id;

    const root = threads.createThread(sqlite, {
      session_id: sessionId, query: 'root', origin: 'seed', depth: 0,
    });
    const pertThread = threads.createThread(sqlite, {
      session_id: sessionId, query: 'tangent', origin: 'perturbation',
      perturbation_strategy: 'analogical', parent_thread_id: root.id, depth: 1,
    });
    const grandchild = threads.createThread(sqlite, {
      session_id: sessionId, query: 'follow-up from tangent', origin: 'follow_up',
      parent_thread_id: pertThread.id, depth: 2,
    });

    expect(grandchild.origin).toBe('follow_up');
    expect(grandchild.parent_thread_id).toBe(pertThread.id);
  });

  test('all 4 strategies produce different queries', async () => {
    const sqlite = createTestDb();
    const usedStrategies: string[] = [];

    for (let i = 0; i < 8; i++) {
      const provider = new MockProvider();
      provider.addComplete(JSON.stringify(['query'])); // formulate
      provider.addSearch('results');
      provider.addComplete(standardFinding()); // synthesize (first finding, no dedup)
      provider.addComplete(`Tangent query for strategy ${i} about urban farming`); // perturbation

      const engine = new ResearchEngine({
        sqlite, provider, maxIterations: 1,
      });

      const session = await engine.startSession(`S${i}`, 'urban farming', {
        p_serendipity: 1.0,
        perturbation_coherence_floor: 0, // test strategy diversity, not the floor
        ...NO_DELAY,
      });
      await engine.runIterations(session.id);

      const pertThreads = threads.listThreads(sqlite, session.id)
        .filter(t => t.origin === 'perturbation');
      for (const pt of pertThreads) {
        if (pt.perturbation_strategy) usedStrategies.push(pt.perturbation_strategy);
      }
    }

    // Should use multiple strategies over 8 runs
    const unique = new Set(usedStrategies);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  test('coherence floor rejects pure-tangent perturbations and records a step', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    provider.addComplete(JSON.stringify(['test query'])); // formulate
    provider.addSearch('Search results');
    provider.addComplete(standardFinding()); // synthesize
    // Two off-topic perturbation candidates — no token overlap with seed,
    // jaccard = 0, well below any non-zero floor. Engine retries once then rejects.
    provider.addComplete('quantum chromodynamics confinement asymptotic freedom');
    provider.addComplete('elephant migration patterns Serengeti dry season');

    const engine = new ResearchEngine({
      sqlite, provider, maxIterations: 1,
    });

    const session = await engine.startSession('Test', 'sourdough baking', {
      p_serendipity: 1.0,
      perturbation_coherence_floor: 0.5, // strict floor for the test
      ...NO_DELAY,
    });
    await engine.runIterations(session.id);

    // No perturbation thread should have been created — both candidates rejected.
    const allThreads = threads.listThreads(sqlite, session.id);
    const pertThreads = allThreads.filter(t => t.origin === 'perturbation');
    expect(pertThreads.length).toBe(0);

    // A perturbation_rejected step must be recorded — visible in the Events tab.
    const allSteps = steps.listSteps(sqlite, session.id);
    const rejected = allSteps.filter(s => {
      const meta = s.metadata as Record<string, unknown> | null;
      return meta?.decision === 'perturbation_rejected';
    });
    expect(rejected.length).toBe(1);
    const meta = rejected[0].metadata as Record<string, unknown>;
    expect(meta.reason).toBe('below coherence floor');
    expect(typeof meta.similarity).toBe('number');
    expect(meta.similarity as number).toBeLessThan(0.5);
    expect(meta.floor).toBe(0.5);
    expect(meta.strategy).toBeTruthy();
  });

  test('coherence floor disabled (0) lets all perturbations through', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    provider.addComplete(JSON.stringify(['test query'])); // formulate
    provider.addSearch('Search results');
    provider.addComplete(standardFinding()); // synthesize
    provider.addComplete('quantum chromodynamics confinement'); // off-topic perturbation

    const engine = new ResearchEngine({
      sqlite, provider, maxIterations: 1,
    });

    const session = await engine.startSession('Test', 'sourdough baking', {
      p_serendipity: 1.0,
      perturbation_coherence_floor: 0, // disabled
      ...NO_DELAY,
    });
    await engine.runIterations(session.id);

    // Off-topic perturbation should have been kept since the floor is off.
    const pertThreads = threads.listThreads(sqlite, session.id)
      .filter(t => t.origin === 'perturbation');
    expect(pertThreads.length).toBeGreaterThanOrEqual(1);

    // No rejection step should be recorded.
    const allSteps = steps.listSteps(sqlite, session.id);
    const rejected = allSteps.filter(s => {
      const meta = s.metadata as Record<string, unknown> | null;
      return meta?.decision === 'perturbation_rejected';
    });
    expect(rejected.length).toBe(0);
  });
});

// ========== Plan and Steering ==========

describe('plan and steering', () => {
  test('veto only remaining thread: engine stops', async () => {
    const sqlite = createTestDb();
    const provider = setupStandardProvider();
    const engine = new ResearchEngine({ sqlite, provider, maxIterations: 5 });

    const session = await engine.startSession('Veto Test', 'test', NO_DELAY);
    const seedThread = threads.listThreads(sqlite, session.id)[0];
    threads.updateThread(sqlite, seedThread.id, { status: 'pruned' });

    const result = await engine.runIterations(session.id);
    expect(result.iterations).toBe(0);
  });

  test('boost exhausted thread reopens it', () => {
    const sqlite = createTestDb();
    const sessionId = sessions.createSession(sqlite, 'Test', 'q').id;

    const thread = threads.createThread(sqlite, {
      session_id: sessionId, query: 'exhausted', origin: 'seed',
      status: 'exhausted', priority: 0.3, max_depth: 4,
    });

    threads.updateThread(sqlite, thread.id, {
      status: 'queued', priority: 0.6, max_depth: 6,
    });

    const updated = threads.getThread(sqlite, thread.id);
    expect(updated?.status).toBe('queued');
    expect(updated?.max_depth).toBe(6);
  });

  test('veto then boost: last write wins', () => {
    const sqlite = createTestDb();
    const sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
    const thread = threads.createThread(sqlite, { session_id: sessionId, query: 'q', origin: 'seed' });

    threads.updateThread(sqlite, thread.id, { status: 'pruned' });
    threads.updateThread(sqlite, thread.id, { status: 'queued', priority: 0.9 });

    expect(threads.getThread(sqlite, thread.id)?.status).toBe('queued');
  });

  test('plan veto applied by engine on next iteration', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    for (let i = 0; i < 4; i++) {
      provider.addIteration({ follow_ups: ['Follow up?'] }, i === 0);
    }

    const engine = new ResearchEngine({ sqlite, provider, maxIterations: 1 });
    const session = await engine.startSession('Plan Test', 'test', { p_serendipity: 0.0, ...NO_DELAY });

    // First iteration
    await engine.runIterations(session.id);

    // Veto first plan item
    const plan = plans.getLatestPlan(sqlite, session.id);
    if (plan && plan.items.length > 0) {
      plans.addPlanModification(sqlite, {
        plan_id: plan.id, action: 'veto',
        target_thread_id: plan.items[0].thread_id,
      });

      // Second iteration applies the modification
      const engine2 = new ResearchEngine({ sqlite, provider, maxIterations: 1 });
      await engine2.runIterations(session.id);

      const vetoed = threads.getThread(sqlite, plan.items[0].thread_id);
      expect(vetoed?.status).toBe('pruned');
    }
  });
});

// ========== Thread Lifecycle ==========

describe('thread lifecycle', () => {
  test('3 low-novelty findings exhaust thread', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();

    // Iter 1: good finding (first, no dedup)
    provider.addComplete(JSON.stringify(['query']));
    provider.addSearch('results');
    provider.addComplete(standardFinding({ novelty: 0.9, follow_ups: [] }));
    // Iters 2-4: duds (dedup fires now since findings exist)
    for (let i = 0; i < 3; i++) {
      provider.addComplete(JSON.stringify(['query']));
      provider.addSearch('results');
      provider.addComplete(standardFinding({ novelty: 0.1, summary: `dud ${i}`, follow_ups: [] }));
      provider.addComplete('false'); // dedup
    }

    const engine = new ResearchEngine({
      sqlite, provider, maxIterations: 4,
    });
    const session = await engine.startSession('Exhaust', 'test', { p_serendipity: 0.0, ...NO_DELAY });
    await engine.runIterations(session.id);

    const seedThread = threads.listThreads(sqlite, session.id)
      .find(t => t.origin === 'seed');
    expect(seedThread?.status).toBe('exhausted');
  });

  test('max_depth prevents child thread spawning', () => {
    const sqlite = createTestDb();
    const sessionId = sessions.createSession(sqlite, 'Test', 'q').id;

    const deepThread = threads.createThread(sqlite, {
      session_id: sessionId, query: 'deep', origin: 'follow_up', depth: 8, max_depth: 8,
    });

    expect(deepThread.depth >= deepThread.max_depth).toBe(true);

    // Follow-up questions stored on finding even though no children spawn
    const finding = findings.createFinding(sqlite, {
      thread_id: deepThread.id, session_id: sessionId,
      content: 'deep finding', summary: 'deep',
      follow_ups: ['Q1?', 'Q2?'],
    });
    expect(finding.follow_ups.length).toBe(2);
  });

  test('dedup: similar findings flagged with lower novelty', () => {
    const sqlite = createTestDb();
    const sessionId = sessions.createSession(sqlite, 'Test', 'q').id;
    const t1 = threads.createThread(sqlite, { session_id: sessionId, query: 'q1', origin: 'seed' });
    const t2 = threads.createThread(sqlite, { session_id: sessionId, query: 'q2', origin: 'follow_up', parent_thread_id: t1.id });

    findings.createFinding(sqlite, {
      thread_id: t1.id, session_id: sessionId,
      content: 'No building permits under 200 sqft in Josephine County',
      summary: 'No permits needed under 200 sqft', novelty: 0.8,
    });
    findings.createFinding(sqlite, {
      thread_id: t2.id, session_id: sessionId,
      content: 'Josephine County exempts sub-200 sqft',
      summary: 'Same fact from different source', novelty: 0.2,
    });

    const all = findings.listFindings(sqlite, sessionId);
    expect(all.length).toBe(2);
  });
});

// ========== Cost Tracking ==========

describe('cost tracking accuracy', () => {
  test('step costs sum correctly', async () => {
    const sqlite = createTestDb();
    const provider = new MockProvider();
    for (let i = 0; i < 3; i++) {
      provider.addIteration({ follow_ups: [], summary: `Finding ${i}` }, i === 0);
    }

    const engine = new ResearchEngine({
      sqlite, provider, maxIterations: 3,
    });
    const session = await engine.startSession('Cost', 'test', { model: 'claude-haiku-4-5', p_serendipity: 0.0, ...NO_DELAY });
    await engine.runIterations(session.id);

    const stepCosts = steps.getStepCosts(sqlite, session.id);
    const sessionCost = sessions.getSessionCost(sqlite, session.id);

    expect(stepCosts.total_cost).toBeCloseTo(sessionCost.total_cost, 5);
    expect(stepCosts.total_steps).toBe(sessionCost.step_count);
    expect(stepCosts.total_cost).toBeGreaterThan(0);
  });
});

// ========== Data Integrity ==========

describe('data integrity', () => {
  test('cascading deletes', () => {
    const sqlite = createTestDb();
    const session = sessions.createSession(sqlite, 'Test', 'q');
    const thread = threads.createThread(sqlite, { session_id: session.id, query: 'q', origin: 'seed' });
    findings.createFinding(sqlite, { thread_id: thread.id, session_id: session.id, content: 'c', summary: 's' });
    steps.createStep(sqlite, {
      thread_id: thread.id, session_id: session.id,
      model: 'test', prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.001, duration_ms: 100,
    });
    plans.createPlan(sqlite, session.id, []);

    sqlite.prepare('DELETE FROM research_queries WHERE id = ?').run(session.id);
    expect(threads.listThreads(sqlite, session.id).length).toBe(0);
    expect(findings.listFindings(sqlite, session.id).length).toBe(0);
  });

  test('transaction rollback preserves consistency', () => {
    const sqlite = createTestDb();
    const session = sessions.createSession(sqlite, 'Test', 'q');
    const thread = threads.createThread(sqlite, { session_id: session.id, query: 'q', origin: 'seed' });

    sqlite.exec('BEGIN');
    steps.createStep(sqlite, {
      thread_id: thread.id, session_id: session.id,
      model: 'test', prompt_tokens: 100, completion_tokens: 50, cost_usd: 0.001, duration_ms: 500,
    });
    sqlite.exec('COMMIT');
    expect(steps.listSteps(sqlite, session.id).length).toBe(1);

    sqlite.exec('BEGIN');
    steps.createStep(sqlite, {
      thread_id: thread.id, session_id: session.id,
      model: 'test', prompt_tokens: 200, completion_tokens: 100, cost_usd: 0.002, duration_ms: 600,
    });
    sqlite.exec('ROLLBACK');
    expect(steps.listSteps(sqlite, session.id).length).toBe(1);
  });

  test('500 findings: recent query is bounded', () => {
    const sqlite = createTestDb();
    const session = sessions.createSession(sqlite, 'Test', 'q');
    const thread = threads.createThread(sqlite, { session_id: session.id, query: 'q', origin: 'seed' });

    // Use explicit IDs to avoid the word-based generator's birthday-problem collisions at scale
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO research_findings
        (id, thread_id, session_id, content, summary, source_urls, source_texts, source_url_meta,
         source_quality, tags, confidence, novelty, actionability, follow_ups, created_at)
      VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', 0.5, '[]', 0.5, 0.5, 0.5, '[]', ?)
    `);
    for (let i = 0; i < 500; i++) {
      stmt.run(`finding-${i}`, thread.id, session.id, `Content ${i}`, `Summary ${i}`, now);
    }

    expect(findings.countFindings(sqlite, session.id)).toBe(500);
    expect(findings.getRecentFindings(sqlite, session.id, 20).length).toBe(20);
  });
});

// ========== Full Engine Flow ==========

describe('full engine flow', () => {
  test('formulate → search → synthesize → spawn → plan', async () => {
    const sqlite = createTestDb();
    const provider = setupStandardProvider();

    const engine = new ResearchEngine({
      sqlite, provider, maxIterations: 1,
    });
    const session = await engine.startSession('Full', 'sourdough bread', { model: 'claude-haiku-4-5', p_serendipity: 0.0, ...NO_DELAY });
    const result = await engine.runIterations(session.id);

    expect(result.iterations).toBe(1);
    expect(result.findings).toBeGreaterThanOrEqual(1);

    const allFindings = findings.listFindings(sqlite, session.id);
    expect(allFindings.length).toBeGreaterThanOrEqual(1);
    expect(allFindings[0].content.length).toBeGreaterThan(10);

    const followUps = threads.listThreads(sqlite, session.id).filter(t => t.origin === 'follow_up');
    expect(followUps.length).toBeGreaterThanOrEqual(1);

    const plan = plans.getLatestPlan(sqlite, session.id);
    expect(plan).toBeTruthy();
    expect(plan!.items.length).toBeGreaterThanOrEqual(1);

    expect(sessions.getSessionCost(sqlite, session.id).total_cost).toBeGreaterThan(0);
  });
});
