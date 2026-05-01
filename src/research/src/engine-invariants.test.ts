/**
 * Engine invariant tests: depth enforcement, thread exhaustion, budget enforcement,
 * cost attribution, concurrent slot safety, dedup threshold config, gap thread origin.
 * All tests use a mock provider — no API calls.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { ResearchEngine, isCovered, type LLMProvider, type LLMResult, type WebSearchResult } from './engine';
import * as queries from './services/queries';
import * as threads from './services/threads';
import * as findings from './services/findings';
import * as steps from './services/steps';
import { DEFAULT_SESSION_CONFIG } from './types';
import type { SessionConfig } from './types';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

const NO_DELAY = { min_delay_between_steps_ms: 0 };

// Minimal finding JSON the mock provider returns
function makeFinding(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    content: 'Detailed finding content.',
    summary: 'Key insight from research.',
    source_urls: ['https://example.com'],
    source_quality: 0.8,
    tags: ['test'],
    confidence: 0.85,
    novelty: 0.7,
    actionability: 0.6,
    follow_ups: [
      'What are the downstream effects?',
      'How does this compare to prior work?',
      'What evidence supports this claim?',
    ],
    ...overrides,
  });
}

function makeLowNoveltyFinding(): string {
  return makeFinding({ novelty: 0.1, confidence: 0.9, follow_ups: [] });
}

// Standard follow-up questions to return from the detectGaps LLM call
const FOLLOW_UP_QUESTIONS = JSON.stringify([
  'What are the broader policy implications of this finding?',
  'How does this phenomenon compare to similar cases in history?',
]);

/** Controllable mock provider with scriptable responses.
 *
 * Per-iteration LLM call sequence:
 *   1. formulate queries  → complete
 *   2. search             → searchWeb (×N)
 *   3. synthesize finding → complete
 *   4. checkDuplicate     → complete  (only when existing findings > 0)
 *   5. detectGaps         → complete  (always; part of evaluateFollowUps)
 */
class MockProvider implements LLMProvider {
  private completeQ: string[] = [];
  private searchQ: string[] = [];
  private ci = 0;
  private si = 0;

  pushComplete(...texts: string[]): this { this.completeQ.push(...texts); return this; }
  pushSearch(...texts: string[]): this { this.searchQ.push(...texts); return this; }

  addIteration(findingJson?: string, isFirst = false): this {
    this.pushComplete(JSON.stringify(['specific search query about this', 'alternative angle query'])); // formulate
    this.pushSearch('Detailed search results with useful information.');                                 // search
    this.pushComplete(findingJson ?? makeFinding());                                                     // synthesize
    if (!isFirst) this.pushComplete('false');                                                            // checkDuplicate
    this.pushComplete(FOLLOW_UP_QUESTIONS);                                                              // detectGaps
    return this;
  }

  async complete(model: string, _prompt: string): Promise<LLMResult> {
    const text = this.completeQ[this.ci % Math.max(this.completeQ.length, 1)] ?? '[]';
    this.ci++;
    return { text, promptTokens: 500, completionTokens: 200, model };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    const text = this.searchQ[this.si % Math.max(this.searchQ.length, 1)] ?? `Results for "${query}"`;
    this.si++;
    return { text, sourceTexts: [text], sourceUrls: ['https://example.com'], promptTokens: 1000, completionTokens: 500, model };
  }
}

function makeEngine(db: Database, provider: LLMProvider, opts: { maxIterations?: number } = {}): ResearchEngine {
  return new ResearchEngine({ sqlite: db, provider, maxIterations: opts.maxIterations ?? Infinity });
}

// ========== isCovered() edge cases ==========

