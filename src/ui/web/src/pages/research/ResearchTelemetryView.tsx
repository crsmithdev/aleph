/**
 * TelemetryView — per-session observability panels surfaced from the metrics API.
 *
 * Panel exports:
 *   - JobLifecyclePanel — stat-table + per-worker breakdown (used by old standalone view)
 *   - JobLifecycleCompactPanel — single 4×4 table per the Activity-tab mockup
 *   - SourceHealthPanel — failure-rate cards + top failing domains + recent failures
 *   - ThreadStatePanel — 6-tile per-status grid (legacy)
 *   - ThreadStateCompactPanel — stackbar + one-line counts + stuck list (Activity tab)
 *   - DecisionLogPanel — filterable list of steps with metadata
 *   - PerturbationStrategiesPanel — per-strategy outcomes
 *
 * Each panel fetches via a dedicated hook so they refetch independently.
 */
import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  useJobMetrics,
  useSourceHealth,
  useThreadStateMetrics,
  useResearchSteps,
  usePerturbationStats,
  type DurationStats,
  type ResearchStep,
} from '../../api/research-hooks';

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function DurationPill({ label, stats }: { label: string; stats: DurationStats | null }) {
  return (
    <div className="rounded-md border border-border-primary bg-bg-secondary p-3">
      <div className="text-xs uppercase tracking-wider text-text-muted mb-1.5">{label}</div>
      {stats ? (
        <div className="space-y-0.5 text-sm tabular-nums">
          <div className="flex justify-between"><span className="text-text-muted">p50</span><span>{formatMs(stats.p50)}</span></div>
          <div className="flex justify-between"><span className="text-text-muted">p95</span><span>{formatMs(stats.p95)}</span></div>
          <div className="flex justify-between"><span className="text-text-muted">max</span><span>{formatMs(stats.max)}</span></div>
          <div className="flex justify-between text-xs text-text-muted pt-1 border-t border-border-primary mt-1.5">
            <span>avg</span><span>{formatMs(stats.avg)} · n={stats.count}</span>
          </div>
        </div>
      ) : (
        <div className="text-sm text-text-muted italic">no data</div>
      )}
    </div>
  );
}

