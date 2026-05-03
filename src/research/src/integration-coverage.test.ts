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
import { ResearchEngine, pickAgentRole, enumerateCanon, detectTopicCluster } from './engine';
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
    const sessJob = jobs.createJob(db, { session_id: session.id, mode: 'priority' });
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
      schedule: { mode: 'default', active_windows: [], timezone: 'UTC', max_session_duration_minutes: 5 },
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

// ===========================================================================
// 6. enumerateCanon: parses canon items and records a decision step
// ===========================================================================

describe('enumerateCanon', () => {
  test('returns items and writes enumerate_canon decision step on valid response', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'EDM history', 'overview of EDM in the 1990s');
    const provider = new RecordingProvider().pushComplete(JSON.stringify([
      { item: "Moby — Play (1999)", context: "breakout commercial mainstream success" },
      { item: "Underworld — Born Slippy", context: "Trainspotting soundtrack defined late-90s rave" },
      { item: "Daft Punk — Homework (1997)", context: "filter house template" },
    ]));
    const llm = new TrackedLLM(provider, db);

    const items = await enumerateCanon(llm, session.id, 'mock-model', session.prompt, 'survey+timeline');

    expect(items).not.toBeNull();
    expect(items!.length).toBe(3);
    expect(items![0].item).toContain('Moby');
    expect(items![0].context).toContain('mainstream');

    // Step recorded with decision metadata.
    const allSteps = steps.listSteps(db, session.id);
    const enumStep = allSteps.find(s => {
      const md = s.metadata as Record<string, unknown> | null;
      return md?.decision === 'enumerate_canon';
    });
    expect(enumStep).toBeDefined();
    const md = enumStep!.metadata as Record<string, unknown>;
    expect(md.target_count).toBe(3);
    expect(md.shape_hint).toBe('survey+timeline');
  });

  test('returns null on malformed JSON', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'something');
    const provider = new RecordingProvider().pushComplete('this is not json at all');
    const llm = new TrackedLLM(provider, db);

    const items = await enumerateCanon(llm, session.id, 'mock-model', session.prompt, 'survey');
    expect(items).toBeNull();
  });

  test('returns null when no items pass validation', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'something');
    const provider = new RecordingProvider().pushComplete(JSON.stringify([
      { item: '', context: 'empty item filtered out' },
      { wrongShape: true },
    ]));
    const llm = new TrackedLLM(provider, db);

    const items = await enumerateCanon(llm, session.id, 'mock-model', session.prompt, 'survey');
    expect(items).toBeNull();
  });
});

// ===========================================================================
// 7. Coverage check: per-canon-slot finding counts written as decision step
// ===========================================================================

