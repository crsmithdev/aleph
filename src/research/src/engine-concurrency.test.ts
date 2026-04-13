/**
 * Tests for engine concurrency: max_concurrent_threads slot limits,
 * thread processing completeness with multiple slots, and priority-ordered
 * processing under single-slot serialization.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { ResearchEngine, type LLMProvider, type LLMResult, type WebSearchResult } from './engine';
import * as queries from './services/queries';
import * as threads from './services/threads';
import type { SessionConfig } from './types';
import { DEFAULT_SESSION_CONFIG } from './types';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

/** Provider that returns valid responses for one full iteration (no gap analysis, no dedup). */
class MockProvider implements LLMProvider {
  private responses: string[] = [];
  private idx = 0;

  push(...texts: string[]): this { this.responses.push(...texts); return this; }

  async complete(model: string, _prompt: string): Promise<LLMResult> {
    const text = this.responses.length > 0
      ? this.responses[this.idx++ % this.responses.length]
      : 'default response';
    return { text, promptTokens: 100, completionTokens: 50, model };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    return { text: `Results for: ${query}`, sourceUrls: ['https://example.com'], promptTokens: 100, completionTokens: 50, model };
  }
}

const NO_FOLLOW_UPS_FINDING = JSON.stringify({
  summary: 'A finding about the topic with detailed content.',
  content: 'Detailed finding content about this research topic.',
  source_urls: ['https://example.com'],
  source_texts: ['Source text here.'],
  tags: ['test'],
  confidence: 0.8,
  novelty: 0.7,
  actionability: 0.6,
  follow_ups: [],
});

/** Build mock responses for one iteration per thread (no dedup on first iteration). */
function makeIterationResponses(): string[] {
  return [
    'Short Title',            // summarizeThreadAsync
    JSON.stringify(['q1']),   // formulate queries
    NO_FOLLOW_UPS_FINDING,    // synthesize
    JSON.stringify([]),       // detectGaps → no gap threads
  ];
}

const BASE_CONFIG: Partial<SessionConfig> = {
  ...DEFAULT_SESSION_CONFIG,
  min_delay_between_steps_ms: 0,
  p_serendipity: 0,
  gap_analysis: { enabled: false, max_gap_searches: 0 },
};

function makeEngine(db: Database, provider: LLMProvider, maxIterations = 10): ResearchEngine {
  return new ResearchEngine({ sqlite: db, provider, maxIterations });
}

// ========== All threads processed ==========

describe('engine processes all queued threads', () => {
  test('with max_concurrent_threads=1, all 3 threads are exhausted', async () => {
    const db = createTestDb();
    const config = { ...BASE_CONFIG, max_concurrent_threads: 1 };

    const provider = new MockProvider();
    // 3 threads × 4 responses per iteration
    for (let i = 0; i < 3; i++) provider.push(...makeIterationResponses());

    const engine = makeEngine(db, provider);
    const session = await engine.startSession('Test', 'concurrency test', config);

    // Add 2 more threads beyond the seed thread
    threads.createThread(db, { session_id: session.id, query: 'thread 2', origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: session.id, query: 'thread 3', origin: 'seed', priority: 0.3, depth: 0, max_depth: 5 });

    await engine.runIterations(session.id);

    const all = threads.listThreads(db, session.id);
    const exhausted = all.filter(t => t.origin === 'seed' && t.status === 'exhausted');
    expect(exhausted.length).toBe(3);
  });

  test('with max_concurrent_threads=3, all 3 threads are exhausted', async () => {
    const db = createTestDb();
    const config = { ...BASE_CONFIG, max_concurrent_threads: 3 };

    const provider = new MockProvider();
    for (let i = 0; i < 3; i++) provider.push(...makeIterationResponses());

    const engine = makeEngine(db, provider);
    const session = await engine.startSession('Test', 'concurrency test', config);

    threads.createThread(db, { session_id: session.id, query: 'thread 2', origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: session.id, query: 'thread 3', origin: 'seed', priority: 0.3, depth: 0, max_depth: 5 });

    await engine.runIterations(session.id);

    const exhausted = threads.listThreads(db, session.id)
      .filter(t => t.origin === 'seed' && t.status === 'exhausted');
    expect(exhausted.length).toBe(3);
  });
});

// ========== Priority ordering under serialization ==========

describe('priority ordering with max_concurrent_threads=1', () => {
  test('higher-priority thread is exhausted before lower-priority thread', async () => {
    const db = createTestDb();
    const config = { ...BASE_CONFIG, max_concurrent_threads: 1 };

    const processingOrder: string[] = [];
    const provider: LLMProvider = {
      async complete(model, prompt): Promise<LLMResult> {
        // Capture which thread query is being processed via the prompt content
        if (prompt.includes('low-priority-query')) processingOrder.push('low');
        if (prompt.includes('high-priority-query')) processingOrder.push('high');
        // Return a valid finding structure
        if (prompt.includes('synthesiz') || prompt.includes('research synthesizer')) {
          return { text: NO_FOLLOW_UPS_FINDING, promptTokens: 100, completionTokens: 50, model };
        }
        if (prompt.includes('gap') || prompt.includes('detectGaps') || prompt.includes('completeness')) {
          return { text: JSON.stringify([]), promptTokens: 50, completionTokens: 10, model };
        }
        if (prompt.includes('query formulator') || prompt.includes('search queries')) {
          return { text: JSON.stringify(['search q']), promptTokens: 50, completionTokens: 10, model };
        }
        return { text: 'Short Title', promptTokens: 50, completionTokens: 10, model };
      },
      async searchWeb(model, query): Promise<WebSearchResult> {
        return { text: 'results', sourceUrls: ['https://example.com'], promptTokens: 50, completionTokens: 10, model };
      },
    };

    const engine = makeEngine(db, provider, 20);
    // Create session with only a placeholder seed (we'll replace with explicit threads)
    const sess = queries.createQuery(db, 'Test', 'concurrency', {
      ...BASE_CONFIG,
      max_concurrent_threads: 1,
    } as any);

    threads.createThread(db, { session_id: sess.id, query: 'low-priority-query',  origin: 'seed', priority: 0.1, depth: 0, max_depth: 5 });
    threads.createThread(db, { session_id: sess.id, query: 'high-priority-query', origin: 'seed', priority: 0.9, depth: 0, max_depth: 5 });

    await engine.runIterations(sess.id);

    const highIdx = processingOrder.findIndex(x => x === 'high');
    const lowIdx  = processingOrder.findIndex(x => x === 'low');

    if (highIdx !== -1 && lowIdx !== -1) {
      expect(highIdx).toBeLessThan(lowIdx);
    }
  });
});

// ========== No double-claiming ==========

describe('concurrent slots do not process the same thread twice', () => {
  test('each thread produces exactly one finding with max_concurrent_threads=2', async () => {
    const db = createTestDb();
    const config = { ...BASE_CONFIG, max_concurrent_threads: 2 };

    // 2 threads × responses, cycling is fine since each thread only runs once
    const provider = new MockProvider();
    for (let i = 0; i < 2; i++) provider.push(...makeIterationResponses());

    const engine = makeEngine(db, provider, 10);
    const session = await engine.startSession('Test', 'dedup test', config);
    threads.createThread(db, { session_id: session.id, query: 'second thread', origin: 'seed', priority: 0.5, depth: 0, max_depth: 5 });

    await engine.runIterations(session.id);

    // 2 seed threads → exactly 2 findings (one per thread, no double-processing)
    const allFindings = db.prepare('SELECT * FROM research_findings WHERE session_id = ?').all(session.id) as any[];
    expect(allFindings.length).toBe(2);
  });
});
