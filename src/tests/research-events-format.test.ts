#!/usr/bin/env bun
/**
 * Event-fidelity gate tests for the merged Activity tab event log.
 *
 * Asserts the six event-type categories (finding · thread · step · search ·
 * fetch · error) all surface a non-empty `formatEventDetail` result, and that
 * `categorizeEvent` routes each fixture into the right filter bucket.
 *
 * If any of these tests breaks the merged Activity view has lost event
 * fidelity — see docs/mockups/research-activity.html § implementation gate.
 */
import {
  formatEventDetail,
  categorizeEvent,
  type EventCategory,
} from '../ui/web/src/pages/research/research-events-format';
import { createResults, check, printAndExit } from '../eval/harness.ts';

const r = createResults();

function makeStep(overrides: Record<string, unknown> = {}): any {
  return {
    id: 's-1',
    thread_id: 't-1',
    session_id: 'sess-1',
    model: 'openrouter/anthropic/claude-3-haiku',
    prompt_tokens: 120,
    completion_tokens: 80,
    cost_usd: 0.0008,
    tool_calls: [],
    duration_ms: 1234,
    error: null,
    error_kind: null,
    label: 'gap analysis',
    metadata: { decision: 'gap_analysis', has_gaps: true, gap_count: 3 },
    created_at: '2025-05-02T12:34:56.000Z',
    ...overrides,
  };
}

function makeFinding(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'f-1',
    thread_id: 't-1',
    session_id: 'sess-1',
    content: 'Goa trance crystallized at parties on Anjuna Beach (1991-93).',
    summary: 'Goa trance crystallized at parties on Anjuna Beach (1991-93).',
    source_urls: ['https://example.com/goa'],
    source_texts: [],
    source_url_meta: [{ url: 'https://example.com/goa', title: 'Goa', snippet: '' }],
    tags: ['music'],
    confidence: 0.84,
    novelty: 0.7,
    actionability: 0.5,
    user_rating: null,
    kind: 'normal',
    follow_ups: [],
    created_at: '2025-05-02T12:34:56.000Z',
    ...overrides,
  };
}

function makeThread(overrides: Record<string, unknown> = {}): any {
  return {
    id: 't-1',
    session_id: 'sess-1',
    parent_thread_id: null,
    query: 'Berlin techno scene 1989-1994',
    short_query: 'Berlin techno 1989-94',
    origin: 'seed',
    perturbation_strategy: null,
    status: 'active',
    priority: 0.62,
    depth: 0,
    max_depth: 5,
    min_searches: null,
    fetch_source_text: null,
    retry_after: null,
    created_at: '2025-05-02T12:34:56.000Z',
    updated_at: '2025-05-02T12:34:56.000Z',
    ...overrides,
  };
}

console.log('--- event-fidelity: every category renders ---');

// Build one fixture per category. categorizeEvent must place it in the
// right bucket, and formatEventDetail must produce a non-empty label
// (and detail where applicable).

type Fix = { name: string; cat: EventCategory; ev: any; expectLabel?: string };
const fixtures: Fix[] = [
  {
    name: 'finding',
    cat: 'finding',
    ev: { type: 'finding', payload: makeFinding() },
    expectLabel: 'finding',
  },
  {
    name: 'thread (start)',
    cat: 'thread',
    ev: { type: 'thread', payload: makeThread({ status: 'active' }) },
    expectLabel: 'start',
  },
  {
    name: 'step (label-only, gap analysis)',
    cat: 'step',
    ev: { type: 'step', payload: makeStep() },
    expectLabel: 'gap-analysis',
  },
  {
    name: 'search (web_search tool call)',
    cat: 'search',
    ev: {
      type: 'step',
      payload: makeStep({
        label: 'web search',
        metadata: null,
        tool_calls: [{ tool: 'web_search', input: { query: 'early goa trance Anjuna 1991' } }],
      }),
    },
    expectLabel: 'search',
  },
  {
    name: 'fetch (fetch_url tool call)',
    cat: 'fetch',
    ev: {
      type: 'step',
      payload: makeStep({
        label: 'fetch_url',
        metadata: null,
        tool_calls: [{
          tool: 'fetch_url',
          input: { url: 'https://residentadvisor.net/features/3344' },
          jina_fetches: [{ url: 'https://residentadvisor.net/features/3344', ok: true, content_length: 1234 }],
        }],
      }),
    },
    expectLabel: 'fetch',
  },
  {
    name: 'error (step with error field)',
    cat: 'error',
    ev: {
      type: 'step',
      payload: makeStep({
        label: 'web search (failed)',
        error: 'fetch_url substack.com/p/dance-1991 — 403 challenge',
        metadata: null,
        tool_calls: [],
      }),
    },
  },
];

