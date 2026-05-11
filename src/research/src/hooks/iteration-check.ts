import type { Sqlite } from '@construct/data';
import type { HookHandler, HookResult, IterationCorrection } from './types.js';
import { runHooks, firstResult } from './registry.js';
import * as threads from '../services/threads.js';
import { recordIterationCheck, type AppliedAction } from '../services/iteration-checks.js';

export interface IterationCheckHandlerOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';
const VERDICTS = ['on_track', 'drifting', 'needs_correction'] as const;
type Verdict = typeof VERDICTS[number];

const SYSTEM_INSTRUCTIONS = `You are a mid-run reviewer for an autonomous research system. Given the original prompt and a snapshot of progress, decide whether the run is on-track, drifting, or needs correction.

Return ONLY JSON matching this schema:

{
  "verdict": "on_track" | "drifting" | "needs_correction",
  "notes": "one-to-three sentences on what you see",
  "correction": {  // omit entirely if verdict is on_track
    "kill_threads": ["thread_query_text_1", ...],  // queries that are off-topic or redundant; the dispatcher will match these to thread ids. Omit if none.
    "narrow_sources": ["domain1.com", ...],  // hints for source mix; omit if none.
    "scope_change": "short phrase describing a scope adjustment"  // omit if none. This will be shown to the user for confirmation.
  }
}

Rules:
- Be conservative on kill_threads — only kill threads whose query is clearly off-topic relative to the original prompt, or near-duplicates of another thread. Killing is auto-applied.
- scope_change is not auto-applied; it surfaces to the user. Only include it when the original prompt appears to have been misinterpreted.
- If everything looks reasonable, return verdict "on_track" with a one-sentence note. Do not fabricate corrections.`;

