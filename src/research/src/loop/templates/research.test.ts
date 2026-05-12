/**
 * Research template tests — Phase 2.
 *
 * Drives `runLoop` with a FakeLLMProvider so the full engine + four-hook
 * contract runs in-memory, no network. The fake's per-prompt-shape dispatch
 * mirrors `src/ui/e2e/fake-llm-server.ts` but in-process — unit tests don't
 * need an HTTP server.
 *
 * Covers:
 *  - happy path: searchWeb + complete called per cycle, cycle_output artifacts
 *    accumulate, render artifact assembles findings + dedupes sources
 *  - query chaining: cycle N uses cycle (N-1)'s first follow-up
 *  - malformed derivation: bad JSON falls back to the previous query
 *  - registry dispatch: buildTemplate('research', ...) requires deps.llm
 *  - crash resume: the second runLoop on the same loop uses cached ledger
 *    entries — no extra LLM calls beyond the unfinished cycle
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../../ddl';
import { createArtifact, createLoop, listArtifacts, listCycles, readState } from '../db';
import { runLoop } from '../engine';
import { FakeLLMProvider } from '../llm';
import { makeResearchTemplate } from './research';
import { buildTemplate } from './registry';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

function makeDefaultFake() {
  return new FakeLLMProvider({
    searchWeb: (_model, query) => ({
      text: `Synthesized result for "${query}". Findings include foo, bar, baz.`,
      sources: [
        { url: `https://example.test/${encodeURIComponent(query)}/a`, title: `A about ${query}`, snippet: 'a' },
        { url: `https://example.test/${encodeURIComponent(query)}/b`, title: `B about ${query}`, snippet: 'b' },
      ],
    }),
    complete: (_model, prompt) => {
      // Encode the prompt's query into the next follow-ups so we can assert chaining.
      const m = prompt.match(/Most recent search query: (.+)/);
      const base = m ? m[1].trim() : 'fallback';
      return JSON.stringify([`${base}: deeper detail`, `${base}: alternative angle`]);
    },
  });
}

describe('research template — happy path', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('runs cycles_target cycles, calling searchWeb + complete per cycle', async () => {
    const llm = makeDefaultFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'how does a sourdough starter develop?' });
    const template = makeResearchTemplate('how does a sourdough starter develop?', { cycles_target: 3 }, { llm });

    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.status).toBe('completed');
    expect(result.reason).toBe('research_target_reached:3');
    expect(result.cycles_run).toBe(3);
    expect(llm.searchCalls).toBe(3);
    expect(llm.completeCalls).toBe(3);

    const cycles = listCycles(sqlite, loop.id);
    expect(cycles).toHaveLength(3);
    expect(cycles.every(c => c.status === 'finalized')).toBe(true);
  });

  test('cycle 0 searches the prompt; cycle N searches cycle (N-1)\'s first follow-up', async () => {
    const seenQueries: string[] = [];
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => {
        seenQueries.push(query);
        return { text: `result for "${query}"`, sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }] };
      },
      complete: (_model, prompt) => {
        const m = prompt.match(/Most recent search query: (.+)/);
        const base = m ? m[1].trim() : 'fb';
        return JSON.stringify([`${base} -> next`, `${base} -> alt`]);
      },
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin question' });
    const template = makeResearchTemplate('origin question', { cycles_target: 3 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(seenQueries).toEqual([
      'origin question',
      'origin question -> next',
      'origin question -> next -> next',
    ]);
  });

  test('render artifact at completion contains findings + deduped sources', async () => {
    // Two of the three searches return overlapping sources to test dedup.
    let n = 0;
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => {
        n++;
        const shared = { url: 'https://shared.test/x', title: 'shared', snippet: 's' };
        const unique = { url: `https://uniq.test/${n}`, title: `u${n}`, snippet: 's' };
        return { text: `text ${n} for ${query}`, sources: n === 2 ? [shared] : [shared, unique] };
      },
      complete: () => JSON.stringify(['next q', 'alt q']),
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const template = makeResearchTemplate('p', { cycles_target: 3 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    // Run a final render against the terminal state.
    const state = readState(sqlite, loop.id);
    const render = (await template.renderer(state)).output;

    expect(render.kind).toBe('render');
    expect(render.cycles_rendered).toBe(3);
    expect(render.findings).toHaveLength(3);
    expect(render.findings[0].cycle).toBe(0);
    // Dedup: shared.test/x is in cycles 1 and 2's sources but should appear once.
    const sharedCount = render.sources.filter(s => s.url === 'https://shared.test/x').length;
    expect(sharedCount).toBe(1);
    // Unique sources from cycles 1 and 3 also present (cycle 2 only returned the shared source).
    expect(render.sources.map(s => s.url).sort()).toEqual([
      'https://shared.test/x',
      'https://uniq.test/1',
      'https://uniq.test/3',
    ]);
  });

  test('malformed derivation response falls back to the prior query', async () => {
    const seenQueries: string[] = [];
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => {
        seenQueries.push(query);
        return { text: `t for ${query}`, sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }] };
      },
      complete: () => 'not json at all, just prose',
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'the original' });
    const template = makeResearchTemplate('the original', { cycles_target: 2 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    // Cycle 1 should re-use cycle 0's query because derivation couldn't propose a follow-up.
    expect(seenQueries).toEqual(['the original', 'the original']);

    // The loop still produces cycle_output artifacts; degradation doesn't crash.
    const outputs = listArtifacts(sqlite, loop.id, 'cycle_output');
    expect(outputs).toHaveLength(2);
  });
});

describe('research template — registry dispatch', () => {
  test('buildTemplate("research") requires deps.llm', () => {
    expect(() => buildTemplate('research', 'q', {}, {})).toThrow(/requires deps.llm/);
  });

  test('buildTemplate("research") with deps.llm returns a Template', () => {
    const llm = makeDefaultFake();
    const t = buildTemplate('research', 'q', { cycles_target: 2 }, { llm });
    expect(t).not.toBeNull();
    expect(t!.id).toBe('research');
  });

  test('buildTemplate("noop") still works without deps', () => {
    const t = buildTemplate('noop', 'q', {}, {});
    expect(t).not.toBeNull();
    expect(t!.id).toBe('noop');
  });
});

describe('research template — shape-gated stop_rule (Phase 3.2 table case)', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  function writeSchedule(loop_id: string, shape: { kind: string; [k: string]: unknown }) {
    createArtifact(sqlite, {
      loop_id,
      cycle_id: null,
      kind: 'schedule',
      payload: { output_shape: shape },
    });
  }

  function tableSearchFake() {
    return new FakeLLMProvider({
      searchWeb: (_model, query) => ({
        // Returns a complete Markdown table matching the HSV/HPV column spec.
        text: [
          `Comparison results for "${query}":`,
          '',
          '| transmission | symptoms | treatment | vaccine |',
          '|---|---|---|---|',
          '| Direct contact | Cold/genital sores | Antivirals | No |',
          '| Sexual transmission | Genital warts | Removal | Yes (Gardasil) |',
        ].join('\n'),
        sources: [{ url: 'https://example.test/t', title: 't', snippet: 's' }],
      }),
      complete: () => JSON.stringify(['next q', 'alt q']),
    });
  }

  function proseOnlyFake() {
    return new FakeLLMProvider({
      searchWeb: (_model, query) => ({
        text: `Just prose about "${query}". No table content whatsoever.`,
        sources: [{ url: 'https://example.test/p', title: 'p', snippet: 's' }],
      }),
      complete: () => JSON.stringify(['next q', 'alt q']),
    });
  }

  test('table shape + LLM produces table → loop completes at cycles_target', async () => {
    const llm = tableSearchFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'Compare HSV and HPV' });
    writeSchedule(loop.id, {
      kind: 'table',
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    });
    const template = makeResearchTemplate(
      'Compare HSV and HPV',
      { cycles_target: 2 },
      { llm },
    );
    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.status).toBe('completed');
    expect(result.reason).toBe('research_target_reached:2');
    expect(result.cycles_run).toBe(2);
    // The final render artifact records shape_satisfied=true.
    const state = readState(sqlite, loop.id);
    const render = (await template.renderer(state)).output;
    expect(render.shape_kind).toBe('table');
    expect(render.shape_satisfied).toBe(true);
    expect(render.shape_missing).toBeNull();
  });

  test('table shape + LLM produces only prose → loop runs to max_cycles with shape_unreachable', async () => {
    const llm = proseOnlyFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'Compare HSV and HPV' });
    writeSchedule(loop.id, {
      kind: 'table',
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    });
    // target=2, max_cycles=2*2=4. After 4 cycles without a table, give up.
    const template = makeResearchTemplate(
      'Compare HSV and HPV',
      { cycles_target: 2 },
      { llm },
    );
    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.status).toBe('completed');
    expect(result.reason).toBe('shape_unreachable:table:4');
    expect(result.cycles_run).toBe(4);

    const state = readState(sqlite, loop.id);
    const render = (await template.renderer(state)).output;
    expect(render.shape_satisfied).toBe(false);
    expect(render.shape_missing).toEqual({
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    });
  });

  test('prose shape (default fallback) → backwards-compatible with Phase 2 behavior', async () => {
    const llm = proseOnlyFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'how does sourdough develop?' });
    // No schedule artifact written — readShape falls back to prose, always satisfied.
    const template = makeResearchTemplate('how does sourdough develop?', { cycles_target: 2 }, { llm });
    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.status).toBe('completed');
    expect(result.reason).toBe('research_target_reached:2');
    expect(result.cycles_run).toBe(2);
  });

  test('explicit max_cycles override caps the escape hatch', async () => {
    const llm = proseOnlyFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    writeSchedule(loop.id, { kind: 'table', columns: ['a', 'b'] });
    // target=1 but max_cycles=3 — overrides the default 2*target=2.
    const template = makeResearchTemplate('p', { cycles_target: 1, max_cycles: 3 }, { llm });
    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.cycles_run).toBe(3);
    expect(result.reason).toBe('shape_unreachable:table:3');
  });
});

describe('research template — adaptive planner branches (Phase 4.2)', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  /**
   * Seed a schedule artifact directly. Mirrors what `ensureScheduleArtifact`
   * writes in production, but skips the LLM round-trip so the test pins the
   * exact `branches[]` we want pickQuery to consume.
   */
  function writeScheduleWithPlan(loop_id: string, branches: Array<{ id: string; query: string }>) {
    createArtifact(sqlite, {
      loop_id,
      cycle_id: null,
      kind: 'schedule',
      payload: {
        output_shape: { kind: 'prose' },
        plan: {
          canon: [],
          branches,
          per_branch_budget: 3,
          perturbation_weights: {},
          milestone_plan: [0.25, 0.5, 0.75, 1.0],
        },
      },
    });
  }

  function recordingFake() {
    const seenQueries: string[] = [];
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => {
        seenQueries.push(query);
        return { text: `result for "${query}"`, sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }] };
      },
      complete: () => JSON.stringify(['from-derivation-1', 'from-derivation-2']),
    });
    return { llm, seenQueries };
  }

  test('multi-branch plan: each cycle queries the matching branch, ignoring derivation follow-ups', async () => {
    const { llm, seenQueries } = recordingFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin prompt' });
    writeScheduleWithPlan(loop.id, [
      { id: 'b1', query: 'branch-1 query' },
      { id: 'b2', query: 'branch-2 query' },
      { id: 'b3', query: 'branch-3 query' },
    ]);
    const template = makeResearchTemplate('origin prompt', { cycles_target: 3 }, { llm });

    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    // Each cycle's processor called searchWeb with the branch.query verbatim.
    // The derivation follow-ups ('from-derivation-*') are ignored because the
    // planner owns thread topology when branches exist.
    expect(seenQueries).toEqual(['branch-1 query', 'branch-2 query', 'branch-3 query']);
  });

  test('exhausted branches: cycles past branches.length fall back to derivation follow-ups', async () => {
    const { llm, seenQueries } = recordingFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin prompt' });
    writeScheduleWithPlan(loop.id, [
      { id: 'b1', query: 'branch-1 query' },
    ]);
    const template = makeResearchTemplate('origin prompt', { cycles_target: 3 }, { llm });

    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    // Cycle 0: branch-1 query (planner). Cycles 1+2: derivation pickup —
    // the FakeLLM returns ['from-derivation-1', 'from-derivation-2'], so the
    // first follow-up wins.
    expect(seenQueries).toEqual([
      'branch-1 query',
      'from-derivation-1',
      'from-derivation-1',
    ]);
  });

  test('fallback plan (single branch on the prompt) reproduces Phase 2 behavior', async () => {
    const { llm, seenQueries } = recordingFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin prompt' });
    // What planLoop.fallbackPlan emits when the LLM call fails — a single
    // branch with the prompt verbatim. Loop should still chain via derivation
    // from cycle 1 onward.
    writeScheduleWithPlan(loop.id, [{ id: 'main', query: 'origin prompt' }]);
    const template = makeResearchTemplate('origin prompt', { cycles_target: 3 }, { llm });

    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(seenQueries).toEqual([
      'origin prompt',
      'from-derivation-1',
      'from-derivation-1',
    ]);
  });

  test('no schedule artifact at all: Phase 2 chaining behavior preserved', async () => {
    const { llm, seenQueries } = recordingFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin prompt' });
    // No writeScheduleWithPlan call — readScheduleFromArtifacts returns null,
    // pickQuery falls through to the Phase-2 pickup path.
    const template = makeResearchTemplate('origin prompt', { cycles_target: 3 }, { llm });

    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(seenQueries).toEqual([
      'origin prompt',
      'from-derivation-1',
      'from-derivation-1',
    ]);
  });

  test('stop_rule floors at branches.length: a 6-branch plan with cycles_target=3 runs all 6 branches', async () => {
    // Reproducer for the V8 dogfood failure: planner emitted 6 branches but
    // the API's default cycles_target=3 clipped the loop to 3 cycles, so the
    // predecessor-comparison and memory-management branches never ran. The
    // fix is in stop_rule: effective target = max(cycles_target, branchCount).
    const { llm, seenQueries } = recordingFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin prompt' });
    writeScheduleWithPlan(loop.id, [
      { id: 'b1', query: 'q1' },
      { id: 'b2', query: 'q2' },
      { id: 'b3', query: 'q3' },
      { id: 'b4', query: 'q4' },
      { id: 'b5', query: 'q5' },
      { id: 'b6', query: 'q6' },
    ]);
    const template = makeResearchTemplate('origin prompt', { cycles_target: 3 }, { llm });

    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    // Every branch ran.
    expect(seenQueries).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    expect(result.cycles_run).toBe(6);
    // Reason reflects the effective target, not the user-supplied 3.
    expect(result.reason).toBe('research_target_reached:6');
  });
});

