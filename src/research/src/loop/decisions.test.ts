/**
 * Decision recording — observability seam tests.
 *
 * Covers the two new surfaces wired in for the Activity tab's Decisions
 * panel:
 *
 *  1. Live event bus: `recordDecision` and `emitDecisionEvent` fire on the
 *     in-process bus with the right shape.
 *  2. Persisted artifact: `recordDecision` appends to a single
 *     `kind: 'decision_log'` artifact per loop, latest-wins by created_at.
 *  3. Integration via the planner (`ensureScheduleArtifact` → `planLoop`
 *     with observability deps) — canon + branch picks become events AND
 *     decision_log entries.
 *  4. Integration via the research template — derivation emits
 *     `followup_pick` decisions, with `accepted: true` on the entry that
 *     the next cycle will use and `reason: 'fallback'` when the LLM
 *     response is malformed.
 *
 * Pattern follows shape.test.ts / planner.test.ts: in-memory SQLite,
 * FakeLLMProvider, no network.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { clearResearchListeners, onResearchEvent, type ResearchEvent } from '../services/events';
import { createArtifact, createLoop, listArtifacts, readState } from './db';
import { recordDecision, emitDecisionEvent, readDecisionLog } from './decisions';
import { runLoop } from './engine';
import { FakeLLMProvider } from './llm';
import { ensureScheduleArtifact } from './shape';
import { makeResearchTemplate } from './templates/research';
import { buildTemplate } from './templates/registry';
import type { DecisionPayload, DecisionLogPayload } from './types';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

function captureEvents(): { events: ResearchEvent[]; stop: () => void } {
  const events: ResearchEvent[] = [];
  const unsub = onResearchEvent(e => { events.push(e); });
  return { events, stop: unsub };
}

describe('recordDecision — event + artifact append', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); clearResearchListeners(); });
  afterEach(() => { clearResearchListeners(); });

  test('first call: emits the event AND creates a decision_log artifact with one entry', () => {
    const { events } = captureEvents();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });

    const decision: DecisionPayload = {
      type: 'canon_pick',
      entity: 'react',
      index: 0,
      total: 2,
    };
    recordDecision(sqlite, loop.id, decision);

    // Event fired with the right type + payload.
    const decisionEvents = events.filter(e => e.type === 'decision');
    expect(decisionEvents).toHaveLength(1);
    expect(decisionEvents[0].session_id).toBe(loop.id);
    expect(decisionEvents[0].payload).toEqual(decision);

    // Artifact landed with the entry inside.
    const logs = listArtifacts(sqlite, loop.id, 'decision_log');
    expect(logs).toHaveLength(1);
    const payload = logs[0].payload as unknown as DecisionLogPayload;
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].decision).toEqual(decision);
    expect(typeof payload.entries[0].recorded_at).toBe('string');
  });

  test('subsequent calls: each writes a NEW artifact row carrying all prior entries plus the new one', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });

    const d1: DecisionPayload = { type: 'canon_pick', entity: 'react', index: 0, total: 2 };
    const d2: DecisionPayload = { type: 'canon_pick', entity: 'vue',   index: 1, total: 2 };
    const d3: DecisionPayload = { type: 'branch_pick', branch_id: 'b1', query: 'q', index: 0, total: 1 };

    recordDecision(sqlite, loop.id, d1);
    recordDecision(sqlite, loop.id, d2);
    recordDecision(sqlite, loop.id, d3);

    const logs = listArtifacts(sqlite, loop.id, 'decision_log');
    // Append-as-new-row: three writes => three artifact rows.
    expect(logs).toHaveLength(3);

    // The freshest carries all three entries in order.
    const latest = readDecisionLog(logs)!;
    expect(latest.entries.map(e => e.decision)).toEqual([d1, d2, d3]);
  });

  test('readDecisionLog on a state with no decision_log returns null', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const artifacts = listArtifacts(sqlite, loop.id);
    expect(readDecisionLog(artifacts)).toBeNull();
  });

  test('emitDecisionEvent fires the event WITHOUT writing an artifact', () => {
    const { events } = captureEvents();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });

    emitDecisionEvent(loop.id, { type: 'canon_pick', entity: 'a', index: 0, total: 1 });

    expect(events.filter(e => e.type === 'decision')).toHaveLength(1);
    expect(listArtifacts(sqlite, loop.id, 'decision_log')).toHaveLength(0);
  });
});

describe('planner — canon + branch decisions via ensureScheduleArtifact', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); clearResearchListeners(); });
  afterEach(() => { clearResearchListeners(); });

  test('canon entries and branches each become a decision event + log entry', async () => {
    const { events } = captureEvents();

    const llm = new FakeLLMProvider({
      complete: (_model, prompt) => {
        if (prompt.startsWith('Plan a research loop')) {
          return JSON.stringify({
            canon: ['redux', 'mobx'],
            branches: [
              { id: 'b1', query: 'q1' },
              { id: 'b2', query: 'q2', budget: 4 },
            ],
            per_branch_budget: 2,
            perturbation_weights: {},
            milestone_plan: [0.5, 1.0],
          });
        }
        return '{"kind":"prose"}';
      },
    });

    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);

    const decisionEvents = events
      .filter(e => e.type === 'decision')
      .map(e => e.payload as DecisionPayload);

    // 2 canon + 2 branches = 4 decision events.
    expect(decisionEvents).toHaveLength(4);

    const canonPicks = decisionEvents.filter(d => d.type === 'canon_pick');
    expect(canonPicks).toHaveLength(2);
    expect(canonPicks[0]).toEqual({ type: 'canon_pick', entity: 'redux', index: 0, total: 2 });
    expect(canonPicks[1]).toEqual({ type: 'canon_pick', entity: 'mobx',  index: 1, total: 2 });

    const branchPicks = decisionEvents.filter(d => d.type === 'branch_pick');
    expect(branchPicks).toHaveLength(2);
    expect(branchPicks[0]).toEqual({
      type: 'branch_pick', branch_id: 'b1', query: 'q1', index: 0, total: 2,
    });
    expect(branchPicks[1]).toEqual({
      type: 'branch_pick', branch_id: 'b2', query: 'q2', index: 1, total: 2, budget: 4,
    });

    // Persisted log: latest decision_log artifact carries all 4 entries.
    const log = readDecisionLog(listArtifacts(sqlite, loop.id))!;
    expect(log.entries.map(e => e.decision)).toEqual(decisionEvents);
  });
});

describe('research template — derivation emits followup_pick decisions', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); clearResearchListeners(); });
  afterEach(() => { clearResearchListeners(); });

  test('happy path: each derivation emits two followup_pick events; first accepted, second bookkept', async () => {
    const { events } = captureEvents();
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({
        text: `findings for ${q}`,
        sources: [{ url: `https://e.test/${encodeURIComponent(q)}`, title: 't', snippet: 's' }],
      }),
      complete: () => JSON.stringify(['next-q', 'alt-q']),
    });

    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const template = makeResearchTemplate('p', { cycles_target: 2 }, { llm, sqlite });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const decisionEvents = events
      .filter(e => e.type === 'decision')
      .map(e => e.payload as DecisionPayload)
      .filter(d => d.type === 'followup_pick');

    // 2 cycles × 2 follow-ups per cycle = 4 decisions.
    expect(decisionEvents).toHaveLength(4);

    // Cycle 0's follow-ups.
    expect(decisionEvents[0]).toMatchObject({
      type: 'followup_pick', query: 'next-q', accepted: true,  index: 0, total: 2,
    });
    expect(decisionEvents[1]).toMatchObject({
      type: 'followup_pick', query: 'alt-q',  accepted: false, index: 1, total: 2,
    });
    expect(typeof (decisionEvents[0] as { cycle_id: string }).cycle_id).toBe('string');

    // None of these are fallback decisions.
    expect(decisionEvents.every(d => !('reason' in d) || (d as { reason?: string }).reason !== 'fallback')).toBe(true);

    // Persisted artifact carries every decision (4 followup_picks).
    const log = readDecisionLog(listArtifacts(sqlite, loop.id))!;
    const followups = log.entries.map(e => e.decision).filter(d => d.type === 'followup_pick');
    expect(followups).toHaveLength(4);
  });

  test('malformed derivation response: single fallback follow-up decision with reason="fallback"', async () => {
    const { events } = captureEvents();
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({
        text: `findings for ${q}`,
        sources: [{ url: `https://e.test/${encodeURIComponent(q)}`, title: 't', snippet: 's' }],
      }),
      complete: () => 'not json at all',
    });

    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const template = makeResearchTemplate('p', { cycles_target: 1 }, { llm, sqlite });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const decisionEvents = events
      .filter(e => e.type === 'decision')
      .map(e => e.payload as DecisionPayload)
      .filter(d => d.type === 'followup_pick');

    expect(decisionEvents).toHaveLength(1);
    expect(decisionEvents[0]).toMatchObject({
      type: 'followup_pick',
      accepted: true,
      index: 0,
      total: 1,
      reason: 'fallback',
    });
  });

  test('event-only path (no sqlite in deps): decisions fire but no artifact is appended', async () => {
    const { events } = captureEvents();
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({
        text: `findings for ${q}`,
        sources: [{ url: `https://e.test/${encodeURIComponent(q)}`, title: 't', snippet: 's' }],
      }),
      complete: () => JSON.stringify(['next-q', 'alt-q']),
    });

    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    // No sqlite in deps — mirrors the path tests of makeResearchTemplate
    // directly. buildTemplate (the prod path) propagates sqlite when it's
    // present in TemplateDeps; the next test covers that.
    const template = makeResearchTemplate('p', { cycles_target: 1 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(events.filter(e => e.type === 'decision')).toHaveLength(2);
    expect(listArtifacts(sqlite, loop.id, 'decision_log')).toHaveLength(0);
  });

  test('via buildTemplate (prod path): TemplateDeps.sqlite reaches the derivation hook and decision_log persists', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({
        text: `findings for ${q}`,
        sources: [{ url: `https://e.test/${encodeURIComponent(q)}`, title: 't', snippet: 's' }],
      }),
      complete: () => JSON.stringify(['next-q', 'alt-q']),
    });

    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    // Go through the registry the way run.ts does in production: pass sqlite
    // via TemplateDeps. Before #4, this didn't carry through — buildTemplate
    // only forwarded { llm } to the research template factory.
    const template = buildTemplate('research', 'p', { cycles_target: 2 }, { llm, sqlite });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const log = readDecisionLog(listArtifacts(sqlite, loop.id))!;
    expect(log).not.toBeNull();
    const followups = log.entries.map(e => e.decision).filter(d => d.type === 'followup_pick');
    // 2 cycles × 2 follow-ups = 4 persisted decisions.
    expect(followups).toHaveLength(4);
  });
});

describe('research template — renderer populates per-source extraction_status', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); clearResearchListeners(); });

  test('every metadata-bearing source is extracted with attempts=1', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({
        text: `t for ${q}`,
        sources: [
          { url: 'https://ok.test/a', title: 'A', snippet: 's' },
          { url: 'https://ok.test/b', title: 'B', snippet: 's' },
        ],
      }),
      complete: () => JSON.stringify(['q1', 'q2']),
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const template = makeResearchTemplate('p', { cycles_target: 1 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const state = readState(sqlite, loop.id);
    const render = (await template.renderer(state)).output;

    expect(render.sources).toHaveLength(2);
    for (const source of render.sources) {
      expect(source.extraction_status).toBe('extracted');
      expect(source.attempts).toBe(1);
      expect(source.error).toBeUndefined();
    }
  });

  test('URLs in source_urls but missing from source_meta are marked failed with "no metadata returned"', async () => {
    // Synthesize a cycle_output artifact directly so we can drive the divergence
    // — the FakeLLMProvider mirrors source_urls to source_meta exactly, so a
    // unit-of-renderer test is the simpler way to exercise the failed path.
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const cycleArtifactPayload = {
      processor: {
        kind: 'research_proc',
        query: 'q',
        text: 'findings',
        source_urls: ['https://hit.test/a', 'https://miss.test/b'],
        source_meta: [
          { url: 'https://hit.test/a', title: 'Hit A', snippet: 's' },
          // miss.test/b was attempted (it's in source_urls) but has no meta.
        ],
        tokens: { prompt: 1, completion: 1 },
        model: 'fake',
      },
    };
    createArtifact(sqlite, {
      loop_id: loop.id,
      cycle_id: null,
      kind: 'cycle_output',
      payload: cycleArtifactPayload,
    });

    const llm = new FakeLLMProvider();
    const template = makeResearchTemplate('p', { cycles_target: 1 }, { llm });
    const state = readState(sqlite, loop.id);
    const render = (await template.renderer(state)).output;

    expect(render.sources).toHaveLength(2);
    const byUrl = new Map(render.sources.map(s => [s.url, s]));
    expect(byUrl.get('https://hit.test/a')).toEqual({
      url: 'https://hit.test/a',
      title: 'Hit A',
      extraction_status: 'extracted',
      attempts: 1,
    });
    expect(byUrl.get('https://miss.test/b')).toEqual({
      url: 'https://miss.test/b',
      title: '',
      extraction_status: 'failed',
      attempts: 1,
      error: 'no metadata returned',
    });
  });
});
