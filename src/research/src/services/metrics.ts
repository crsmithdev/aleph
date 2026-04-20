/**
 * Research metrics — aggregators over jobs/sources/threads/steps.
 *
 * These answer questions that were previously only visible in the exported
 * markdown activity log:
 *
 *   - How long do jobs sit queued? (queue_wait_ms)
 *   - How long between claim and start? (claim_to_start_ms = supervisor lag)
 *   - Which workers are throughput-bound vs. cost-bound?
 *   - What fraction of sources fail extraction? What domains fail most?
 *   - Which threads are stuck in a state for too long?
 *   - For a single job: full trace (claim→start→steps→complete) with cost.
 *
 * All functions are pure reads against the research DB. No caching here —
 * callers decide (the route layer can wrap these in the same TTL cache the
 * observability routes use).
 */

import type { Sqlite } from '@construct/data';
import type {
  JobStatus, SourceExtractionStatus, ThreadStatus,
  ResearchJob, Source, ResearchThread, ResearchStep,
} from '../types.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Percentile by nearest-rank. Returns null on empty input. */
function pct(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

interface DurationStats {
  p50: number;
  p95: number;
  avg: number;
  max: number;
  count: number;
}

function durationStats(values: number[]): DurationStats | null {
  const positive = values.filter(v => Number.isFinite(v) && v >= 0);
  if (positive.length === 0) return null;
  const sum = positive.reduce((a, b) => a + b, 0);
  return {
    p50: Math.round(pct(positive, 50)!),
    p95: Math.round(pct(positive, 95)!),
    avg: Math.round(sum / positive.length),
    max: Math.round(Math.max(...positive)),
    count: positive.length,
  };
}

/** Parse SQLite naive datetime or ISO string into epoch ms. Returns null on invalid. */
function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  // SQLite `datetime('now')` → "YYYY-MM-DD HH:MM:SS" in UTC. Make it ISO-parseable.
  const s = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const n = Date.parse(s);
  return Number.isNaN(n) ? null : n;
}

function diffMs(start: string | null, end: string | null): number | null {
  const a = ts(start);
  const b = ts(end);
  if (a === null || b === null) return null;
  return b - a;
}

/** Extract hostname from a URL, lowercased, without www prefix. */
function domainOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return '(invalid-url)';
  }
}

// ---------------------------------------------------------------------------
// Job metrics
// ---------------------------------------------------------------------------

export interface JobLifecycleMetrics {
  total: number;
  by_status: Record<JobStatus, number>;
  queue_wait_ms: DurationStats | null;      // created → claimed
  claim_to_start_ms: DurationStats | null;  // claimed → started
  duration_ms: DurationStats | null;        // started → completed
  total_ms: DurationStats | null;           // created → completed
  by_worker: Array<{
    worker_id: string;
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    running: number;
    avg_duration_ms: number | null;
    cost_usd: number;
    steps: number;
  }>;
  by_mode: Record<string, number>;
}