describe('research template — crash resume via ledger', () => {
  test('a second runLoop on a completed loop is a no-op', async () => {
    const sqlite = newDb();
    const llm = makeDefaultFake();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'q' });
    const template = makeResearchTemplate('q', { cycles_target: 2 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);
    const callsAfterFirst = llm.searchCalls;

    // Second call should detect terminal status and exit fast — no new LLM calls.
    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);
    expect(result.cycles_run).toBe(0);
    expect(llm.searchCalls).toBe(callsAfterFirst);
  });
});

describe('research template — iteration_check hook (Activity tab)', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('milestone fires write a kind:"iteration_check" artifact with the LLM verdict', async () => {
    const checkPrompts: string[] = [];
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => ({
        text: `result for ${query}`,
        sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }],
      }),
      complete: (_model, prompt) => {
        // Iteration-check prompt asks for a verdict in JSON. Other complete
        // calls (derivation follow-ups) ask for a JSON array — we keep them
        // happy with `[]` so the loop doesn't die on derivation failure.
        if (prompt.includes('Decide whether the loop is on track')) {
          checkPrompts.push(prompt);
          return JSON.stringify({ verdict: 'drifting', notes: 'topic wandered into adjacent areas' });
        }
        return JSON.stringify(['fu-1', 'fu-2']);
      },
    });

    // cycles envelope=8 with cycles_target=100 forces milestones at 2/4/6 cycles
    // (25/50/75% of 8 = 2/4/6). Mirrors the engine.events.test.ts harness.
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin', envelope: { cycles: { count: 8 } } });
    const template = makeResearchTemplate('origin', { cycles_target: 100 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    // Three milestones (25/50/75) — three iteration_check artifacts.
    const checks = listArtifacts(sqlite, loop.id, 'iteration_check');
    expect(checks).toHaveLength(3);
    expect(checks.map(c => (c.payload as { at_envelope_pct: number }).at_envelope_pct))
      .toEqual([25, 50, 75]);
    expect(checks.every(c => (c.payload as { verdict: string }).verdict === 'drifting')).toBe(true);
    expect(checks.every(c => (c.payload as { notes: string }).notes === 'topic wandered into adjacent areas')).toBe(true);
    // Sanity: the LLM saw three iteration-check prompts.
    expect(checkPrompts).toHaveLength(3);
  });

  test('iteration_check LLM failure does NOT fail the loop — defaults verdict to on_track', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => ({
        text: `result for ${query}`,
        sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }],
      }),
      complete: (_model, prompt) => {
        if (prompt.includes('Decide whether the loop is on track')) {
          return 'not json at all, garbage prose';
        }
        return JSON.stringify(['fu-1', 'fu-2']);
      },
    });

    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'origin', envelope: { cycles: { count: 8 } } });
    const template = makeResearchTemplate('origin', { cycles_target: 100 }, { llm });
    const result = await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    expect(result.status).toBe('envelope_exhausted');
    // Three artifacts still written with the unparseable-fallback verdict.
    const checks = listArtifacts(sqlite, loop.id, 'iteration_check');
    expect(checks).toHaveLength(3);
    expect(checks.every(c => (c.payload as { verdict: string }).verdict === 'on_track')).toBe(true);
    expect(checks.every(c => (c.payload as { notes: string }).notes === '(LLM response unparseable)')).toBe(true);
  });
});