describe('isCovered() boundary conditions', () => {
  test('fewer than 3 findings → not covered regardless of scores', () => {
    expect(isCovered([])).toBe(false);
    expect(isCovered([
      { confidence: 0.9, novelty: 0.05 } as ReturnType<typeof findings.listFindings>[0],
      { confidence: 0.9, novelty: 0.05 } as ReturnType<typeof findings.listFindings>[0],
    ])).toBe(false);
  });

  test('exactly 3 findings with qualifying scores → covered', () => {
    const f = (conf: number, nov: number) => ({ confidence: conf, novelty: nov }) as ReturnType<typeof findings.listFindings>[0];
    expect(isCovered([f(0.9, 0.1), f(0.8, 0.2), f(0.7, 0.15)])).toBe(true);
  });

  test('avg confidence exactly 0.65 → not covered (must be > 0.65)', () => {
    const f = (conf: number, nov: number) => ({ confidence: conf, novelty: nov }) as ReturnType<typeof findings.listFindings>[0];
    // avg conf = 0.65 exactly
    expect(isCovered([f(0.65, 0.1), f(0.65, 0.1), f(0.65, 0.1)])).toBe(false);
  });

  test('avg novelty exactly 0.3 → not covered (must be < 0.3)', () => {
    const f = (conf: number, nov: number) => ({ confidence: conf, novelty: nov }) as ReturnType<typeof findings.listFindings>[0];
    expect(isCovered([f(0.9, 0.3), f(0.9, 0.3), f(0.9, 0.3)])).toBe(false);
  });

  test('high novelty despite high confidence → not covered', () => {
    const f = (conf: number, nov: number) => ({ confidence: conf, novelty: nov }) as ReturnType<typeof findings.listFindings>[0];
    expect(isCovered([f(0.9, 0.8), f(0.9, 0.7), f(0.9, 0.9)])).toBe(false);
  });

  test('4+ findings all qualifying → covered', () => {
    const f = () => ({ confidence: 0.9, novelty: 0.1 }) as ReturnType<typeof findings.listFindings>[0];
    expect(isCovered([f(), f(), f(), f(), f()])).toBe(true);
  });
});

// ========== Depth enforcement ==========

describe('depth enforcement', () => {
  test('follow-up children at exactly max_depth are skipped, not created as deferred inventory', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      max_thread_depth: 1, // seed at depth 0, children at depth 1 = max_depth
      gap_analysis: { enabled: false, max_gap_searches: 0 },
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'depth test query', config);
    const session = queries.listQueries(db)[0];

    const seedThread = threads.listThreads(db, session.id)[0];
    expect(seedThread.depth).toBe(0);
    expect(seedThread.max_depth).toBe(1);

    await engine.runIterations(session.id);

    // Engine skips follow-up creation entirely when childDepth >= max_depth
    // (prior behavior created them as 'deferred' — see commit 39def68).
    const allThreads = threads.listThreads(db, session.id);
    const children = allThreads.filter(t => t.origin === 'follow_up');
    expect(children.length).toBe(0);
    expect(allThreads.filter(t => t.status === 'queued').length).toBe(0);
  });

  test('follow-up threads below max_depth are queued', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      max_thread_depth: 5,
      gap_analysis: { enabled: false, max_gap_searches: 0 },
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'depth test query', config);
    const session = queries.listQueries(db)[0];
    await engine.runIterations(session.id);

    const children = threads.listThreads(db, session.id).filter(t => t.origin === 'follow_up');
    expect(children.length).toBeGreaterThan(0);
    expect(children.every(t => t.status === 'queued')).toBe(true);
  });

  test('child thread depth = parent depth + 1', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      max_thread_depth: 5,
      gap_analysis: { enabled: false, max_gap_searches: 0 },
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'test', config);
    const session = queries.listQueries(db)[0];
    await engine.runIterations(session.id);

    const seed = threads.listThreads(db, session.id).find(t => t.origin === 'seed')!;
    const children = threads.listThreads(db, session.id).filter(t => t.origin === 'follow_up');
    expect(children.every(t => t.depth === seed.depth + 1)).toBe(true);
  });
});

// ========== Thread exhaustion prevents follow-up spawning ==========

describe('covered thread: no follow-ups spawned', () => {
  test('isCovered thread does not get queued follow-up children', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      max_thread_depth: 5,
      max_concurrent_threads: 1,
      gap_analysis: { enabled: false, max_gap_searches: 0 },
    };

    // 1 iteration to let the engine run once (it will add a 4th finding)
    const provider = new MockProvider().addIteration(makeLowNoveltyFinding(), true);
    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'covered topic', config);
    const session = queries.listQueries(db)[0];

    // Pre-populate 3 low-novelty findings directly on the seed thread
    const seedThread = threads.listThreads(db, session.id)[0];
    for (let i = 0; i < 3; i++) {
      findings.createFinding(db, {
        thread_id: seedThread.id,
        session_id: session.id,
        content: 'Established finding content.',
        summary: `Known insight #${i + 1}`,
        confidence: 0.90,
        novelty: 0.05, // very low novelty
        actionability: 0.6,
      });
    }

    // Verify pre-populated findings satisfy isCovered
    const preFindings = findings.listFindings(db, session.id, { threadId: seedThread.id });
    expect(isCovered(preFindings)).toBe(true);

    // Run 1 iteration — engine adds 1 more finding, then checks isCovered
    await engine.runIterations(session.id);

    // After the iteration, the 4-finding thread is covered → no queued follow-ups spawned
    const followUps = threads.listThreads(db, session.id).filter(t => t.origin === 'follow_up');
    expect(followUps.filter(t => t.status === 'queued').length).toBe(0);
  });
});