export function computeJobMetrics(
  sqlite: Sqlite,
  opts?: { sessionId?: string }
): JobLifecycleMetrics {
  const where = opts?.sessionId ? 'WHERE session_id = ?' : '';
  const params = opts?.sessionId ? [opts.sessionId] : [];

  const rows = sqlite.prepare(`SELECT * FROM research_jobs ${where}`).all(...params) as unknown as ResearchJob[];

  const byStatus: Record<JobStatus, number> = {
    pending: 0, claimed: 0, running: 0, completed: 0, failed: 0, cancelled: 0,
  };
  const byMode: Record<string, number> = {};
  const queueWait: number[] = [];
  const claimStart: number[] = [];
  const duration: number[] = [];
  const totalMs: number[] = [];
  const workerAgg = new Map<string, { total: number; completed: number; failed: number; cancelled: number; running: number; durations: number[] }>();

  for (const j of rows) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    byMode[j.mode] = (byMode[j.mode] ?? 0) + 1;

    const qw = diffMs(j.created_at, j.claimed_at);
    if (qw !== null) queueWait.push(qw);
    const cs = diffMs(j.claimed_at, j.started_at);
    if (cs !== null) claimStart.push(cs);
    const dur = diffMs(j.started_at, j.completed_at);
    if (dur !== null && j.status === 'completed') duration.push(dur);
    const tot = diffMs(j.created_at, j.completed_at);
    if (tot !== null) totalMs.push(tot);

    if (j.claimed_by) {
      let w = workerAgg.get(j.claimed_by);
      if (!w) {
        w = { total: 0, completed: 0, failed: 0, cancelled: 0, running: 0, durations: [] };
        workerAgg.set(j.claimed_by, w);
      }
      w.total++;
      if (j.status === 'completed') { w.completed++; if (dur !== null) w.durations.push(dur); }
      else if (j.status === 'failed') w.failed++;
      else if (j.status === 'cancelled') w.cancelled++;
      else if (j.status === 'running' || j.status === 'claimed') w.running++;
    }
  }

  // Per-worker cost via steps join. Two cases:
  //
  //   1. Thread-level job (thread_id IS NOT NULL)
  //      → direct join on thread_id.
  //
  //   2. Session-level job (thread_id IS NULL)
  //      → attribute every step in the session that was created between
  //        claimed_at and completed_at. `datetime()` normalizes both formats
  //        (SQLite naive `YYYY-MM-DD HH:MM:SS` from jobs vs ISO
  //        `YYYY-MM-DDTHH:MM:SS.mmmZ` from steps) so the BETWEEN works.
  //
  // We run the two halves separately and union them — simpler than a giant
  // OR in a single join and keeps the query planner's life easy.
  const costByWorker = new Map<string, { cost: number; steps: number }>();
  const acc = (worker: string, cost: number, steps: number) => {
    const cur = costByWorker.get(worker) ?? { cost: 0, steps: 0 };
    cur.cost += cost; cur.steps += steps;
    costByWorker.set(worker, cur);
  };

  const sessionFilter = opts?.sessionId ? 'AND j.session_id = ?' : '';

  // Thread-level attribution
  const threadRows = sqlite.prepare(`
    SELECT j.claimed_by AS worker, SUM(s.cost_usd) AS cost, COUNT(s.id) AS steps
    FROM research_jobs j
    JOIN research_steps s ON s.thread_id = j.thread_id
    WHERE j.claimed_by IS NOT NULL AND j.thread_id IS NOT NULL ${sessionFilter}
    GROUP BY j.claimed_by
  `).all(...params) as Array<{ worker: string; cost: number; steps: number }>;
  for (const r of threadRows) acc(r.worker, Number(r.cost ?? 0), Number(r.steps ?? 0));

  // Session-level attribution
  const sessionRows = sqlite.prepare(`
    SELECT j.claimed_by AS worker, SUM(s.cost_usd) AS cost, COUNT(s.id) AS steps
    FROM research_jobs j
    JOIN research_steps s
      ON j.thread_id IS NULL
      AND s.session_id = j.session_id
      AND datetime(s.created_at) >= datetime(j.claimed_at)
      AND datetime(s.created_at) <= COALESCE(datetime(j.completed_at), datetime('now'))
    WHERE j.claimed_by IS NOT NULL AND j.thread_id IS NULL ${sessionFilter}
    GROUP BY j.claimed_by
  `).all(...params) as Array<{ worker: string; cost: number; steps: number }>;
  for (const r of sessionRows) acc(r.worker, Number(r.cost ?? 0), Number(r.steps ?? 0));

  const by_worker = [...workerAgg.entries()].map(([id, w]) => {
    const ds = durationStats(w.durations);
    const cost = costByWorker.get(id);
    return {
      worker_id: id,
      total: w.total,
      completed: w.completed,
      failed: w.failed,
      cancelled: w.cancelled,
      running: w.running,
      avg_duration_ms: ds?.avg ?? null,
      cost_usd: cost?.cost ?? 0,
      steps: cost?.steps ?? 0,
    };
  }).sort((a, b) => b.total - a.total);

  return {
    total: rows.length,
    by_status: byStatus,
    queue_wait_ms: durationStats(queueWait),
    claim_to_start_ms: durationStats(claimStart),
    duration_ms: durationStats(duration),
    total_ms: durationStats(totalMs),
    by_worker,
    by_mode: byMode,
  };
}

// ---------------------------------------------------------------------------
// Source extraction health
// ---------------------------------------------------------------------------