describe('research template — post_mortem hook (Activity tab)', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('postMortem returns a typed verdict; payload carries metrics snapshot', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: (_model, query) => ({
        text: `result for ${query}`,
        sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }],
      }),
      complete: (_model, prompt) => {
        if (prompt.includes('post-mortem verdict')) {
          return JSON.stringify({
            verdict: 'partial',
            flags: ['shallow_coverage'],
            recommendations: ['expand canon', 'add depth on topic Y'],
          });
        }
        return JSON.stringify(['fu-1', 'fu-2']);
      },
    });

    // Run the template's hooks directly — run.ts wires the post-mortem fire,
    // but the template-level contract is what we're testing here.
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const template = makeResearchTemplate('p', { cycles_target: 2 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const state = readState(sqlite, loop.id);
    const pm = await template.postMortem!(state);
    expect(pm.output.verdict).toBe('partial');
    expect(pm.output.flags).toEqual(['shallow_coverage']);
    expect(pm.output.recommendations).toEqual(['expand canon', 'add depth on topic Y']);
    expect(pm.output.metrics_snapshot.cycles_completed).toBe(2);
    expect(typeof pm.output.metrics_snapshot.envelope_consumed).toBe('object');
  });

  test('postMortem unparseable response falls back to partial verdict with llm_response_unparseable flag', async () => {
    const llm = new FakeLLMProvider({
      searchWeb: () => ({
        text: 'r', sources: [{ url: 'https://x.test/1', title: 't', snippet: 's' }],
      }),
      complete: (_m, prompt) => prompt.includes('post-mortem verdict') ? 'definitely not json' : JSON.stringify(['fu']),
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const template = makeResearchTemplate('p', { cycles_target: 1 }, { llm });
    await runLoop(sqlite, template as Parameters<typeof runLoop>[1], loop.id);

    const state = readState(sqlite, loop.id);
    const pm = await template.postMortem!(state);
    expect(pm.output.verdict).toBe('partial');
    expect(pm.output.flags).toEqual(['llm_response_unparseable']);
  });

  test('createArtifact("post_mortem") emits an artifact event so the panel can subscribe live', async () => {
    // The post-mortem fires from run.ts in production; here we exercise the
    // contract directly — calling createArtifact with kind:'post_mortem' must
    // emit on the bus exactly like every other artifact.
    const { onResearchEvent, clearResearchListeners } = await import('../../services/events');
    const events: Array<{ type: string; payload: unknown }> = [];
    const unsubscribe = onResearchEvent(e => { events.push({ type: e.type, payload: e.payload }); });
    try {
      const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
      createArtifact(sqlite, {
        loop_id: loop.id,
        cycle_id: null,
        kind: 'post_mortem',
        payload: { verdict: 'success', flags: [], recommendations: [], metrics_snapshot: {}, model: 'fake' },
      });
      const pmEvents = events.filter(e => e.type === 'artifact' && (e.payload as { kind: string }).kind === 'post_mortem');
      expect(pmEvents).toHaveLength(1);
    } finally {
      unsubscribe();
      clearResearchListeners();
    }
  });
});
