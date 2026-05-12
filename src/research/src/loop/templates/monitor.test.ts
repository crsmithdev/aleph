/**
 * Monitor template tests — Phase 2.
 *
 * Drives `runLoop` with the monitor template + a FakeLLMProvider. Verifies
 * the wait/run cycle alternation, diff renderer output, and registry
 * dispatch.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../../ddl';
import { createLoop, listArtifacts, readState } from '../db';
import { runLoop } from '../engine';
import { FakeLLMProvider } from '../llm';
import { makeMonitorTemplate } from './monitor';
import { buildTemplate } from './registry';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

describe('monitor template — alternating wait + run', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('with poll_every=2 and cycles_target=4: runs 2 polls, 2 waits', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({
        text: `poll result for "${q}"`,
        sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }],
      }),
    });
    const loop = createLoop(sqlite, { template_id: 'monitor', prompt: 'watch this' });
    const template = makeMonitorTemplate('watch this', { cycles_target: 4, poll_every: 2 }, { llm });

    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.status).toBe('completed');
    expect(result.cycles_run).toBe(4);
    // cycles 0,2 are run-cycles (call searchWeb); cycles 1,3 are wait-cycles
    expect(llm.searchCalls).toBe(2);

    const outputs = listArtifacts(sqlite, loop.id, 'cycle_output');
    expect(outputs).toHaveLength(4);
    const procKinds = outputs.map(o => (o.payload.processor as { kind: string }).kind);
    expect(procKinds).toEqual(['monitor_run', 'monitor_wait', 'monitor_run', 'monitor_wait']);
  });

  test('with poll_every=1: every cycle is a run-cycle', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: (_m, q) => ({ text: `t for ${q}`, sources: [] }),
    });
    const loop = createLoop(sqlite, { template_id: 'monitor', prompt: 'q' });
    const template = makeMonitorTemplate('q', { cycles_target: 3, poll_every: 1 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(llm.searchCalls).toBe(3);
  });
});

describe('monitor template — diff renderer', () => {
  test('renderer assembles polls + diff descriptors', async () => {
    const sqlite = newDb();
    let n = 0;
    const llm = new FakeLLMProvider({
      searchWeb: () => {
        n++;
        // Cycle 0 returns short text, cycle 2 returns longer text (a change).
        const text = n === 1 ? 'short' : 'a much longer poll result with more content';
        return { text, sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }] };
      },
    });
    const loop = createLoop(sqlite, { template_id: 'monitor', prompt: 'watch' });
    const template = makeMonitorTemplate('watch', { cycles_target: 4, poll_every: 2 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const state = readState(sqlite, loop.id);
    const report = (await template.renderer(state)).output;

    expect(report.kind).toBe('monitor_report');
    expect(report.total_polls).toBe(2);
    expect(report.polls[0].text).toBe('short');
    expect(report.polls[1].text).toBe('a much longer poll result with more content');
    expect(report.diffs).toHaveLength(1);
    expect(report.diffs[0].changed).toBe(true);
    expect(report.diffs[0].summary).toMatch(/5 -> 43 chars/);
  });

  test('unchanged poll reports changed=false', async () => {
    const sqlite = newDb();
    const llm = new FakeLLMProvider({
      searchWeb: () => ({ text: 'identical text', sources: [] }),
    });
    const loop = createLoop(sqlite, { template_id: 'monitor', prompt: 'watch' });
    const template = makeMonitorTemplate('watch', { cycles_target: 4, poll_every: 2 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const state = readState(sqlite, loop.id);
    const report = (await template.renderer(state)).output;

    expect(report.diffs[0].changed).toBe(false);
    expect(report.diffs[0].summary).toMatch(/unchanged/);
  });
});

describe('monitor template — registry dispatch', () => {
  test('buildTemplate("monitor") requires deps.llm', () => {
    expect(() => buildTemplate('monitor', 'q', {}, {})).toThrow(/requires deps.llm/);
  });

  test('buildTemplate("monitor") with deps.llm returns a Template', () => {
    const llm = new FakeLLMProvider({});
    const t = buildTemplate('monitor', 'q', { cycles_target: 2, poll_every: 1 }, { llm });
    expect(t).not.toBeNull();
    expect(t!.id).toBe('monitor');
  });
});