export function createIterationCheckHandler(opts: IterationCheckHandlerOptions): HookHandler<'iteration_check'> {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async (payload) => {
    const userContent = buildUserContent({
      prompt: payload.prompt,
      hints: payload.hints as Record<string, unknown>,
      iterations_completed: payload.iterations_completed,
      metrics: payload.metrics,
      recent_thread_queries: payload.recent_thread_queries,
      recent_finding_summaries: payload.recent_finding_summaries,
    });
    const resp = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTIONS },
          { role: 'user', content: userContent },
        ],
        max_tokens: 500,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      throw new Error(`iteration_check LLM call failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    return parseResponse(raw);
  };
}

function buildUserContent(payload: {
  prompt: string;
  hints: Record<string, unknown>;
  iterations_completed: number;
  metrics: { findings: number; threads_active: number; threads_total: number; cost_usd: number; errors: number; steps: number };
  recent_thread_queries: string[];
  recent_finding_summaries: string[];
}): string {
  const hintLines = Object.entries(payload.hints)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `  ${k}: ${v}`);
  const hintBlock = hintLines.length > 0 ? `\nHints:\n${hintLines.join('\n')}` : '';

  const m = payload.metrics;
  const metricsBlock = `\nMetrics after ${payload.iterations_completed} iterations:
  findings: ${m.findings}
  threads: ${m.threads_active} active / ${m.threads_total} total
  steps: ${m.steps} (${m.errors} errors)
  cost: $${m.cost_usd.toFixed(4)}`;

  const threadBlock = payload.recent_thread_queries.length > 0
    ? `\nRecent thread queries:\n${payload.recent_thread_queries.map(q => `  - ${q}`).join('\n')}`
    : '';

  const findingBlock = payload.recent_finding_summaries.length > 0
    ? `\nRecent finding summaries:\n${payload.recent_finding_summaries.map(s => `  - ${s}`).join('\n')}`
    : '';

  return `Original prompt:\n${payload.prompt}${hintBlock}${metricsBlock}${threadBlock}${findingBlock}`;
}

function parseResponse(raw: string): HookResult<'iteration_check'> | null {
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }

  const verdict = typeof obj.verdict === 'string' && VERDICTS.includes(obj.verdict as Verdict)
    ? obj.verdict as Verdict
    : null;
  const notes = typeof obj.notes === 'string' ? obj.notes : '';

  if (!verdict) return null;

  const result: HookResult<'iteration_check'> = { verdict, notes };

  if (obj.correction && typeof obj.correction === 'object' && !Array.isArray(obj.correction)) {
    const c = obj.correction as Record<string, unknown>;
    const correction: IterationCorrection = {};
    if (Array.isArray(c.kill_threads)) {
      correction.kill_threads = c.kill_threads.filter(x => typeof x === 'string') as string[];
    }
    if (Array.isArray(c.narrow_sources)) {
      correction.narrow_sources = c.narrow_sources.filter(x => typeof x === 'string') as string[];
    }
    if (typeof c.scope_change === 'string' && c.scope_change.trim()) {
      correction.scope_change = c.scope_change.trim();
    }
    if (Object.keys(correction).length > 0) result.correction = correction;
  }

  return result;
}

// Applies the correction to the DB. kill_threads is auto (threads marked
// 'pruned' with a reason); narrow_sources and scope_change are recorded only
// (the UI surfaces them and a user confirms before anything else happens).
// Returns the list of actions that were actually taken so the caller can
// persist them alongside the check record.
export function applyIterationCorrection(
  sqlite: Sqlite,
  sessionId: string,
  correction: IterationCorrection,
): AppliedAction[] {
  const actions: AppliedAction[] = [];

  if (correction.kill_threads && correction.kill_threads.length > 0) {
    const sessionThreads = threads.listThreads(sqlite, sessionId);
    for (const queryText of correction.kill_threads) {
      const match = sessionThreads.find(t =>
        normalize(t.query) === normalize(queryText) &&
        (t.status === 'queued' || t.status === 'active')
      );
      if (!match) {
        actions.push({ action: 'kill_thread', target: queryText, ok: false, error: 'no matching active or queued thread' });
        continue;
      }
      try {
        threads.updateThread(sqlite, match.id, { status: 'pruned' });
        actions.push({ action: 'kill_thread', target: match.id, detail: match.query, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        actions.push({ action: 'kill_thread', target: match.id, ok: false, error: msg });
      }
    }
  }

  if (correction.narrow_sources && correction.narrow_sources.length > 0) {
    actions.push({
      action: 'narrow_sources',
      detail: correction.narrow_sources.join(', '),
      ok: true,
    });
  }

  if (correction.scope_change) {
    actions.push({
      action: 'scope_change_proposed',
      detail: correction.scope_change,
      ok: true,
    });
  }

  return actions;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Build the iteration_check payload from current DB state. Queries a small
// number of recent threads/findings for LLM context.
export function buildIterationCheckPayload(
  sqlite: Sqlite,
  session: { id: string; prompt: string; prompt_hints: Record<string, unknown> },
  iterationsCompleted: number,
): {
  query_id: string;
  prompt: string;
  hints: Record<string, unknown>;
  iterations_completed: number;
  metrics: { findings: number; threads_active: number; threads_total: number; cost_usd: number; errors: number; steps: number };
  recent_thread_queries: string[];
  recent_finding_summaries: string[];
} {
  const findings = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_findings WHERE session_id = ?').get(session.id) as { n: number }).n;
  const threadsActive = (sqlite.prepare("SELECT COUNT(*) AS n FROM research_threads WHERE session_id = ? AND status IN ('active','queued')").get(session.id) as { n: number }).n;
  const threadsTotal = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_threads WHERE session_id = ?').get(session.id) as { n: number }).n;
  const costRow = sqlite.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM research_steps WHERE session_id = ?').get(session.id) as { c: number };
  const errors = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_steps WHERE session_id = ? AND error IS NOT NULL').get(session.id) as { n: number }).n;
  const steps = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_steps WHERE session_id = ?').get(session.id) as { n: number }).n;

  const threadRows = sqlite.prepare(
    'SELECT query FROM research_threads WHERE session_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(session.id) as Array<{ query: string }>;
  const findingRows = sqlite.prepare(
    'SELECT summary FROM research_findings WHERE session_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(session.id) as Array<{ summary: string }>;

  return {
    query_id: session.id,
    prompt: session.prompt,
    hints: session.prompt_hints,
    iterations_completed: iterationsCompleted,
    metrics: {
      findings,
      threads_active: threadsActive,
      threads_total: threadsTotal,
      cost_usd: costRow.c,
      errors,
      steps,
    },
    recent_thread_queries: threadRows.map(r => r.query),
    recent_finding_summaries: findingRows.map(r => r.summary).filter(Boolean),
  };
}

// End-to-end driver used by the worker loop. Builds payload, runs the hook,
// applies corrections, persists the check record. Safe to call in the
// background (fire-and-forget). Swallows all errors.
export async function runIterationCheck(
  sqlite: Sqlite,
  session: { id: string; prompt: string; prompt_hints: Record<string, unknown> },
  jobId: string | null,
  iterationsCompleted: number,
): Promise<void> {
  try {
    const payload = buildIterationCheckPayload(sqlite, session, iterationsCompleted);
    const invocations = await runHooks('iteration_check', payload);
    const result = firstResult(invocations);
    if (!result) return;

    const applied = result.correction
      ? applyIterationCorrection(sqlite, session.id, result.correction)
      : [];

    recordIterationCheck(sqlite, {
      session_id: session.id,
      job_id: jobId,
      iterations_completed: iterationsCompleted,
      verdict: result.verdict,
      notes: result.notes,
      correction: result.correction ?? null,
      applied_actions: applied,
    });
  } catch (err) {
    console.warn('[iteration_check] failed:', err instanceof Error ? err.message : err);
  }
}
