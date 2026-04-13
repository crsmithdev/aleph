/**
 * Tests for thread priority: calculateChildPriority formula, claimNextThread ordering,
 * and findPendingJob session ordering. No LLM calls needed.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import * as queries from './services/queries';
import * as threads from './services/threads';
import * as jobs from './services/jobs';
import { ResearchEngine, type LLMProvider, type LLMResult, type WebSearchResult } from './engine';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

const noopProvider: LLMProvider = {
  async complete(model, _prompt): Promise<LLMResult> {
    return { text: '', promptTokens: 0, completionTokens: 0, model };
  },
  async searchWeb(model, query): Promise<WebSearchResult> {
    return { text: '', sourceUrls: [], promptTokens: 0, completionTokens: 0, model };
  },
};

// ========== calculateChildPriority ==========

describe('calculateChildPriority', () => {
  test('returns value in [0, 1] range for typical inputs', () => {
    const db = createTestDb();
    const engine = new ResearchEngine({ sqlite: db, provider: noopProvider });
    const calc = (engine as any).calculateChildPriority.bind(engine);

    const parentThread = { priority: 0.7, depth: 1, max_depth: 5 } as any;
    const finding = { confidence: 0.8, novelty: 0.7, actionability: 0.6 } as any;

    const result = calc(parentThread, finding);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  test('higher finding quality → higher child priority', () => {
    const db = createTestDb();
    const engine = new ResearchEngine({ sqlite: db, provider: noopProvider });
    const calc = (engine as any).calculateChildPriority.bind(engine);

    const parent = { priority: 0.5, depth: 0, max_depth: 5 } as any;

    const highQuality = calc(parent, { confidence: 1.0, novelty: 1.0, actionability: 1.0 } as any);
    const lowQuality  = calc(parent, { confidence: 0.0, novelty: 0.0, actionability: 0.0 } as any);

    // highQuality should substantially exceed lowQuality (ignoring the ±0.05 random component)
    expect(highQuality).toBeGreaterThan(lowQuality);
  });

  test('deeper parent thread reduces child priority', () => {
    const db = createTestDb();
    const engine = new ResearchEngine({ sqlite: db, provider: noopProvider });
    const calc = (engine as any).calculateChildPriority.bind(engine);

    const finding = { confidence: 0.8, novelty: 0.8, actionability: 0.8 } as any;
    const shallowParent = { priority: 0.5, depth: 0, max_depth: 5 } as any;
    const deepParent    = { priority: 0.5, depth: 4, max_depth: 5 } as any;

    // Run 20 times to average out the random component
    const avgShallow = Array.from({ length: 20 }, () => calc(shallowParent, finding)).reduce((a, b) => a + b) / 20;
    const avgDeep    = Array.from({ length: 20 }, () => calc(deepParent, finding)).reduce((a, b) => a + b) / 20;

    expect(avgShallow).toBeGreaterThan(avgDeep);
  });

  test('random component stays within ±0.05', () => {
    const db = createTestDb();
    const engine = new ResearchEngine({ sqlite: db, provider: noopProvider });
    const calc = (engine as any).calculateChildPriority.bind(engine);

    const parent  = { priority: 0.5, depth: 0, max_depth: 5 } as any;
    const finding = { confidence: 0.5, novelty: 0.5, actionability: 0.5 } as any;

    // deterministic component (random=0):
    // 0.25*(0.5+0.5)/2 + 0.20*0.5 + 0.15*0.5 - 0.10*(0/5) = 0.125 + 0.10 + 0.075 = 0.30
    const samples = Array.from({ length: 100 }, () => calc(parent, finding));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(0.30);
    expect(max).toBeLessThanOrEqual(0.35);
  });

  test('formula: deterministic part matches expected value at depth=0', () => {
    const db = createTestDb();
    const engine = new ResearchEngine({ sqlite: db, provider: noopProvider });
    const calc = (engine as any).calculateChildPriority.bind(engine);

    // Override Math.random to always return 0 so we get a deterministic result
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      const parent  = { priority: 0.8, depth: 0, max_depth: 4 } as any;
      const finding = { confidence: 1.0, novelty: 0.6, actionability: 0.5 } as any;
      // 0.25*(1.0+0.6)/2 + 0.20*0.5 + 0.15*0.8 - 0.10*(0/4) + 0.05*0
      // = 0.25*0.8 + 0.10 + 0.12 - 0
      // = 0.20 + 0.10 + 0.12 = 0.42
      expect(calc(parent, finding)).toBeCloseTo(0.42, 5);
    } finally {
      Math.random = origRandom;
    }
  });
});

// ========== claimNextThread priority ordering ==========

describe('claimNextThread ordering', () => {
  let db: Database;
  let sessId: string;

  beforeEach(() => {
    db = createTestDb();
    sessId = queries.createQuery(db, 'Test', 'q').id;
  });

  test('returns highest-priority queued thread first', () => {
    threads.createThread(db, { session_id: sessId, query: 'low',  origin: 'seed', priority: 0.2, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: sessId, query: 'high', origin: 'seed', priority: 0.9, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: sessId, query: 'mid',  origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });

    const t = threads.claimNextThread(db, sessId)!;
    expect(t.query).toBe('high');
    expect(t.status).toBe('active');
  });

  test('tiebreaks by creation order (earlier first)', () => {
    // Use explicit timestamps with guaranteed ordering to avoid same-millisecond ambiguity
    db.prepare(`INSERT INTO research_threads
      (id, session_id, query, origin, status, priority, depth, max_depth, node_type, created_at, updated_at)
      VALUES ('t-first',  ?, 'first',  'seed', 'queued', 0.7, 0, 5, 'question', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')
    `).run(sessId);
    db.prepare(`INSERT INTO research_threads
      (id, session_id, query, origin, status, priority, depth, max_depth, node_type, created_at, updated_at)
      VALUES ('t-second', ?, 'second', 'seed', 'queued', 0.7, 0, 5, 'question', '2024-01-01T00:00:01.000Z', '2024-01-01T00:00:01.000Z')
    `).run(sessId);

    const t = threads.claimNextThread(db, sessId)!;
    expect(t.query).toBe('first');
  });

  test('claimed thread no longer available to next claim', () => {
    threads.createThread(db, { session_id: sessId, query: 'only', origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });

    const first  = threads.claimNextThread(db, sessId);
    const second = threads.claimNextThread(db, sessId);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test('returns null when no queued threads remain', () => {
    expect(threads.claimNextThread(db, sessId)).toBeNull();
  });

  test('returns null when all threads are already active/exhausted', () => {
    threads.createThread(db, { session_id: sessId, query: 'q', origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });
    threads.claimNextThread(db, sessId); // claim it → active
    expect(threads.claimNextThread(db, sessId)).toBeNull();
  });

  test('processes threads in full priority order across sequential claims', () => {
    const priorities = [0.3, 0.9, 0.1, 0.7, 0.5];
    for (const p of priorities) {
      threads.createThread(db, { session_id: sessId, query: `p${p}`, origin: 'seed', priority: p, depth: 0, max_depth: 5 });
    }

    const claimed: number[] = [];
    let t: ReturnType<typeof threads.claimNextThread>;
    while ((t = threads.claimNextThread(db, sessId)) !== null) {
      claimed.push(t.priority);
    }

    expect(claimed).toEqual([0.9, 0.7, 0.5, 0.3, 0.1]);
  });
});

// ========== findPendingJob session ordering ==========

describe('findPendingJob ordering', () => {
  test('prefers session with higher-priority queued thread', () => {
    const db = createTestDb();

    const s1 = queries.createQuery(db, 'S1', 'low').id;
    const s2 = queries.createQuery(db, 'S2', 'high').id;

    threads.createThread(db, { session_id: s1, query: 'q', origin: 'seed', priority: 0.2, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: s2, query: 'q', origin: 'seed', priority: 0.8, depth: 0, max_depth: 5 });

    jobs.createJob(db, { session_id: s1, mode: 'burst' });
    jobs.createJob(db, { session_id: s2, mode: 'burst' });

    const pending = jobs.findPendingJob(db)!;
    expect(pending.session_id).toBe(s2);
  });

  test('returns null when no pending jobs exist', () => {
    const db = createTestDb();
    expect(jobs.findPendingJob(db)).toBeNull();
  });

  test('ignores claimed/running/completed jobs', () => {
    const db = createTestDb();
    const sessId = queries.createQuery(db, 'S', 'q').id;
    const job = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    expect(jobs.findPendingJob(db)).toBeNull();
  });
});
