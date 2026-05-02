/**
 * TelemetryView — per-session observability panels surfaced from the metrics API.
 *
 * Panels:
 *   - Job lifecycle (queue wait / claim-to-start / duration percentiles)
 *   - Per-worker throughput and cost
 *   - Source extraction health (failure rate, reasons, domains)
 *   - Thread state-machine timings + stuck-thread list
 *   - Session cost trajectory (per-step cumulative cost)
 *
 * Each panel fetches via a dedicated hook so they refetch independently.
 */
import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import {
  useJobMetrics,
  useSourceHealth,
  useThreadStateMetrics,
  useSessionCostTrajectory,
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

function JobLifecyclePanel({ sessionId }: { sessionId: string }) {
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

// ---------------------------------------------------------------------------

function SourceHealthPanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useSourceHealth(sessionId);
  if (isLoading) return <Panel title="Source extraction health"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (isError || !data) return <Panel title="Source extraction health"><div className="text-text-muted italic">Failed to load metrics.</div></Panel>;
  if (data.total === 0) return <Panel title="Source extraction health"><div className="text-text-muted italic">No sources registered.</div></Panel>;

  const rate = (data.failure_rate * 100).toFixed(1);
  const rateColor = data.failure_rate > 0.25 ? 'text-danger' : data.failure_rate > 0.1 ? 'text-warning' : 'text-success';

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

function ThreadStatePanel({ sessionId, onNavigateToThread }: { sessionId: string; onNavigateToThread?: (id: string) => void }) {
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

      {data.stuck_threads.length > 0 && (
        <div>
          <div className="text-sm font-medium text-text-secondary mb-2">
            <span className="text-warning">⚠</span> Stuck threads ({data.stuck_threads.length})
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
                {data.stuck_threads.map(t => (
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
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function CostTrajectoryPanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useSessionCostTrajectory(sessionId);

  // Simple inline sparkline — no dep, no axes. 100 samples max.
  const sparkline = useMemo(() => {
    if (!data || data.series.length === 0) return null;
    const samples = data.series.length > 100
      ? data.series.filter((_, i) => i % Math.ceil(data.series.length / 100) === 0)
      : data.series;
    const max = samples[samples.length - 1].cumulative_cost_usd || 1;
    const w = 600, h = 80;
    const pts = samples.map((s, i) => {
      const x = (i / Math.max(1, samples.length - 1)) * w;
      const y = h - (s.cumulative_cost_usd / max) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return { pts, w, h, max };
  }, [data]);

  if (isLoading) return <Panel title="Cost trajectory"><div className="text-text-muted italic">Loading…</div></Panel>;
  if (isError || !data) return <Panel title="Cost trajectory"><div className="text-text-muted italic">Failed to load.</div></Panel>;
  if (data.total_steps === 0) return <Panel title="Cost trajectory"><div className="text-text-muted italic">No steps recorded yet.</div></Panel>;

  return (
    <Panel
      title="Cost trajectory"
      subtitle={`${data.total_steps} steps · ${data.total_tokens.toLocaleString()} tokens · ${formatUsd(data.total_cost_usd)}`}
    >
      {sparkline && (
        <div className="rounded-md border border-border-primary bg-bg-secondary p-3 mb-4">
          <svg width="100%" viewBox={`0 0 ${sparkline.w} ${sparkline.h}`} preserveAspectRatio="none" className="h-24">
            <polyline points={sparkline.pts} fill="none" stroke="currentColor" className="text-accent" strokeWidth="1.5" />
          </svg>
          <div className="flex justify-between text-xs text-text-muted tabular-nums mt-1">
            <span>$0</span><span>{formatUsd(sparkline.max)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium text-text-secondary mb-2">By model</div>
          <div className="rounded-md border border-border-primary overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium text-text-muted">model</th>
                  <th className="px-3 py-1.5 text-right font-medium text-text-muted">steps</th>
                  <th className="px-3 py-1.5 text-right font-medium text-text-muted">tokens</th>
                  <th className="px-3 py-1.5 text-right font-medium text-text-muted">cost</th>
                </tr>
              </thead>
              <tbody>
                {data.by_model.map(m => (
                  <tr key={m.model} className="border-t border-border-primary tabular-nums">
                    <td className="px-3 py-1.5 font-mono text-xs truncate max-w-[260px]" title={m.model}>{m.model}</td>
                    <td className="px-3 py-1.5 text-right">{m.steps}</td>
                    <td className="px-3 py-1.5 text-right">{m.tokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{formatUsd(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="text-sm font-medium text-text-secondary mb-2">By provider</div>
          <div className="rounded-md border border-border-primary overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium text-text-muted">provider</th>
                  <th className="px-3 py-1.5 text-right font-medium text-text-muted">steps</th>
                  <th className="px-3 py-1.5 text-right font-medium text-text-muted">cost</th>
                </tr>
              </thead>
              <tbody>
                {data.by_provider.map(p => (
                  <tr key={p.provider} className="border-t border-border-primary tabular-nums">
                    <td className="px-3 py-1.5 font-mono text-xs">{p.provider}</td>
                    <td className="px-3 py-1.5 text-right">{p.steps}</td>
                    <td className="px-3 py-1.5 text-right">{formatUsd(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function DecisionLogPanel({ sessionId }: { sessionId: string }) {
  const { data: steps, isLoading } = useResearchSteps(sessionId);
  const [keyFilter, setKeyFilter] = useState<string>('__all__');
  const [labelFilter, setLabelFilter] = useState<string>('__all__');

  // Steps with non-empty metadata — those are the decisions worth surfacing.
  const withMeta = useMemo(() => {
    if (!steps) return [];
    return steps.filter(s => s.metadata && Object.keys(s.metadata).length > 0);
  }, [steps]);

  // All metadata keys and labels, for the filter dropdowns.
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

/** Per-strategy perturbation outcomes. Surfaces the fruitfulness multiplier
 *  the engine's selector is currently applying so the user can answer "which
 *  strategies are working for me on this kind of question?" Empty until a
 *  perturbation has fired in this session. */
function PerturbationStrategiesPanel({ sessionId }: { sessionId: string }) {
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
              // Color the fruitfulness column so it's easy to scan: above 1.0
              // is a positive signal, below is a negative one. Neutral (~1.0)
              // stays muted.
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

export function TelemetryView({ sessionId, onNavigateToThread }: { sessionId: string; onNavigateToThread?: (id: string) => void }) {
  return (
    <div className="pb-10">
      <JobLifecyclePanel sessionId={sessionId} />
      <SourceHealthPanel sessionId={sessionId} />
      <ThreadStatePanel sessionId={sessionId} onNavigateToThread={onNavigateToThread} />
      <CostTrajectoryPanel sessionId={sessionId} />
      <PerturbationStrategiesPanel sessionId={sessionId} />
      <DecisionLogPanel sessionId={sessionId} />
    </div>
  );
}
