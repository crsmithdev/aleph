import type { Sqlite } from '@construct/data';
import type { HookHandler, HookResult, PostMortemThreadState, PostMortemSourceHealth } from './types.js';
import { runHooks, firstResult } from './registry.js';
import { getQuery } from '../services/queries.js';
import { computeSourceHealth, computeThreadStateMetrics } from '../services/metrics.js';
import { recordPostMortem } from '../services/post-mortems.js';

export interface PostMortemHandlerOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'deepseek/deepseek-chat';
const VERDICTS = ['pass', 'flag'] as const;
type Verdict = typeof VERDICTS[number];

const SYSTEM_INSTRUCTIONS = `You are the post-run reviewer for an autonomous research system. A job just finished. Look at the original prompt, the final summary, and the run telemetry. Decide whether the run looks healthy or whether it has anomalies worth flagging.

Return ONLY JSON matching this schema:

{
  "verdict": "pass" | "flag",
  "flags": ["short_tag_1", ...],   // e.g. "thread_skew", "high_error_rate", "low_finding_yield", "runaway_cost", "off_topic_drift"
  "notes": "1-3 sentences summarizing what you observed",
  "recommendations": ["short actionable suggestion 1", ...]  // omit the key or use [] if verdict is pass
}

Rules:
- "pass" when the run looks roughly proportionate to the ask and telemetry shows no obvious anomalies.
- "flag" when something is off — e.g. one thread dominates work, source failure rate is high, almost no findings despite many steps, cost seems disproportionate to depth, etc.
- Keep flags short and tagged — downstream UI filters on them.
- Recommendations should be actionable on a future run (tune a parameter, rewrite the prompt, adjust source mix). Omit empty filler.
- Be calibrated: don't flag every run. If it looks normal, say pass.`;