export interface SourceHealthMetrics {
  total: number;
  by_status: Record<SourceExtractionStatus, number>;
  failure_rate: number;                  // failed / (extracted + failed) — ignores pending/skipped
  avg_attempts_on_failure: number | null;
  top_failure_reasons: Array<{ reason: string; count: number; sample_url: string }>;
  top_failing_domains: Array<{ domain: string; failed: number; total: number; rate: number }>;
  recent_failures: Array<Pick<Source, 'id' | 'url' | 'error' | 'attempt_count' | 'updated_at'>>;
}

/** Categorize an error message into a coarse reason bucket for aggregation. */
function classifyError(err: string | null): string {
  if (!err) return '(no error)';
  const e = err.toLowerCase();
  if (/timeout|timed out|etimedout/.test(e)) return 'timeout';
  if (/ecconnrefused|econnreset|connection (refused|reset)/.test(e)) return 'connection';
  if (/dns|enotfound|eai_again/.test(e)) return 'dns';
  if (/4\d\d|forbidden|unauthorized|not found|bad request/.test(e)) return 'http-4xx';
  if (/5\d\d|internal server|bad gateway|service unavailable/.test(e)) return 'http-5xx';
  if (/javascript|render|js-heavy|blocked/.test(e)) return 'javascript-required';
  if (/robots|disallowed/.test(e)) return 'robots-disallowed';
  if (/exceeded.*attempts/.test(e)) return 'max-attempts';
  if (/parse|malformed|invalid html/.test(e)) return 'parse-error';
  return 'other';
}