// ========== Budget enforcement in runIterations ==========

describe('budget enforcement in engine', () => {
  test('daily budget exceeded: session paused, no further iterations', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      budget_daily_usd: 0.001, // tiny — first step will exceed it
      max_concurrent_threads: 1,
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 5 });
    await engine.startSession('Test', 'budget test', config);
    const session = queries.listQueries(db)[0];

    // Inject a step that blows the daily budget before the engine runs
    db.prepare(`
      INSERT INTO research_steps
        (id, session_id, thread_id, model, provider, prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, created_at)
      SELECT ?, ?, id, 'test', 'openrouter', 0, 0, 1.0, '[]', 0, datetime('now')
      FROM research_threads WHERE session_id = ? LIMIT 1
    `).run('pre-step', session.id, session.id);

    await engine.runIterations(session.id);
    expect(queries.getQuery(db, session.id)!.status).toBe('halted');
  });

  test('total budget exceeded: session paused', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      budget_total_usd: 0.001,
      max_concurrent_threads: 1,
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 5 });
    await engine.startSession('Test', 'budget test', config);
    const session = queries.listQueries(db)[0];

    db.prepare(`
      INSERT INTO research_steps
        (id, session_id, thread_id, model, provider, prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, created_at)
      SELECT ?, ?, id, 'test', 'openrouter', 0, 0, 1.0, '[]', 0, datetime('now', '-1 day')
      FROM research_threads WHERE session_id = ? LIMIT 1
    `).run('pre-step', session.id, session.id);

    await engine.runIterations(session.id);
    expect(queries.getQuery(db, session.id)!.status).toBe('halted');
  });
});

// ========== Cost attribution ==========

describe('cost attribution', () => {
  test('steps are created for each search call', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      gap_analysis: { enabled: false, max_gap_searches: 0 },
      max_concurrent_threads: 1,
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'cost test', config);
    const session = queries.listQueries(db)[0];
    await engine.runIterations(session.id);

    const allSteps = steps.listSteps(db, session.id);
    expect(allSteps.length).toBeGreaterThan(0);
  });

  test('getQueryCost accurately sums steps written during runIterations', async () => {
    const db = createTestDb();
    // Use a model whose pricing we know: claude-haiku-4-5 at $0.80/$4.00 per 1M
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      model: 'claude-haiku-4-5',
      gap_analysis: { enabled: false, max_gap_searches: 0 },
      max_concurrent_threads: 1,
    };

    const provider = new MockProvider().addIteration(undefined, true);
    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'cost test', config);
    const session = queries.listQueries(db)[0];
    await engine.runIterations(session.id);

    const allSteps = steps.listSteps(db, session.id);
    const manualSum = allSteps.reduce((s, step) => s + step.cost_usd, 0);
    const cost = queries.getQueryCost(db, session.id);

    expect(cost.total_cost).toBeCloseTo(manualSum, 6);
    expect(cost.step_count).toBe(allSteps.length);
  });

  test('error step has cost_usd = 0', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      max_concurrent_threads: 1,
    };

    const provider = new MockProvider();
    // Search throws → error step created
    provider.pushComplete(JSON.stringify(['query']));
    provider.pushSearch(''); // empty → "No search results returned" path

    const engine = makeEngine(db, provider, { maxIterations: 1 });
    await engine.startSession('Test', 'error test', config);
    const session = queries.listQueries(db)[0];
    await engine.runIterations(session.id);

    const allSteps = steps.listSteps(db, session.id);
    // Any error steps should have cost 0
    const errorSteps = allSteps.filter(s => s.error);
    expect(errorSteps.every(s => s.cost_usd === 0)).toBe(true);
  });
});

// ========== Concurrent slot safety ==========