for (const f of fixtures) {
  const cat = categorizeEvent(f.ev);
  check(r, `categorizeEvent: ${f.name} → ${f.cat}`, cat === f.cat);

  const formatted = formatEventDetail(f.ev);
  check(r, `formatEventDetail: ${f.name} returns non-null`, formatted !== null);
  if (formatted) {
    check(r, `formatEventDetail: ${f.name} has non-empty typeLabel`, !!formatted.typeLabel);
    if (f.expectLabel) {
      check(r, `formatEventDetail: ${f.name} typeLabel matches "${f.expectLabel}"`, formatted.typeLabel === f.expectLabel);
    }
  }
}

console.log('\n--- event-fidelity: thread-diff transitions surface ---');

// Past refactors lost the threadDiff status/priority/backoff/retry transitions.
// Verify each is rendered into a recognisable typeLabel/detail.
const transitions: Array<{ name: string; ev: any; expectLabel: string }> = [
  {
    name: 'paused → active resume',
    ev: { type: 'thread', payload: makeThread({ status: 'active' }), threadDiff: 'paused → active' },
    expectLabel: 'resume',
  },
  {
    name: 'titled (short_query newly assigned)',
    ev: { type: 'thread', payload: makeThread({ status: 'active', short_query: 'Berlin techno' }), threadDiff: 'titled' },
    expectLabel: 'named',
  },
  {
    // A priority change on an active thread surfaces as a 'start' label
    // (the active-status branch wins), but the priority diff itself is
    // captured in the threadDiff field that drives the expanded row.
    name: 'priority change on active thread',
    ev: { type: 'thread', payload: makeThread({ status: 'active' }), threadDiff: 'priority 0.45 → 0.62' },
    expectLabel: 'start',
  },
  {
    name: 'backoff',
    ev: { type: 'thread', payload: makeThread({ status: 'active' }), threadDiff: 'backoff' },
    expectLabel: 'update',
  },
  {
    name: 'retry',
    ev: { type: 'thread', payload: makeThread({ status: 'active' }), threadDiff: 'retry' },
    expectLabel: 'update',
  },
  {
    name: 'pruned status',
    ev: { type: 'thread', payload: makeThread({ status: 'pruned' }) },
    expectLabel: 'prune',
  },
];

for (const t of transitions) {
  const formatted = formatEventDetail(t.ev);
  check(r, `thread-diff: ${t.name} → typeLabel "${t.expectLabel}"`, formatted?.typeLabel === t.expectLabel);
  check(r, `thread-diff: ${t.name} → detail non-empty`, !!formatted?.detail);
}

console.log('\n--- event-fidelity: per-finding chips encode confidence + novelty ---');

const findingF = formatEventDetail({ type: 'finding', payload: makeFinding({ confidence: 0.84, novelty: 0.7 }) } as any);
check(r, 'finding has confidence chip', findingF?.chips?.some(c => c.text.includes('confidence')) ?? false);
check(r, 'finding has novelty chip', findingF?.chips?.some(c => c.text.includes('novelty')) ?? false);

console.log('\n--- event-fidelity: search step exposes the query string ---');

const searchF = formatEventDetail({
  type: 'step',
  payload: makeStep({
    label: 'web search',
    metadata: null,
    tool_calls: [{ tool: 'web_search', input: { query: 'Frankfurt techno 1990 Dorian Gray' } }],
  }),
} as any);
check(r, 'search step detail includes query', !!searchF?.detail.includes('Frankfurt techno 1990 Dorian Gray'));

printAndExit(r);