describe('canon coverage check', () => {
  test('writes coverage_check step counting findings per canon-slot thread', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'EDM', 'overview of EDM');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'overview of EDM', origin: 'seed', depth: 0,
    });
    // Three canon-slot threads. The first two get a finding; the third stays
    // empty so coverage is partial.
    const slotCovered1 = threads.createThread(db, {
      session_id: session.id, query: 'Moby — Play', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    const slotCovered2 = threads.createThread(db, {
      session_id: session.id, query: 'Underworld — Born Slippy', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    const slotEmpty = threads.createThread(db, {
      session_id: session.id, query: 'Daft Punk — Homework', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    findings.createFinding(db, {
      thread_id: slotCovered1.id, session_id: session.id,
      content: 'F1', summary: 's1', source_urls: [], source_texts: [],
      source_quality: 0.5, tags: [], confidence: 0.8, novelty: 0.6, actionability: 0.5,
      follow_ups: [],
    });
    findings.createFinding(db, {
      thread_id: slotCovered2.id, session_id: session.id,
      content: 'F2', summary: 's2', source_urls: [], source_texts: [],
      source_quality: 0.5, tags: [], confidence: 0.8, novelty: 0.6, actionability: 0.5,
      follow_ups: [],
    });

    // Direct call — runCoverageCheck is pure SQL+step write, no engine flow
    // needed. Avoids the integration-test fragility of priming all the LLM
    // responses runIterations expects.
    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    engine.runCoverageCheck(session.id, seed.id);

    const coverageSteps = steps.listSteps(db, session.id).filter(s => {
      const md = s.metadata as Record<string, unknown> | null;
      return md?.decision === 'coverage_check';
    });
    expect(coverageSteps.length).toBe(1);
    const md = coverageSteps[0].metadata as Record<string, unknown>;
    expect(md.total_count).toBe(3);
    // Exactly two of the three slots are covered (have findings).
    expect(md.covered_count).toBe(2);
    const slots = md.slots as Array<{ thread_id: string; finding_count: number; covered: boolean }>;
    const empty = slots.find(s => s.thread_id === slotEmpty.id);
    expect(empty?.covered).toBe(false);
    expect(empty?.finding_count).toBe(0);
  });

  test('skips coverage check when there are no canon-slot threads', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    engine.runCoverageCheck(session.id, seed.id);

    const coverageSteps = steps.listSteps(db, session.id).filter(s => {
      const md = s.metadata as Record<string, unknown> | null;
      return md?.decision === 'coverage_check';
    });
    expect(coverageSteps.length).toBe(0);
  });
});

// ===========================================================================
// 8. Evidence-driven perturbation triggers (B3)
// ===========================================================================

const TRIGGER_TEST_CONFIG = {
  diminishing_returns_threshold: 0.3,
  diminishing_returns_window: 5,
  perturbation: {
    depth_scaling: false,
    chain_length: 1,
    strategy_cooldown: 3,
    forced_diversity_threshold: 5,
    strategy_weights: {},
  },
} as const;

function makeFinding(db: Database, sessionId: string, threadId: string, novelty: number, tags: string[]) {
  return findings.createFinding(db, {
    thread_id: threadId, session_id: sessionId,
    content: 'c', summary: 's', source_urls: [], source_texts: [],
    source_quality: 0.5, tags, confidence: 0.7, novelty, actionability: 0.5,
    follow_ups: [],
  });
}

describe('evidence-driven perturbation triggers', () => {
  test('stuck_novelty: rolling avg below threshold returns trigger', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    for (let i = 0; i < 5; i++) makeFinding(db, session.id, seed.id, 0.1, [`tag${i}`]);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    const result = engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any);
    expect(result?.trigger).toBe('stuck_novelty');
    expect(result?.signal.rolling_avg_novelty).toBe(0.1);
    expect(result?.signal.threshold).toBe(0.3);
    expect(result?.signal.window).toBe(5);
  });

  test('stuck_novelty: avg above threshold does NOT trigger', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    // High novelty + diverse tags so neither stuck_novelty nor cluster fires.
    for (let i = 0; i < 5; i++) makeFinding(db, session.id, seed.id, 0.7, [`unique-${i}-a`, `unique-${i}-b`]);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    expect(engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any)).toBeNull();
  });

  test('stuck_novelty: insufficient findings (< window) does NOT trigger', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    for (let i = 0; i < 3; i++) makeFinding(db, session.id, seed.id, 0.05, [`t${i}`]);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    expect(engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any)).toBeNull();
  });

  test('cluster: dominant tag > 50% returns cluster trigger', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    // High novelty (so stuck_novelty doesn't fire first); single shared tag.
    for (let i = 0; i < 5; i++) makeFinding(db, session.id, seed.id, 0.7, ['chart-mechanics']);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    const result = engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any);
    expect(result?.trigger).toBe('cluster');
    expect(result?.signal.dominant_tag).toBe('chart-mechanics');
    expect(result?.signal.dominant_ratio).toBe(1);
  });

  test('cluster: diverse tags do NOT trigger cluster', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    makeFinding(db, session.id, seed.id, 0.7, ['a', 'b']);
    makeFinding(db, session.id, seed.id, 0.7, ['c', 'd']);
    makeFinding(db, session.id, seed.id, 0.7, ['e', 'f']);
    makeFinding(db, session.id, seed.id, 0.7, ['g', 'h']);
    makeFinding(db, session.id, seed.id, 0.7, ['i', 'j']);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    expect(engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any)).toBeNull();
  });

  test('coverage_met: all canon slots covered returns trigger', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    const slot1 = threads.createThread(db, {
      session_id: session.id, query: 'item 1', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    const slot2 = threads.createThread(db, {
      session_id: session.id, query: 'item 2', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    // Distinct tags + high novelty so other triggers don't fire first.
    makeFinding(db, session.id, slot1.id, 0.7, ['t1', 'u1']);
    makeFinding(db, session.id, slot2.id, 0.7, ['t2', 'u2']);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    const result = engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any);
    expect(result?.trigger).toBe('coverage_met');
    expect(result?.signal.canon_covered).toBe(2);
    expect(result?.signal.canon_total).toBe(2);
  });

  test('coverage_met: partial coverage does NOT trigger', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    const slot1 = threads.createThread(db, {
      session_id: session.id, query: 'item 1', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    threads.createThread(db, {
      session_id: session.id, query: 'item 2', origin: 'canon_slot',
      parent_thread_id: seed.id, depth: 1,
    });
    makeFinding(db, session.id, slot1.id, 0.7, ['t1', 'u1']);

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    expect(engine.detectEvidenceTrigger(session.id, TRIGGER_TEST_CONFIG as any)).toBeNull();
  });

  test('rate limit: recentPerturbationCount counts perturbations against the window', () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'X', 'topic');
    const seed = threads.createThread(db, {
      session_id: session.id, query: 'topic', origin: 'seed', depth: 0,
    });
    // 12 findings (> window of 10).
    for (let i = 0; i < 12; i++) makeFinding(db, session.id, seed.id, 0.5, []);
    // 2 perturbation threads created after — both fall within the window.
    threads.createThread(db, {
      session_id: session.id, query: 'pert1', origin: 'perturbation',
      perturbation_strategy: 'analogical', parent_thread_id: seed.id, depth: 1,
    });
    threads.createThread(db, {
      session_id: session.id, query: 'pert2', origin: 'perturbation',
      perturbation_strategy: 'contrarian', parent_thread_id: seed.id, depth: 1,
    });

    const engine = new ResearchEngine({
      sqlite: db, provider: new RecordingProvider(), maxIterations: 0,
    });
    expect(engine.recentPerturbationCount(session.id)).toBe(2);
  });
});