function Panel({ title, children, subtitle }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="font-heading text-lg font-semibold text-text-primary">{title}</h2>
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

export function JobLifecyclePanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useJobMetrics(sessionId);
  if (isLoading) return <Panel title="Job lifecycle"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (isError || !data) return <Panel title="Job lifecycle"><div className="text-text-muted italic">Failed to load metrics.</div></Panel>;
  if (data.total === 0) return <Panel title="Job lifecycle"><div className="text-text-muted italic">No jobs recorded yet.</div></Panel>;

  return (
    <Panel
      title="Job lifecycle"
      subtitle={`${data.total} jobs · ${Object.entries(data.by_status).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(' · ')}`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <DurationPill label="Queue wait (created → claimed)" stats={data.queue_wait_ms} />
        <DurationPill label="Supervisor lag (claimed → started)" stats={data.claim_to_start_ms} />
        <DurationPill label="Run duration (started → completed)" stats={data.duration_ms} />
        <DurationPill label="End-to-end" stats={data.total_ms} />
      </div>

      {data.by_worker.length > 0 && (
        <div>
          <div className="text-sm font-medium text-text-secondary mb-2">Per-worker</div>
          <div className="overflow-x-auto rounded-md border border-border-primary">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-text-muted">worker</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">total</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">completed</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">failed</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">running</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">avg dur</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">steps</th>
                  <th className="px-3 py-2 text-right font-medium text-text-muted">cost</th>
                </tr>
              </thead>
              <tbody>
                {data.by_worker.map(w => (
                  <tr key={w.worker_id} className="border-t border-border-primary tabular-nums">
                    <td className="px-3 py-2 font-mono text-xs">{w.worker_id}</td>
                    <td className="px-3 py-2 text-right">{w.total}</td>
                    <td className="px-3 py-2 text-right text-success">{w.completed}</td>
                    <td className="px-3 py-2 text-right">{w.failed > 0 ? <span className="text-danger">{w.failed}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{w.running > 0 ? <span className="text-accent">{w.running}</span> : '—'}</td>
                    <td className="px-3 py-2 text-right">{formatMs(w.avg_duration_ms)}</td>
                    <td className="px-3 py-2 text-right">{w.steps}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(w.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Compact 4×4 lifecycle table per the Activity-tab mockup. One row per stage,
 *  columns are p50/p95/max/avg/n. Per-worker breakdown collapses to one
 *  semi-colon-separated line under the table. */
export function JobLifecycleCompactPanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useJobMetrics(sessionId);

  const headerSub = data && data.total > 0
    ? `${data.total} jobs · ${Object.entries(data.by_status).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(' · ')}`
    : undefined;

  return (
    <div className="rounded-md border border-border-primary bg-bg-secondary">
      <div className="flex items-baseline gap-3 px-3.5 py-2.5 border-b border-border-primary">
        <h4 className="text-sm font-semibold text-text-primary">Job lifecycle</h4>
        {headerSub && <span className="text-xs text-text-muted">{headerSub}</span>}
      </div>
      {isLoading && <div className="p-3.5 text-sm text-text-muted italic">Loading…</div>}
      {!isLoading && (isError || !data) && <div className="p-3.5 text-sm text-text-muted italic">Failed to load metrics.</div>}
      {!isLoading && data && data.total === 0 && <div className="p-3.5 text-sm text-text-muted italic">No jobs recorded yet.</div>}
      {!isLoading && data && data.total > 0 && (() => {
        const rows: Array<{ label: string; sub: string; stats: DurationStats | null }> = [
          { label: 'queue wait', sub: 'created → claimed', stats: data.queue_wait_ms },
          { label: 'supervisor lag', sub: 'claimed → started', stats: data.claim_to_start_ms },
          { label: 'run duration', sub: 'started → completed', stats: data.duration_ms },
          { label: 'end-to-end', sub: '', stats: data.total_ms },
        ];
        return (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary text-text-muted">
                  <th className="text-left font-mono text-xs uppercase tracking-wider px-3 py-1.5">Stage</th>
                  <th className="text-right font-mono text-xs uppercase tracking-wider px-3 py-1.5">p50</th>
                  <th className="text-right font-mono text-xs uppercase tracking-wider px-3 py-1.5">p95</th>
                  <th className="text-right font-mono text-xs uppercase tracking-wider px-3 py-1.5">max</th>
                  <th className="text-right font-mono text-xs uppercase tracking-wider px-3 py-1.5">avg</th>
                  <th className="text-right font-mono text-xs uppercase tracking-wider px-3 py-1.5">n</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} className="border-t border-border-primary tabular-nums">
                    <td className="px-3 py-1.5 font-medium text-text-primary">
                      {r.label}{r.sub && <span className="text-text-muted text-xs ml-1.5">{r.sub}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.stats ? formatMs(r.stats.p50) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{r.stats ? formatMs(r.stats.p95) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{r.stats ? formatMs(r.stats.max) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">{r.stats ? formatMs(r.stats.avg) : '—'}</td>
                    <td className="px-3 py-1.5 text-right text-text-muted">{r.stats ? r.stats.count : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.by_worker.length > 0 && (
              <div className="border-t border-border-primary px-3.5 py-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-text-muted">By worker:</span>
                {data.by_worker.map(w => (
                  <span key={w.worker_id} className="text-text-secondary tabular-nums">
                    <span className="font-mono">{w.worker_id}</span>{' '}
                    {w.total} · <span className="text-success">{w.completed}✓</span>
                    {w.failed > 0 && <> · <span className="text-error">{w.failed}✗</span></>}
                    {' '}· {formatMs(w.avg_duration_ms)} avg · {formatUsd(w.cost_usd)}
                  </span>
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SourceHealthPanel({ sessionId, compact = false }: { sessionId: string; compact?: boolean }) {
  const { data, isLoading, isError } = useSourceHealth(sessionId);
  if (isLoading) return <Panel title="Source extraction health"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (isError || !data) return <Panel title="Source extraction health"><div className="text-text-muted italic">Failed to load metrics.</div></Panel>;
  if (data.total === 0) return <Panel title="Source extraction health"><div className="text-text-muted italic">No sources registered.</div></Panel>;

  const rate = (data.failure_rate * 100).toFixed(1);
  const rateColor = data.failure_rate > 0.25 ? 'text-danger' : data.failure_rate > 0.1 ? 'text-warning' : 'text-success';

  // Compact two-column variant for the Activity tab.
  if (compact) {
    return (
      <div className="rounded-md border border-border-primary bg-bg-secondary">
        <div className="flex items-baseline gap-3 px-3.5 py-2.5 border-b border-border-primary">
          <h4 className="text-sm font-semibold text-text-primary">Source extraction</h4>
          <span className="text-xs text-text-muted">{data.total} sources · {rate}% failure</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-xs text-text-muted">Failure rate</span>
              <span className={clsx('font-semibold tabular-nums text-xl', rateColor)}>{rate}%</span>
            </div>
            <div className="flex justify-between text-sm py-0.5"><span className="text-text-muted">Avg attempts on failure</span><span className="tabular-nums">{data.avg_attempts_on_failure != null ? data.avg_attempts_on_failure.toFixed(1) : '—'}</span></div>
            <div className="flex justify-between text-sm py-0.5"><span className="text-text-muted">Extracted</span><span className="tabular-nums text-success">{data.by_status.extracted ?? 0}</span></div>
            <div className="flex justify-between text-sm py-0.5"><span className="text-text-muted">Failed</span><span className="tabular-nums text-danger">{data.by_status.failed ?? 0}</span></div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-mono text-text-muted mb-2">Top failing domains</div>
            {data.top_failing_domains.length === 0 && <div className="text-sm text-text-muted italic">none</div>}
            {data.top_failing_domains.map(d => (
              <div key={d.domain} className="flex justify-between text-sm py-0.5">
                <span className="font-mono truncate">{d.domain}</span>
                <span className="tabular-nums shrink-0 ml-2">
                  <span className={d.rate > 0.5 ? 'text-error' : 'text-warning'}>{d.failed}</span> / {d.total} ({(d.rate * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Panel
      title="Source extraction health"
      subtitle={`${data.total} sources · ${Object.entries(data.by_status).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(' · ')}`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-md border border-border-primary bg-bg-secondary p-3">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-1.5">Failure rate</div>
          <div className={clsx('text-2xl font-semibold tabular-nums', rateColor)}>{rate}%</div>
          <div className="text-xs text-text-muted mt-1">of attempted extractions</div>
        </div>
        <div className="rounded-md border border-border-primary bg-bg-secondary p-3">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-1.5">Avg attempts on failure</div>
          <div className="text-2xl font-semibold tabular-nums">
            {data.avg_attempts_on_failure != null ? data.avg_attempts_on_failure.toFixed(1) : '—'}
          </div>
        </div>
        <div className="rounded-md border border-border-primary bg-bg-secondary p-3">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-1.5">Extracted</div>
          <div className="text-2xl font-semibold tabular-nums text-success">{data.by_status.extracted ?? 0}</div>
        </div>
        <div className="rounded-md border border-border-primary bg-bg-secondary p-3">
          <div className="text-xs uppercase tracking-wider text-text-muted mb-1.5">Failed</div>
          <div className="text-2xl font-semibold tabular-nums text-danger">{data.by_status.failed ?? 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.top_failure_reasons.length > 0 && (
          <div>
            <div className="text-sm font-medium text-text-secondary mb-2">Top failure reasons</div>
            <div className="rounded-md border border-border-primary overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {data.top_failure_reasons.map(r => (
                    <tr key={r.reason} className="border-t border-border-primary first:border-t-0">
                      <td className="px-3 py-1.5 font-mono text-xs">{r.reason}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums w-12">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data.top_failing_domains.length > 0 && (
          <div>
            <div className="text-sm font-medium text-text-secondary mb-2">Top failing domains</div>
            <div className="rounded-md border border-border-primary overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium text-text-muted">domain</th>
                    <th className="px-3 py-1.5 text-right font-medium text-text-muted">fail</th>
                    <th className="px-3 py-1.5 text-right font-medium text-text-muted">total</th>
                    <th className="px-3 py-1.5 text-right font-medium text-text-muted">rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_failing_domains.map(d => (
                    <tr key={d.domain} className="border-t border-border-primary tabular-nums">
                      <td className="px-3 py-1.5 font-mono text-xs truncate max-w-[240px]" title={d.domain}>{d.domain}</td>
                      <td className="px-3 py-1.5 text-right text-danger">{d.failed}</td>
                      <td className="px-3 py-1.5 text-right">{d.total}</td>
                      <td className="px-3 py-1.5 text-right">{(d.rate * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {data.recent_failures.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-medium text-text-secondary mb-2">Recent failures</div>
          <div className="rounded-md border border-border-primary overflow-hidden">
            <ul className="divide-y divide-border-primary text-sm">
              {data.recent_failures.slice(0, 10).map(f => (
                <li key={f.id} className="px-3 py-2">
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent hover:underline truncate block">
                    {f.url}
                  </a>
                  {f.error && <div className="text-xs text-text-muted mt-1 line-clamp-2">{f.error}</div>}
                  <div className="text-xs text-text-muted tabular-nums mt-1">{f.attempt_count} attempts · {f.updated_at.slice(11, 19)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function ThreadStatePanel({ sessionId, onNavigateToThread }: { sessionId: string; onNavigateToThread?: (id: string) => void }) {
  const { data, isLoading, isError } = useThreadStateMetrics(sessionId, { stuckThresholdMs: 5 * 60_000 });
  if (isLoading) return <Panel title="Thread state"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (isError || !data) return <Panel title="Thread state"><div className="text-text-muted italic">Failed to load metrics.</div></Panel>;

  const entries = Object.entries(data.by_status).filter(([, v]) => v.count > 0);
  if (entries.length === 0) return <Panel title="Thread state"><div className="text-text-muted italic">No threads.</div></Panel>;

  return (
    <Panel
      title="Thread state"
      subtitle={`${data.transitions_observed} threads · stuck threshold 5m`}
    >
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        {entries.map(([status, v]) => (
          <div key={status} className="rounded-md border border-border-primary bg-bg-secondary p-3">
            <div className="text-xs uppercase tracking-wider text-text-muted">{status}</div>
            <div className="text-xl font-semibold tabular-nums">{v.count}</div>
            {v.time_in_state_ms && (
              <div className="text-xs text-text-muted tabular-nums mt-1">
                since: p50 {formatMs(v.time_in_state_ms.p50)} · p95 {formatMs(v.time_in_state_ms.p95)}
              </div>
            )}
          </div>
        ))}
      </div>

      {data.stuck_threads.length > 0 && <StuckThreadsTable stuck={data.stuck_threads} onNavigateToThread={onNavigateToThread} />}
    </Panel>
  );
}

function StuckThreadsTable({
  stuck, onNavigateToThread,
}: {
  stuck: Array<{ id: string; query: string; short_query: string | null; status: string; stuck_for_ms: number }>;
  onNavigateToThread?: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-text-secondary mb-2">
        <span className="text-warning">⚠</span> Stuck threads ({stuck.length})
      </div>
      <div className="rounded-md border border-border-primary overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-text-muted">thread</th>
              <th className="px-3 py-2 text-left font-medium text-text-muted">status</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted">stuck for</th>
            </tr>
          </thead>
          <tbody>
            {stuck.map(t => (
              <tr key={t.id} className="border-t border-border-primary">
                <td className="px-3 py-2">
                  {onNavigateToThread ? (
                    <button
                      onClick={() => onNavigateToThread(t.id)}
                      className="text-left hover:underline text-accent truncate block max-w-[420px]"
                    >
                      {t.short_query ?? t.query.slice(0, 80)}
                    </button>
                  ) : (
                    <span className="truncate block max-w-[420px]">{t.short_query ?? t.query.slice(0, 80)}</span>
                  )}
                  <span className="text-xs text-text-muted font-mono">{t.id.slice(0, 8)}</span>
                </td>
                <td className="px-3 py-2">{t.status}</td>
                <td className="px-3 py-2 text-right tabular-nums text-warning">{formatMs(t.stuck_for_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Compact thread-state panel: stackbar + one-line counts + full-size stuck list.
 *  Replaces the 6-tile grid for the Activity tab. */
export function ThreadStateCompactPanel({ sessionId, onNavigateToThread }: { sessionId: string; onNavigateToThread?: (id: string) => void }) {
  const { data, isLoading, isError } = useThreadStateMetrics(sessionId, { stuckThresholdMs: 5 * 60_000 });

  if (isLoading) {
    return <CompactPanel title="Thread state"><div className="text-sm text-text-muted italic">Loading…</div></CompactPanel>;
  }
  if (isError || !data) {
    return <CompactPanel title="Thread state"><div className="text-sm text-text-muted italic">Failed to load metrics.</div></CompactPanel>;
  }

  const total = data.transitions_observed;
  const counts = {
    active: data.by_status.active?.count ?? 0,
    queued: data.by_status.queued?.count ?? 0,
    exhausted: data.by_status.exhausted?.count ?? 0,
    pruned: data.by_status.pruned?.count ?? 0,
    deferred: data.by_status.deferred?.count ?? 0,
  };
  const stuckCount = data.stuck_threads.length;
  const denom = Math.max(1, counts.active + counts.queued + counts.exhausted + counts.pruned + counts.deferred);
  const pct = (n: number) => `${(n / denom) * 100}%`;

  return (
    <CompactPanel title="Thread state" subtitle={`${total} threads · stuck threshold 5m`}>
      <div className="flex h-2 rounded overflow-hidden bg-bg-tertiary mb-2">
        <span style={{ width: pct(counts.active) }} className="bg-success" />
        <span style={{ width: pct(counts.queued) }} className="bg-warning" />
        <span style={{ width: pct(counts.exhausted) }} className="bg-text-disabled" />
        <span style={{ width: pct(counts.pruned) }} className="bg-error" />
        <span style={{ width: pct(counts.deferred) }} className="bg-text-muted/40" />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm tabular-nums">
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-success mr-1.5 align-middle" /><strong>{counts.active}</strong> <span className="text-text-muted">active</span></span>
        <span className="text-text-muted">·</span>
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-warning mr-1.5 align-middle" /><strong>{counts.queued}</strong> <span className="text-text-muted">queued</span></span>
        <span className="text-text-muted">·</span>
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-text-disabled mr-1.5 align-middle" /><strong>{counts.exhausted}</strong> <span className="text-text-muted">exhausted</span></span>
        <span className="text-text-muted">·</span>
        <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-error mr-1.5 align-middle" /><strong>{counts.pruned}</strong> <span className="text-text-muted">pruned</span></span>
        <span className="text-text-muted">·</span>
        <span><strong>{counts.deferred}</strong> <span className="text-text-muted">deferred</span></span>
        {stuckCount > 0 && (
          <span className="ml-auto text-warning">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning mr-1.5 align-middle" />{stuckCount} stuck
          </span>
        )}
      </div>
      {data.stuck_threads.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border-primary">
          <StuckThreadsTable stuck={data.stuck_threads} onNavigateToThread={onNavigateToThread} />
        </div>
      )}
    </CompactPanel>
  );
}

/** Lightweight panel container used by the compact Activity-tab variants. */
function CompactPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-primary bg-bg-secondary">
      <div className="flex items-baseline gap-3 px-3.5 py-2.5 border-b border-border-primary">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DecisionLogPanel({ sessionId }: { sessionId: string }) {
  const { data: steps, isLoading } = useResearchSteps(sessionId);
  const [keyFilter, setKeyFilter] = useState<string>('__all__');
  const [labelFilter, setLabelFilter] = useState<string>('__all__');

  const withMeta = useMemo(() => {
    if (!steps) return [];
    return steps.filter(s => s.metadata && Object.keys(s.metadata).length > 0);
  }, [steps]);

  const { allKeys, allLabels } = useMemo(() => {
    const keys = new Set<string>();
    const labels = new Set<string>();
    for (const s of withMeta) {
      if (s.label) labels.add(s.label);
      if (s.metadata) for (const k of Object.keys(s.metadata)) keys.add(k);
    }
    return { allKeys: [...keys].sort(), allLabels: [...labels].sort() };
  }, [withMeta]);

  const filtered = useMemo(() => {
    return withMeta.filter(s => {
      if (keyFilter !== '__all__' && !(s.metadata && keyFilter in s.metadata)) return false;
      if (labelFilter !== '__all__' && s.label !== labelFilter) return false;
      return true;
    });
  }, [withMeta, keyFilter, labelFilter]);

  if (isLoading) return <Panel title="Decision log"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (withMeta.length === 0) return <Panel title="Decision log"><div className="text-text-muted italic">No decisions recorded — steps emit metadata for dedup calls, perturbation choices, and accepted follow-ups once the engine runs.</div></Panel>;

  return (
    <Panel
      title="Decision log"
      subtitle={`${filtered.length}${filtered.length !== withMeta.length ? ` of ${withMeta.length}` : ''} step${filtered.length === 1 ? '' : 's'} with metadata`}
    >
      <div className="flex flex-wrap gap-3 mb-3 items-center text-sm">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">metadata key:</span>
          <select
            value={keyFilter}
            onChange={e => setKeyFilter(e.target.value)}
            className="bg-bg-secondary border border-border-primary rounded px-2 py-1 text-sm"
          >
            <option value="__all__">all</option>
            {allKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        {allLabels.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-text-muted">label:</span>
            <select
              value={labelFilter}
              onChange={e => setLabelFilter(e.target.value)}
              className="bg-bg-secondary border border-border-primary rounded px-2 py-1 text-sm"
            >
              <option value="__all__">all</option>
              {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
        {(keyFilter !== '__all__' || labelFilter !== '__all__') && (
          <button
            onClick={() => { setKeyFilter('__all__'); setLabelFilter('__all__'); }}
            className="text-text-muted hover:text-text-primary"
          >clear</button>
        )}
      </div>

      <ul className="space-y-2">
        {filtered.slice(0, 200).map(s => <DecisionRow key={s.id} step={s} highlightKey={keyFilter !== '__all__' ? keyFilter : null} />)}
      </ul>
      {filtered.length > 200 && (
        <div className="text-xs text-text-muted mt-3">Showing first 200 of {filtered.length}. Download the full NDJSON log for the complete list.</div>
      )}
    </Panel>
  );
}

function DecisionRow({ step, highlightKey }: { step: ResearchStep; highlightKey: string | null }) {
  const [open, setOpen] = useState(false);
  const time = step.created_at.slice(11, 23);
  const keys = step.metadata ? Object.keys(step.metadata) : [];
  const focusValue = highlightKey && step.metadata ? step.metadata[highlightKey] : undefined;

  return (
    <li className="rounded-md border border-border-primary bg-bg-secondary">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-bg-tertiary transition-colors"
      >
        <div className="flex items-center gap-3 text-sm min-w-0">
          <span className="font-mono text-xs text-text-muted tabular-nums">{time}</span>
          {step.label && <span className="font-medium">{step.label}</span>}
          <span className="text-xs text-text-muted font-mono truncate">{step.id.slice(0, 8)}</span>
          <div className="flex gap-1 flex-wrap">
            {keys.slice(0, 4).map(k => (
              <span
                key={k}
                className={clsx(
                  'text-xs px-1.5 py-0.5 rounded font-mono',
                  k === highlightKey ? 'bg-accent/20 text-accent' : 'bg-bg-primary text-text-muted'
                )}
              >{k}</span>
            ))}
            {keys.length > 4 && <span className="text-xs text-text-muted">+{keys.length - 4}</span>}
          </div>
        </div>
        <span className="text-text-muted text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {highlightKey && focusValue !== undefined && !open && (
        <div className="px-3 pb-2 text-xs text-text-muted">
          <span className="font-mono text-accent">{highlightKey}</span>: <span className="font-mono">{JSON.stringify(focusValue)}</span>
        </div>
      )}
      {open && step.metadata && (
        <pre className="px-3 py-2 text-xs font-mono bg-bg-primary border-t border-border-primary overflow-x-auto max-h-[400px]">
          {JSON.stringify(step.metadata, null, 2)}
        </pre>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------

/** Per-strategy perturbation outcomes. */
export function PerturbationStrategiesPanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = usePerturbationStats(sessionId);
  if (isLoading) return <Panel title="Perturbation strategies"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (isError) return <Panel title="Perturbation strategies"><div className="text-text-muted italic">Failed to load strategy outcomes.</div></Panel>;
  if (!data || data.length === 0) {
    return (
      <Panel title="Perturbation strategies" subtitle="Outcome history per strategy — populates after the first perturbation fires.">
        <div className="text-text-muted italic">No perturbations have fired yet.</div>
      </Panel>
    );
  }

  const totalAttempts = data.reduce((s, r) => s + r.attempts, 0);
  const totalSuccesses = data.reduce((s, r) => s + r.successes, 0);

  return (
    <Panel
      title="Perturbation strategies"
      subtitle={`${data.length} strategies tried · ${totalAttempts} attempts · ${totalSuccesses} produced findings`}
    >
      <div className="overflow-x-auto rounded-md border border-border-primary">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-text-muted">strategy</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted">attempts</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted">findings</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted">avg novelty</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted">avg confidence</th>
              <th className="px-3 py-2 text-right font-medium text-text-muted" title="Multiplier applied to this strategy's selection weight (0.7–1.3); higher = engine more likely to pick it next.">fruitfulness</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => {
              const f = r.fruitfulness;
              const fColor = f >= 1.05 ? 'text-success' : f <= 0.95 ? 'text-warning' : 'text-text-muted';
              return (
                <tr key={r.strategy} className="border-t border-border-primary tabular-nums">
                  <td className="px-3 py-2 font-mono text-xs">{r.strategy}</td>
                  <td className="px-3 py-2 text-right">{r.attempts}</td>
                  <td className="px-3 py-2 text-right">{r.successes > 0 ? <span className="text-success">{r.successes}</span> : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.successes > 0 ? `${(r.avg_novelty * 100).toFixed(0)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.successes > 0 ? `${(r.avg_confidence * 100).toFixed(0)}%` : '—'}</td>
                  <td className={`px-3 py-2 text-right font-medium ${fColor}`}>{f.toFixed(2)}×</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

/** Original whole-tab view — still rendered by anyone who imports `TelemetryView`.
 *  Now built from the same exported subcomponents the Activity tab composes. */
export function TelemetryView({ sessionId, onNavigateToThread }: { sessionId: string; onNavigateToThread?: (id: string) => void }) {
  return (
    <div className="pb-10">
      <JobLifecyclePanel sessionId={sessionId} />
      <SourceHealthPanel sessionId={sessionId} />
      <ThreadStatePanel sessionId={sessionId} onNavigateToThread={onNavigateToThread} />
      <PerturbationStrategiesPanel sessionId={sessionId} />
      <DecisionLogPanel sessionId={sessionId} />
    </div>
  );
}
