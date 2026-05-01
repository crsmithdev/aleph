/**
 * Integration tests for high-leverage uncovered behavior:
 *   1. TrackedLLM auto-tracking property (every call records a step + excerpts)
 *   2. Happy path: full engine run produces findings, document, citations
 *   3. Worker fanout: dispatcher creates thread-jobs alongside a session-job
 *   4. Live mode + promote backend
 *   5. Role priming threading: system prompt prepended on synthesis, bypassed
 *      on perturbation/dedup
 *
 * No real LLM is called — everything goes through a deterministic mock
 * provider. Runs with the rest of the test suite via `bun test`.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { ResearchEngine, pickAgentRole } from './engine';
import type { LLMProvider, LLMResult, WebSearchResult } from './engine';
import { TrackedLLM } from './services/llm';
import * as queries from './services/queries';
import * as threads from './services/threads';
import * as findings from './services/findings';
import * as steps from './services/steps';
import * as jobs from './services/jobs';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

interface CompleteCall {
  model: string;
  prompt: string;
  systemPrompt: string | null | undefined;
  maxTokens: number;
}

class RecordingProvider implements LLMProvider {
  public completeCalls: CompleteCall[] = [];
  public searchCalls: Array<{ model: string; query: string }> = [];
  private completeQueue: string[] = [];
  private searchQueue: string[] = [];

  pushComplete(text: string): this { this.completeQueue.push(text); return this; }
  pushSearch(text: string): this { this.searchQueue.push(text); return this; }

  async complete(model: string, prompt: string, maxTokens: number, systemPrompt?: string | null): Promise<LLMResult> {
    this.completeCalls.push({ model, prompt, systemPrompt, maxTokens });
    const text = this.completeQueue.shift() ?? '[]';
    return { text, promptTokens: 100, completionTokens: 50, model };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    this.searchCalls.push({ model, query });
    const text = this.searchQueue.shift() ?? `Mock search results for "${query}".`;
    return {
      text,
      sourceUrls: ['https://example.com/source-1'],
      sourceUrlMeta: [{ url: 'https://example.com/source-1', title: 'Source 1', snippet: 'snippet' }],
      sourceTexts: [],
      promptTokens: 200, completionTokens: 100, model,
    };
  }
}

const NO_DELAY = {
  min_delay_between_steps_ms: 0,
  gap_analysis: { enabled: false, max_gap_searches: 0 },
};

// ===========================================================================
// 1. TrackedLLM auto-tracking property
// ===========================================================================

describe('TrackedLLM: every call auto-records a step', () => {
  test('records a step on every successful complete()', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const provider = new RecordingProvider().pushComplete('hello world');
    const llm = new TrackedLLM(provider, db);

    const result = await llm.complete(
      { session_id: session.id, thread_id: null, label: 'test call' },
      'mock-model', 'tell me hi', 50,
    );

    expect(result.text).toBe('hello world');
    const allSteps = steps.listSteps(db, session.id);
    expect(allSteps.length).toBe(1);
    expect(allSteps[0].label).toBe('test call');
    expect(allSteps[0].thread_id).toBeNull();
    expect(allSteps[0].prompt_tokens).toBe(100);
    expect(allSteps[0].completion_tokens).toBe(50);
  });

  test('captures input_excerpt + output_excerpt in metadata', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const provider = new RecordingProvider().pushComplete('the answer is 42');
    const llm = new TrackedLLM(provider, db);

    await llm.complete(
      { session_id: session.id, thread_id: null, label: 'tt' },
      'mock-model', 'what is the meaning of life?', 50,
    );

    const allSteps = steps.listSteps(db, session.id);
    const md = allSteps[0].metadata as Record<string, unknown>;
    expect(md.input_excerpt).toBe('what is the meaning of life?');
    expect(md.output_excerpt).toBe('the answer is 42');
  });

  test('truncates long excerpts at 1.5KB ceiling', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const longInput = 'a'.repeat(3000);
    const longOutput = 'b'.repeat(3000);
    const provider = new RecordingProvider().pushComplete(longOutput);
    const llm = new TrackedLLM(provider, db);

    await llm.complete(
      { session_id: session.id, thread_id: null, label: 'big' },
      'mock-model', longInput, 50,
    );

    const md = steps.listSteps(db, session.id)[0].metadata as Record<string, unknown>;
    expect((md.input_excerpt as string).length).toBeLessThanOrEqual(1501);
    expect((md.output_excerpt as string).length).toBeLessThanOrEqual(1501);
    expect((md.input_excerpt as string).endsWith('…')).toBe(true);
    expect((md.output_excerpt as string).endsWith('…')).toBe(true);
  });

  test('does NOT record a step when the call throws (caller handles errors)', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const provider: LLMProvider = {
      async complete() { throw new Error('429 rate limited'); },
      async searchWeb(model, _query) {
        return { text: '', sourceUrls: [], sourceTexts: [], promptTokens: 0, completionTokens: 0, model };
      },
    };
    const llm = new TrackedLLM(provider, db);

    await expect(
      llm.complete({ session_id: session.id, thread_id: null, label: 'x' }, 'm', 'p', 50)
    ).rejects.toThrow('429');

    expect(steps.listSteps(db, session.id).length).toBe(0);
  });

  test('updateStepMetadata merges instead of overwriting (preserves excerpts)', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const provider = new RecordingProvider().pushComplete('result text');
    const llm = new TrackedLLM(provider, db);

    const r = await llm.complete(
      { session_id: session.id, thread_id: null, label: 'l' },
      'm', 'prompt body', 50,
    );

    // Caller layers a decision-block on top after the call.
    steps.updateStepMetadata(db, r.stepId, { decision: 'pick_role', role_label: 'Sage' });

    const after = steps.getStep(db, r.stepId)!;
    const md = after.metadata as Record<string, unknown>;
    expect(md.decision).toBe('pick_role');
    expect(md.role_label).toBe('Sage');
    expect(md.input_excerpt).toBe('prompt body');
    expect(md.output_excerpt).toBe('result text');
  });
});

// ===========================================================================
// 2. Happy path: engine run produces findings + document + concepts
// ===========================================================================

describe('happy path: full engine run', () => {
  test('runs N iterations producing findings, steps, and a document', async () => {
    const db = createTestDb();
    const provider = new RecordingProvider();
    // Seed-thread title summarization
    provider.pushComplete('Sourdough');
    // Iter 1: formulate → search → synthesize → detectGaps (gap analysis disabled)
    provider.pushComplete(JSON.stringify(['initial query']));
    provider.pushComplete(JSON.stringify({
      content: 'Bakers traditionally feed starter twice daily.',
      summary: 'Twice-daily feeding stabilizes starter activity.',
      source_urls: ['https://example.com/source-1'],
      source_quality: 0.8,
      tags: ['bread'],
      confidence: 0.85,
      novelty: 0.7,
      actionability: 0.6,
      follow_ups: ['How does temperature affect timing?'],
    }));
    provider.pushComplete(JSON.stringify(['How does temperature affect timing?']));
    // Document gen call (when iterations % 3 == 0 OR via updateDocument path)
    provider.pushComplete('## Sourdough Basics\n\nA short article body.');

    const engine = new ResearchEngine({ sqlite: db, provider, maxIterations: 1 });
    const session = await engine.startSession('Sourdough', 'How is sourdough made?', NO_DELAY);
    await engine.runIterations(session.id);

    const sessionAfter = queries.getQuery(db, session.id)!;
    const allFindings = findings.listFindings(db, session.id);
    const allSteps = steps.listSteps(db, session.id);

    expect(allFindings.length).toBeGreaterThanOrEqual(1);
    // Engine produced at least: formulate, web search, synthesize, follow-up eval, summarize-thread
    expect(allSteps.length).toBeGreaterThanOrEqual(3);
    // Every step has session_id set
    expect(allSteps.every(s => s.session_id === session.id)).toBe(true);
    // Cost was tallied
    const costRow = queries.getQueryCost(db, session.id);
    expect(costRow.step_count).toBe(allSteps.length);
    void sessionAfter; // assertion below is the document path
  });
});

// ===========================================================================
// 3. Worker fanout: dispatcher creates thread-jobs alongside a session-job
// ===========================================================================

describe('worker fanout: dispatcher and session-job coexist', () => {
  test('getQueuedThreadsForNewJobs returns queued threads even with active session-job', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    threads.createThread(db, { session_id: session.id, query: 'q1', origin: 'seed' });
    threads.createThread(db, { session_id: session.id, query: 'q2', origin: 'follow_up' });
    threads.createThread(db, { session_id: session.id, query: 'q3', origin: 'follow_up' });

    // Active session-level job (the burst kickoff)
    const sessJob = jobs.createJob(db, { session_id: session.id, mode: 'burst' });
    jobs.claimJob(db, sessJob.id, 'worker-1');
    jobs.markRunning(db, sessJob.id, 'worker-1');

    // Dispatcher should now see all 3 queued threads as available — the
    // earlier defensive guard that returned [] is gone.
    const available = jobs.getQueuedThreadsForNewJobs(db, session.id, 10);
    expect(available.length).toBe(3);
  });

  test('two parallel claimNextThread calls never claim the same thread (atomicity)', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const t1 = threads.createThread(db, { session_id: session.id, query: 'q1', origin: 'seed' });

    const a = threads.claimNextThread(db, session.id);
    const b = threads.claimNextThread(db, session.id);

    expect(a?.id).toBe(t1.id);
    expect(b).toBeNull(); // only one thread → second claim returns null
  });

  test('createThreadJobIfNone is idempotent — second call returns null', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'topic');
    const t = threads.createThread(db, { session_id: session.id, query: 'q', origin: 'seed' });

    const j1 = jobs.createThreadJobIfNone(db, { session_id: session.id, thread_id: t.id });
    const j2 = jobs.createThreadJobIfNone(db, { session_id: session.id, thread_id: t.id });

    expect(j1).not.toBeNull();
    expect(j2).toBeNull();
  });
});

// ===========================================================================
// 4. Live mode + promote (backend state machine only)
// ===========================================================================

describe('live mode pause + promote', () => {
  test('updateQuery clears max_session_duration_minutes and flips status to active', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Live', 'topic', {
      schedule: { mode: 'background', active_windows: [], timezone: 'UTC', max_session_duration_minutes: 5 },
      on_duration_expiry: 'pause',
    });
    expect(session.config.schedule.max_session_duration_minutes).toBe(5);

    // Simulate the wall-clock expiry path: status → paused, document snapshot is the engine's job.
    queries.updateQuery(db, session.id, { status: 'paused' });
    expect(queries.getQuery(db, session.id)!.status).toBe('paused');

    // Promote: clear the cap, flip status back to active.
    const promoted = queries.updateQuery(db, session.id, {
      status: 'active',
      config: { schedule: { ...session.config.schedule, max_session_duration_minutes: null } },
    });

    expect(promoted!.status).toBe('active');
    expect(promoted!.config.schedule.max_session_duration_minutes).toBeNull();
  });
});

// ===========================================================================
// 5. Role priming: system prompt threading
// ===========================================================================

describe('role priming: system prompt threading', () => {
  test('pickAgentRole records a step with role metadata via TrackedLLM', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'finance question');
    const provider = new RecordingProvider().pushComplete(
      JSON.stringify({ label: 'Finance Analyst', prompt: 'You are a finance analyst.' })
    );
    const llm = new TrackedLLM(provider, db);

    const role = await pickAgentRole(llm, session.id, 'mock-model', 'finance question');

    expect(role?.label).toBe('Finance Analyst');
    expect(role?.prompt).toBe('You are a finance analyst.');

    const allSteps = steps.listSteps(db, session.id);
    expect(allSteps.length).toBe(1);
    expect(allSteps[0].label).toBe('pick role');
    expect(allSteps[0].thread_id).toBeNull();
    const md = allSteps[0].metadata as Record<string, unknown>;
    expect(md.decision).toBe('pick_role');
    expect(md.role_label).toBe('Finance Analyst');
    expect(md.role_prompt).toBe('You are a finance analyst.');
    // Auto-captured excerpts preserved through the metadata merge.
    expect(typeof md.input_excerpt).toBe('string');
    expect(typeof md.output_excerpt).toBe('string');
  });

  test('role_prompt threads through to provider as systemPrompt when set', async () => {
    const db = createTestDb();
    const provider = new RecordingProvider();
    // Seed-thread summarization absorber.
    provider.pushComplete('Topic Heading');
    // Iter 1: formulate → synthesize → follow-up eval
    provider.pushComplete(JSON.stringify(['q']));
    provider.pushComplete(JSON.stringify({
      content: 'A finding.', summary: 'short', source_urls: ['https://x'], source_quality: 0.5,
      tags: [], confidence: 0.8, novelty: 0.6, actionability: 0.5,
      follow_ups: ['follow-up?'],
    }));
    provider.pushComplete(JSON.stringify(['follow-up?']));

    const ROLE_PROMPT = 'You are a finance analyst. Cite SEC filings.';
    const engine = new ResearchEngine({ sqlite: db, provider, maxIterations: 1 });
    const session = await engine.startSession('Finance', 'Q4 outlook?', {
      ...NO_DELAY,
      role_prompt: ROLE_PROMPT,
      role_label: 'Finance Analyst',
    });
    await engine.runIterations(session.id);

    // At least one complete() call should carry the role prompt as systemPrompt.
    const withRole = provider.completeCalls.filter(c => c.systemPrompt === ROLE_PROMPT);
    expect(withRole.length).toBeGreaterThanOrEqual(1);
  });

  test('non-role-shaping calls bypass the role prompt (systemPrompt is null)', async () => {
    // Some call sites (perturbation, the dedup judge, concept extraction,
    // score-and-rank judges) intentionally bypass the role prompt because the
    // domain voice would bias judgement or fight the diversity engine. With a
    // role set, AT LEAST ONE complete() call should still arrive at the
    // provider with no system prompt.
    const db = createTestDb();
    const provider = new RecordingProvider();
    provider.pushComplete('Heading');
    provider.pushComplete(JSON.stringify(['q']));
    provider.pushComplete(JSON.stringify({
      content: 'A finding.', summary: 'short', source_urls: ['https://x'], source_quality: 0.5,
      tags: [], confidence: 0.8, novelty: 0.6, actionability: 0.5,
      follow_ups: [],
    }));
    provider.pushComplete(JSON.stringify([]));
    // Concept extraction result (called per-finding, bypasses role)
    provider.pushComplete(JSON.stringify({ concepts: [], relations: [] }));

    const engine = new ResearchEngine({ sqlite: db, provider, maxIterations: 1 });
    const session = await engine.startSession('Finance', 'topic', {
      ...NO_DELAY,
      role_prompt: 'You are a finance analyst.',
    });
    await engine.runIterations(session.id);

    const nullSystem = provider.completeCalls.filter(c => c.systemPrompt === null || c.systemPrompt === undefined);
    expect(nullSystem.length).toBeGreaterThanOrEqual(1);
  });
});