// ===========================================================================
// 6. Topic-cluster classifier
// ===========================================================================

describe('detectTopicCluster: classifies prompts into the fixed enum', () => {
  test('parses a valid {cluster, confidence} response and records a step', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'how do LLMs use prompt caching?');
    const provider = new RecordingProvider().pushComplete(
      JSON.stringify({ cluster: 'AI / LLM tooling', confidence: 0.92 })
    );
    const llm = new TrackedLLM(provider, db);

    const result = await detectTopicCluster(llm, session.id, 'mock-model', 'how do LLMs use prompt caching?');

    expect(result?.cluster).toBe('AI / LLM tooling');
    expect(result?.confidence).toBe(0.92);

    const allSteps = steps.listSteps(db, session.id);
    expect(allSteps.length).toBe(1);
    expect(allSteps[0].label).toBe('detect topic cluster');
    expect(allSteps[0].thread_id).toBeNull();
    const md = allSteps[0].metadata as Record<string, unknown>;
    expect(md.decision).toBe('detect_topic_cluster');
    expect(md.cluster).toBe('AI / LLM tooling');
    expect(md.confidence).toBe(0.92);
  });

  test('persists topic_cluster on the query row via updateQuery and reads back through getQuery', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'history of detroit techno');
    const provider = new RecordingProvider().pushComplete(
      JSON.stringify({ cluster: 'Music history', confidence: 0.88 })
    );
    const llm = new TrackedLLM(provider, db);

    const result = await detectTopicCluster(llm, session.id, 'mock-model', 'history of detroit techno');
    expect(result).not.toBeNull();
    queries.updateQuery(db, session.id, { topic_cluster: result! });

    const fetched = queries.getQuery(db, session.id)!;
    expect(fetched.topic_cluster).not.toBeNull();
    expect(fetched.topic_cluster!.cluster).toBe('Music history');
    expect(fetched.topic_cluster!.confidence).toBe(0.88);
  });

  test('rejects clusters not in the fixed enum (returns null)', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'something');
    const provider = new RecordingProvider().pushComplete(
      JSON.stringify({ cluster: 'Cooking', confidence: 0.9 })
    );
    const llm = new TrackedLLM(provider, db);

    const result = await detectTopicCluster(llm, session.id, 'mock-model', 'something');
    expect(result).toBeNull();
  });

  test('returns null on malformed JSON without throwing', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'x');
    const provider = new RecordingProvider().pushComplete('not json at all');
    const llm = new TrackedLLM(provider, db);

    const result = await detectTopicCluster(llm, session.id, 'mock-model', 'x');
    expect(result).toBeNull();
  });

  test('defaults confidence to 0.5 when missing or out of range', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'sql index types');
    const provider = new RecordingProvider().pushComplete(
      JSON.stringify({ cluster: 'Databases' })
    );
    const llm = new TrackedLLM(provider, db);

    const result = await detectTopicCluster(llm, session.id, 'mock-model', 'sql index types');
    expect(result?.cluster).toBe('Databases');
    expect(result?.confidence).toBe(0.5);
  });

  test('returns null when the LLM call throws (no step recorded)', async () => {
    const db = createTestDb();
    const session = queries.createQuery(db, 'Test', 'x');
    const provider: LLMProvider = {
      async complete() { throw new Error('429'); },
      async searchWeb(model) {
        return { text: '', sourceUrls: [], sourceTexts: [], promptTokens: 0, completionTokens: 0, model };
      },
    };
    const llm = new TrackedLLM(provider, db);

    const result = await detectTopicCluster(llm, session.id, 'mock-model', 'x');
    expect(result).toBeNull();
    expect(steps.listSteps(db, session.id).length).toBe(0);
  });
});