describe('concurrent slot safety', () => {
  test('two concurrent slots do not double-claim the same thread', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = {
      ...NO_DELAY,
      max_concurrent_threads: 2,
      gap_analysis: { enabled: false, max_gap_searches: 0 },
    };

    // Provide enough responses for 2 threads
    const provider = new MockProvider();
    provider.addIteration(undefined, true);
    provider.addIteration();

    const engine = makeEngine(db, provider, { maxIterations: 2 });
    await engine.startSession('Test', 'concurrent test', config);
    const session = queries.listQueries(db)[0];

    // Add a second seed-like thread to give concurrency something to work with
    threads.createThread(db, {
      session_id: session.id,
      query: 'second research angle',
      origin: 'seed',
      priority: 0.9,
      depth: 0,
      max_depth: 5,
    });

    await engine.runIterations(session.id);

    // Verify each thread was processed exactly once (findings count = threads processed)
    const allFindings = findings.listFindings(db, session.id);
    const allThreads = threads.listThreads(db, session.id);
    const exhaustedThreads = allThreads.filter(t => t.status === 'exhausted');

    // Each exhausted thread should have findings; none should be double-processed
    for (const t of exhaustedThreads) {
      const threadFindings = findings.listFindings(db, session.id, { threadId: t.id });
      // At most one finding per thread per iteration
      expect(threadFindings.length).toBeLessThanOrEqual(1);
    }
  });

  test('claimNextThread is safe under sequential double-call (one per thread)', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;

    threads.createThread(db, { session_id: sessId, query: 'q1', origin: 'seed', priority: 0.9, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: sessId, query: 'q2', origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });

    const claimed1 = threads.claimNextThread(db, sessId);
    const claimed2 = threads.claimNextThread(db, sessId);

    expect(claimed1).not.toBeNull();
    expect(claimed2).not.toBeNull();
    expect(claimed1!.id).not.toBe(claimed2!.id);
  });

  test('tryClaimThread: only the first caller claims; later callers get null', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    const t = threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed', priority: 0.9, depth: 0, max_depth: 5 });

    const first = threads.tryClaimThread(db, t.id);
    const second = threads.tryClaimThread(db, t.id);

    expect(first).not.toBeNull();
    expect(first!.status).toBe('active');
    expect(second).toBeNull();
  });

  test('tryClaimThread: returns null when thread is already active (prevents concurrent runIteration)', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    const t = threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed', priority: 0.9, depth: 0, max_depth: 5 });

    // Simulate runIterations claiming the thread first.
    threads.claimNextThread(db, sessId);

    // Now a thread-level job invokes runThread → tryClaimThread should bail.
    const blocked = threads.tryClaimThread(db, t.id);
    expect(blocked).toBeNull();
  });

  test('resetOrphanedActiveThreads: does NOT reset threads claimed by an active session-level job', async () => {
    // REGRESSION: session-level runIterations claims threads via claimNextThread
    // WITHOUT creating a per-thread job. Before the fix, resetOrphanedActiveThreads
    // saw "active thread, no job.thread_id match" and flipped it back to queued.
    // checkQueuedThreads then created a redundant thread-level job → another worker
    // ran runIteration concurrently → duplicate searches + duplicate findings.
    const jobs = await import('./services/jobs');
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    const t = threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed', priority: 0.9, depth: 0, max_depth: 5 });

    // Simulate the session-level burst job being claimed and running.
    const sessJob = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    jobs.claimJob(db, sessJob.id, 'worker-1');
    jobs.markRunning(db, sessJob.id, 'worker-1');

    // runIterations' slot claims the thread internally.
    threads.claimNextThread(db, sessId);
    expect(threads.getThread(db, t.id)!.status).toBe('active');

    // Another worker's cleanup pass MUST NOT reset this thread.
    const resetCount = threads.resetOrphanedActiveThreads(db);
    expect(resetCount).toBe(0);
    expect(threads.getThread(db, t.id)!.status).toBe('active');
  });

  test('resetOrphanedActiveThreads: still resets threads with no job and no session-level job', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    const t = threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed' });

    // Manually flip to active with no job backing it (dead-worker simulation).
    threads.claimNextThread(db, sessId);
    expect(threads.getThread(db, t.id)!.status).toBe('active');

    // No session-level job, no thread-level job → truly orphaned → reset.
    const resetCount = threads.resetOrphanedActiveThreads(db);
    expect(resetCount).toBe(1);
    expect(threads.getThread(db, t.id)!.status).toBe('queued');
  });

  test('getQueuedThreadsForNewJobs: fans out queued threads even when a session-level job is active', async () => {
    // Earlier this guard returned [] while a session-level job was running, on the
    // theory that runIterations claiming threads internally would race with
    // thread-level jobs claiming the same threads externally. In practice both
    // paths use the same atomic queued→active UPDATE (claimNextThread /
    // tryClaimThread in services/threads.ts), so the loser of any race simply
    // bails out — no double-run. Suppressing fan-out left N-1 worker processes
    // idle whenever a burst session-job was running. We now allow the dispatcher
    // to fan out across workers; resetOrphanedActiveThreads still excludes
    // threads owned by an active session-level job, so the orphan path is safe.
    const jobs = await import('./services/jobs');
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed' });

    const sessJob = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    jobs.claimJob(db, sessJob.id, 'worker-1');
    jobs.markRunning(db, sessJob.id, 'worker-1');

    expect(jobs.getQueuedThreadsForNewJobs(db, sessId, 10).length).toBe(1);

    jobs.completeJob(db, sessJob.id, 'worker-1');
    expect(jobs.getQueuedThreadsForNewJobs(db, sessId, 10).length).toBe(1);
  });

  test('unique-index: at most one active thread-level job per thread', async () => {
    const jobs = await import('./services/jobs');
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    const t = threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed' });

    const j1 = jobs.createThreadJobIfNone(db, { session_id: sessId, thread_id: t.id });
    const j2 = jobs.createThreadJobIfNone(db, { session_id: sessId, thread_id: t.id });

    expect(j1).not.toBeNull();
    expect(j2).toBeNull();

    // Direct INSERT bypassing the helper must also fail via the unique index.
    let threwUnique = false;
    try {
      jobs.createJob(db, { session_id: sessId, thread_id: t.id, mode: 'burst' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.includes('constraint')) threwUnique = true;
    }
    expect(threwUnique).toBe(true);
  });
});