export function createPostMortemHandler(opts: PostMortemHandlerOptions): HookHandler<'post_mortem'> {
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return async (payload) => {
    const userContent = buildUserContent(payload);
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
        max_tokens: 600,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      throw new Error(`post_mortem LLM call failed: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    return parseResponse(raw);
  };
}

function buildUserContent(payload: import('./types.js').HookPayload<'post_mortem'>): string {
  const hintLines = Object.entries(payload.hints)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `  ${k}: ${v}`);
  const hintBlock = hintLines.length > 0 ? `\nHints:\n${hintLines.join('\n')}` : '';

  const interp = payload.interpretation;
  const interpBlock = interp ? `\nInterpretation at dispatch:
  intent: ${interp.intent}
  shape: ${interp.shape}, depth: ${interp.depth}, scope: ${interp.scope}` : '';

  const m = payload.metrics;
  const durMin = (m.duration_ms / 60_000).toFixed(1);
  const metricsBlock = `\nFinal metrics:
  duration: ${durMin}m
  findings: ${m.findings}
  threads: ${m.threads_total} total, ${m.threads_active} still active
  steps: ${m.steps} (${m.errors} errors)
  cost: $${m.cost_usd.toFixed(4)}`;

  const ts = payload.thread_state;
  const byStatus = Object.entries(ts.by_status).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)';
  const threadBlock = `\nThread breakdown: ${byStatus}
  stuck: ${ts.stuck_count}, pruned: ${ts.pruned_count}`;

  const sh = payload.source_health;
  const failDomains = sh.top_failing_domains.length > 0
    ? sh.top_failing_domains.map(d => `${d.domain}×${d.count}`).join(', ')
    : '(none)';
  const sourceBlock = `\nSource health:
  failure rate: ${(sh.failure_rate * 100).toFixed(1)}% of ${sh.total_attempts} attempts
  top failing: ${failDomains}`;

  const findingBlock = payload.sample_findings.length > 0
    ? `\nSample findings:\n${payload.sample_findings.map(s => `  - ${s}`).join('\n')}`
    : '';

  const summaryBlock = payload.final_summary
    ? `\nFinal summary:\n${payload.final_summary.slice(0, 1500)}`
    : '';

  return `Original prompt:\n${payload.prompt}${hintBlock}${interpBlock}${metricsBlock}${threadBlock}${sourceBlock}${findingBlock}${summaryBlock}`;
}

function parseResponse(raw: string): HookResult<'post_mortem'> | null {
  let obj: Record<string, unknown>;
  try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }

  const verdict = typeof obj.verdict === 'string' && VERDICTS.includes(obj.verdict as Verdict)
    ? obj.verdict as Verdict
    : null;
  if (!verdict) return null;

  const notes = typeof obj.notes === 'string' ? obj.notes : '';
  const flags = Array.isArray(obj.flags) ? obj.flags.filter(x => typeof x === 'string') as string[] : [];
  const recommendations = Array.isArray(obj.recommendations)
    ? obj.recommendations.filter(x => typeof x === 'string') as string[]
    : [];

  return { verdict, flags, notes, recommendations };
}

// Build a post_mortem payload from current DB state. Uses the metrics
// aggregators from services/metrics so the snapshot matches what the UI
// Telemetry tab shows.
export function buildPostMortemPayload(
  sqlite: Sqlite,
  sessionId: string,
  jobId: string | null,
  durationMs: number,
): import('./types.js').HookPayload<'post_mortem'> | null {
  const session = getQuery(sqlite, sessionId);
  if (!session) return null;

  const findings = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_findings WHERE session_id = ?').get(sessionId) as { n: number }).n;
  const threadsActive = (sqlite.prepare("SELECT COUNT(*) AS n FROM research_threads WHERE session_id = ? AND status IN ('active','queued')").get(sessionId) as { n: number }).n;
  const threadsTotal = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_threads WHERE session_id = ?').get(sessionId) as { n: number }).n;
  const costRow = sqlite.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM research_steps WHERE session_id = ?').get(sessionId) as { c: number };
  const errors = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_steps WHERE session_id = ? AND error IS NOT NULL').get(sessionId) as { n: number }).n;
  const steps = (sqlite.prepare('SELECT COUNT(*) AS n FROM research_steps WHERE session_id = ?').get(sessionId) as { n: number }).n;

  const threadStateRaw = computeThreadStateMetrics(sqlite, { sessionId });
  const byStatusFlat: Record<string, number> = {};
  for (const [k, v] of Object.entries(threadStateRaw.by_status)) {
    byStatusFlat[k] = v.count;
  }
  const thread_state: PostMortemThreadState = {
    by_status: byStatusFlat,
    stuck_count: threadStateRaw.stuck_threads.length,
    pruned_count: byStatusFlat.pruned ?? 0,
  };

  const sourceHealthRaw = computeSourceHealth(sqlite, { sessionId });
  const total_attempts = sourceHealthRaw.by_status.extracted + sourceHealthRaw.by_status.failed;
  const source_health: PostMortemSourceHealth = {
    failure_rate: sourceHealthRaw.failure_rate,
    total_attempts,
    top_failing_domains: sourceHealthRaw.top_failing_domains.slice(0, 3).map(d => ({
      domain: d.domain,
      count: d.failed,
    })),
  };

  const findingRows = sqlite.prepare(
    'SELECT summary FROM research_findings WHERE session_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(sessionId) as Array<{ summary: string }>;

  return {
    query_id: sessionId,
    job_id: jobId,
    prompt: session.prompt,
    hints: session.prompt_hints,
    interpretation: session.interpretation,
    final_summary: session.summary,
    metrics: {
      findings,
      threads_active: threadsActive,
      threads_total: threadsTotal,
      cost_usd: costRow.c,
      errors,
      steps,
      duration_ms: durationMs,
    },
    thread_state,
    source_health,
    sample_findings: findingRows.map(r => r.summary).filter(Boolean),
  };
}

// End-to-end driver: build payload, run hook, persist record. Fire-and-
// forget safe. Swallows all errors.
export async function runPostMortem(
  sqlite: Sqlite,
  sessionId: string,
  jobId: string | null,
  durationMs: number,
): Promise<void> {
  try {
    const payload = buildPostMortemPayload(sqlite, sessionId, jobId, durationMs);
    if (!payload) return;

    const invocations = await runHooks('post_mortem', payload);
    const result = firstResult(invocations);
    if (!result) return;

    recordPostMortem(sqlite, {
      session_id: sessionId,
      job_id: jobId,
      verdict: result.verdict,
      flags: result.flags,
      notes: result.notes,
      recommendations: result.recommendations,
      metrics_snapshot: {
        metrics: payload.metrics,
        thread_state: payload.thread_state,
        source_health: payload.source_health,
      },
    });
  } catch (err) {
    console.warn('[post_mortem] failed:', err instanceof Error ? err.message : err);
  }
}