export function computeSourceHealth(
  sqlite: Sqlite,
  opts?: { sessionId?: string; limit?: number }
): SourceHealthMetrics {
  const where = opts?.sessionId ? 'WHERE session_id = ?' : '';
  const params = opts?.sessionId ? [opts.sessionId] : [];

  const rows = sqlite.prepare(`SELECT * FROM research_sources ${where}`).all(...params) as Array<Source>;

  const byStatus: Record<SourceExtractionStatus, number> = {
    pending: 0, extracted: 0, failed: 0, skipped: 0,
  };
  const reasonCounts = new Map<string, { count: number; sample_url: string }>();
  const domainCounts = new Map<string, { failed: number; total: number }>();
  const failures: Source[] = [];
  const failedAttempts: number[] = [];

  for (const r of rows) {
    byStatus[r.extraction_status] = (byStatus[r.extraction_status] ?? 0) + 1;

    const d = domainOf(r.url);
    const bucket = domainCounts.get(d) ?? { failed: 0, total: 0 };
    bucket.total++;
    if (r.extraction_status === 'failed') {
      bucket.failed++;
      const reason = classifyError(r.error);
      const cur = reasonCounts.get(reason);
      if (cur) cur.count++;
      else reasonCounts.set(reason, { count: 1, sample_url: r.url });
      failures.push(r);
      failedAttempts.push(r.attempt_count);
    }
    domainCounts.set(d, bucket);
  }

  const denom = byStatus.extracted + byStatus.failed;
  const failure_rate = denom === 0 ? 0 : byStatus.failed / denom;
  const avg_attempts_on_failure = failedAttempts.length === 0
    ? null
    : failedAttempts.reduce((a, b) => a + b, 0) / failedAttempts.length;

  const top_failure_reasons = [...reasonCounts.entries()]
    .map(([reason, v]) => ({ reason, count: v.count, sample_url: v.sample_url }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const top_failing_domains = [...domainCounts.entries()]
    .filter(([, v]) => v.failed > 0)
    .map(([domain, v]) => ({ domain, failed: v.failed, total: v.total, rate: v.failed / v.total }))
    .sort((a, b) => b.failed - a.failed || b.rate - a.rate)
    .slice(0, 15);

  const recent_failures = failures
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, opts?.limit ?? 25)
    .map(f => ({ id: f.id, url: f.url, error: f.error, attempt_count: f.attempt_count, updated_at: f.updated_at }));

  return {
    total: rows.length,
    by_status: byStatus,
    failure_rate,
    avg_attempts_on_failure,
    top_failure_reasons,
    top_failing_domains,
    recent_failures,
  };
}

// ---------------------------------------------------------------------------
// Thread state-machine timing + stuck detection
// ---------------------------------------------------------------------------

export interface ThreadStateMetrics {
  by_status: Record<ThreadStatus, { count: number; time_in_state_ms: DurationStats | null }>;
  stuck_threads: Array<{
    id: string;
    short_query: string | null;
    query: string;
    status: ThreadStatus;
    updated_at: string;
    stuck_for_ms: number;
  }>;
  transitions_observed: number;   // total thread events in the log
}

/** Compute per-status time distribution for threads in a session.
 *  Uses only the current state (status + updated_at vs now) — accurate enough
 *  for "how long has this thread been idle" questions without reading the log. */
export function computeThreadStateMetrics(
  sqlite: Sqlite,
  opts: { sessionId: string; stuckThresholdMs?: number }
): ThreadStateMetrics {
  const stuckMs = opts.stuckThresholdMs ?? 5 * 60 * 1000;

  const rows = sqlite.prepare(
    'SELECT id, short_query, query, status, updated_at FROM research_threads WHERE session_id = ?'
  ).all(opts.sessionId) as Array<{ id: string; short_query: string | null; query: string; status: ThreadStatus; updated_at: string }>;

  const now = Date.now();
  const byStatus: Record<ThreadStatus, { count: number; time_in_state_ms: DurationStats | null }> = {
    queued: { count: 0, time_in_state_ms: null },
    active: { count: 0, time_in_state_ms: null },
    paused: { count: 0, time_in_state_ms: null },
    exhausted: { count: 0, time_in_state_ms: null },
    pruned: { count: 0, time_in_state_ms: null },
    deferred: { count: 0, time_in_state_ms: null },
  };

  const bucketSamples = new Map<ThreadStatus, number[]>();
  const stuck: ThreadStateMetrics['stuck_threads'] = [];

  for (const r of rows) {
    const entry = byStatus[r.status];
    if (entry) entry.count++;

    const t = ts(r.updated_at);
    if (t !== null) {
      const elapsed = now - t;
      if (!bucketSamples.has(r.status)) bucketSamples.set(r.status, []);
      bucketSamples.get(r.status)!.push(elapsed);

      // Stuck detection only applies to states that should progress.
      if ((r.status === 'active' || r.status === 'queued') && elapsed >= stuckMs) {
        stuck.push({
          id: r.id,
          short_query: r.short_query,
          query: r.query,
          status: r.status,
          updated_at: r.updated_at,
          stuck_for_ms: elapsed,
        });
      }
    }
  }

  for (const [status, samples] of bucketSamples.entries()) {
    byStatus[status].time_in_state_ms = durationStats(samples);
  }

  stuck.sort((a, b) => b.stuck_for_ms - a.stuck_for_ms);

  return {
    by_status: byStatus,
    stuck_threads: stuck,
    transitions_observed: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Job-level trace (claimed → started → steps → completed)
// ---------------------------------------------------------------------------

export interface JobTracePhase {
  name: 'created' | 'claimed' | 'started' | 'completed';
  at: string;
  offset_ms: number;
}

export interface JobTraceStep {
  id: string;
  thread_id: string;
  label: string | null;
  model: string;
  provider: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
  offset_ms: number;
  error: string | null;
}

export interface JobTrace {
  job: ResearchJob;
  thread: ResearchThread | null;
  phases: JobTracePhase[];
  steps: JobTraceStep[];
  total_cost_usd: number;
  total_tokens: number;
  total_duration_ms: number | null;
}

export function computeJobTrace(sqlite: Sqlite, jobId: string): JobTrace | null {
  const job = sqlite.prepare('SELECT * FROM research_jobs WHERE id = ?').get(jobId) as unknown as ResearchJob | undefined;
  if (!job) return null;

  const thread = job.thread_id
    ? sqlite.prepare('SELECT * FROM research_threads WHERE id = ?').get(job.thread_id) as unknown as ResearchThread | null
    : null;

  const origin = ts(job.created_at)!;

  const phases: JobTracePhase[] = [
    { name: 'created',   at: job.created_at, offset_ms: 0 },
  ];
  if (job.claimed_at)   phases.push({ name: 'claimed',   at: job.claimed_at,   offset_ms: (ts(job.claimed_at)!   - origin) });
  if (job.started_at)   phases.push({ name: 'started',   at: job.started_at,   offset_ms: (ts(job.started_at)!   - origin) });
  if (job.completed_at) phases.push({ name: 'completed', at: job.completed_at, offset_ms: (ts(job.completed_at)! - origin) });

  // Steps belonging to this job — per-thread jobs: steps on that thread between claimed/completed.
  // Session-level jobs (thread_id IS NULL): steps in the session during job window.
  const startMs = ts(job.claimed_at) ?? origin;
  const endMs = ts(job.completed_at) ?? Date.now();

  let steps: ResearchStep[];
  if (job.thread_id) {
    steps = sqlite.prepare(`
      SELECT * FROM research_steps
      WHERE thread_id = ? AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
    `).all(job.thread_id, new Date(startMs).toISOString(), new Date(endMs).toISOString()) as unknown as ResearchStep[];
  } else {
    steps = sqlite.prepare(`
      SELECT * FROM research_steps
      WHERE session_id = ? AND created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
    `).all(job.session_id, new Date(startMs).toISOString(), new Date(endMs).toISOString()) as unknown as ResearchStep[];
  }

  const traceSteps: JobTraceStep[] = steps.map(s => ({
    id: s.id,
    thread_id: s.thread_id,
    label: s.label ?? null,
    model: s.model,
    provider: s.provider ?? null,
    prompt_tokens: s.prompt_tokens,
    completion_tokens: s.completion_tokens,
    cost_usd: s.cost_usd,
    duration_ms: s.duration_ms,
    created_at: s.created_at,
    offset_ms: Math.max(0, (ts(s.created_at) ?? origin) - origin),
    error: s.error ?? null,
  }));

  const total_cost_usd = traceSteps.reduce((a, s) => a + (s.cost_usd || 0), 0);
  const total_tokens = traceSteps.reduce((a, s) => a + (s.prompt_tokens || 0) + (s.completion_tokens || 0), 0);
  const total_duration_ms = diffMs(job.started_at, job.completed_at);

  return {
    job,
    thread,
    phases,
    steps: traceSteps,
    total_cost_usd,
    total_tokens,
    total_duration_ms,
  };
}

// ---------------------------------------------------------------------------
// Session cost trajectory (per-step cumulative for a session)
// ---------------------------------------------------------------------------

export interface SessionCostTrajectory {
  total_cost_usd: number;
  total_tokens: number;
  total_steps: number;
  by_model: Array<{ model: string; cost: number; steps: number; tokens: number }>;
  by_provider: Array<{ provider: string; cost: number; steps: number }>;
  series: Array<{ at: string; cumulative_cost_usd: number; cumulative_tokens: number; step_id: string; model: string }>;
}

export function computeSessionCostTrajectory(sqlite: Sqlite, sessionId: string): SessionCostTrajectory {
  const steps = sqlite.prepare(
    'SELECT id, model, provider, cost_usd, prompt_tokens, completion_tokens, created_at FROM research_steps WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as Array<{ id: string; model: string; provider: string | null; cost_usd: number; prompt_tokens: number; completion_tokens: number; created_at: string }>;

  const byModel = new Map<string, { cost: number; steps: number; tokens: number }>();
  const byProvider = new Map<string, { cost: number; steps: number }>();

  let cumulativeCost = 0;
  let cumulativeTokens = 0;
  const series: SessionCostTrajectory['series'] = [];

  for (const s of steps) {
    const tokens = (s.prompt_tokens || 0) + (s.completion_tokens || 0);
    cumulativeCost += s.cost_usd || 0;
    cumulativeTokens += tokens;

    const m = byModel.get(s.model) ?? { cost: 0, steps: 0, tokens: 0 };
    m.cost += s.cost_usd || 0; m.steps++; m.tokens += tokens;
    byModel.set(s.model, m);

    const provider = s.provider ?? '(unknown)';
    const p = byProvider.get(provider) ?? { cost: 0, steps: 0 };
    p.cost += s.cost_usd || 0; p.steps++;
    byProvider.set(provider, p);

    series.push({
      at: s.created_at,
      cumulative_cost_usd: cumulativeCost,
      cumulative_tokens: cumulativeTokens,
      step_id: s.id,
      model: s.model,
    });
  }

  return {
    total_cost_usd: cumulativeCost,
    total_tokens: cumulativeTokens,
    total_steps: steps.length,
    by_model: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.cost - a.cost),
    by_provider: [...byProvider.entries()].map(([provider, v]) => ({ provider, ...v })).sort((a, b) => b.cost - a.cost),
    series,
  };
}