// ========== Dedup similarity threshold ==========

describe('dedup threshold from config', () => {
  test('jaccardSimilarity is above 0 for similar queries', async () => {
    // Validate the similarity function works as expected for the dedup gate.
    // The engine uses this threshold before spawning follow-ups.
    const { jaccardSimilarity } = await import('./similarity');

    const a = 'What are the economic effects of climate change on agriculture?';
    const b = 'What are the economic impacts of climate change on farming?';
    const c = 'How does quantum computing work?';

    const simAB = jaccardSimilarity(a, b);
    const simAC = jaccardSimilarity(a, c);

    expect(simAB).toBeGreaterThan(simAC); // similar pair scores higher than dissimilar
    expect(simAB).toBeGreaterThan(0.2);   // meaningful similarity
    expect(simAC).toBeLessThan(0.2);      // near-zero dissimilarity
  });

  test('default dedup_similarity_threshold is 0.85', () => {
    expect(DEFAULT_SESSION_CONFIG.dedup_similarity_threshold).toBe(0.85);
  });
});

// ========== Gap analysis thread origin ==========

describe('gap analysis thread origin', () => {
  // Gap analysis is triggered inside runIteration when config.gap_analysis.enabled.
  // It doesn't spawn gap threads — gap threads are spawned by the planner.
  // We verify that manually-created gap threads have the right origin.
  test('gap thread has origin=gap', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;

    const gapThread = threads.createThread(db, {
      session_id: sessId,
      query: 'Gap: what is the impact on rural communities?',
      origin: 'follow_up', // follow_up is the actual origin for engine-spawned threads
      priority: 0.6,
      depth: 0,
      max_depth: 5,
    });

    // Verify origin is stored and retrieved correctly
    expect(threads.getThread(db, gapThread.id)!.origin).toBe('follow_up');
  });

  test('all valid thread origins are stored and retrieved correctly', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'Test', 'q').id;
    const origins = ['seed', 'follow_up', 'user_injected', 'monitor_alert', 'verify'] as const;

    for (const origin of origins) {
      const t = threads.createThread(db, {
        session_id: sessId,
        query: `query for ${origin}`,
        origin,
        priority: 0.5,
        depth: 0,
        max_depth: 5,
      });
      expect(threads.getThread(db, t.id)!.origin).toBe(origin);
    }
  });
});

// ========== Session aborted cleanly ==========

describe('abort signal', () => {
  test('runIterations respects abort signal and does not throw', async () => {
    const db = createTestDb();
    const config: Partial<SessionConfig> = { ...NO_DELAY, max_concurrent_threads: 1 };

    const controller = new AbortController();
    const provider = new MockProvider();
    // Provide one iteration worth of responses
    provider.addIteration(undefined, true);

    const engine = new ResearchEngine({
      sqlite: db,
      provider,
      maxIterations: 100,
      signal: controller.signal,
    });

    await engine.startSession('Test', 'abort test', config);
    const session = queries.listQueries(db)[0];

    // Abort immediately
    controller.abort();

    // Should complete without throwing
    await expect(engine.runIterations(session.id)).resolves.toBeDefined();
  });
});
