import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useObsHooks, useObsHookEvents, type HookGatingStat } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle, type DatasetDisplayMode } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, CHART_OTHER, chartColor, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { fmtNumber, fmtMs, fmtPct, dateTime, shortRelativeTime, fmtLegendLabel } from '../../../utils/format';
import { clsx } from 'clsx';

type HookRow = {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
  lastUsed?: string;
  active: boolean;
  successRate: number;
  blocking?: boolean;
  gate?: string;
  markerFile?: string;
  description?: string;
  group?: string;
};

type InvocationRow = {
  timestamp: string;
  sessionId: string;
  event: string;
  hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }>;
};

type HookDataset = 'by-hook' | 'by-event' | 'latency' | 'errors';

const HOOK_DATASETS: { key: HookDataset; label: string }[] = [
  { key: 'by-hook', label: 'By Hook' },
  { key: 'by-event', label: 'By Event' },
  { key: 'latency', label: 'Latency' },
  { key: 'errors', label: 'Errors' },
];

import { GRAN_LABEL, fmtCalls } from '../../../utils/chart-helpers';

function GatingSection({ gating }: { gating: Record<string, HookGatingStat> }) {
  const hooks = Object.entries(gating);
  if (hooks.length === 0) return null;

  const totalDecisions = hooks.reduce((s, [, g]) => s + g.total, 0);
  const totalBlocks = hooks.reduce((s, [, g]) => s + g.blocks, 0);
  const totalAdvisories = hooks.reduce((s, [, g]) => s + g.advisories, 0);
  const totalIgnored = hooks.reduce((s, [, g]) => s + g.ignoredAdvisories, 0);
  const totalRepeated = hooks.reduce((s, [, g]) => s + g.repeatedBlocks, 0);
  const overallBlockRate = totalDecisions > 0 ? (totalBlocks / totalDecisions) * 100 : 0;
  const advisoryCompliance = totalAdvisories > 0 ? (1 - totalIgnored / totalAdvisories) * 100 : 100;

  // Stacked bar data: blocks/advisories/passes per hook
  const chartData = hooks.map(([name, g]) => ({
    name: name.replace(/^quality-|^isolation-|^git-|^routing-|^context-|^security-/, '').replace(/-/g, ' '),
    blocks: g.blocks,
    advisories: g.advisories,
    passes: g.passes,
  }));

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-medium text-text-secondary">Gating Effectiveness</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Gate Decisions" value={fmtNumber(totalDecisions)} />
        <StatCard
          label="Block Rate"
          value={totalDecisions > 0 ? fmtPct(overallBlockRate) : '—'}
          accent={overallBlockRate > 20 ? 'error' : overallBlockRate > 5 ? 'warning' : 'success'}
        />
        <StatCard
          label="Advisory Compliance"
          value={totalAdvisories > 0 ? fmtPct(advisoryCompliance) : '—'}
          accent={advisoryCompliance >= 90 ? 'success' : advisoryCompliance >= 70 ? 'warning' : 'error'}
        />
        <StatCard
          label="Repeated Blocks"
          value={fmtNumber(totalRepeated)}
          accent={totalRepeated === 0 ? 'success' : totalRepeated < 3 ? 'warning' : 'error'}
        />
      </div>

      {/* Per-hook gating chart */}
      {chartData.length > 0 && (
        <ChartContainer title="Gate Decisions by Hook" height={160} className="h-[220px]">
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                <YAxis type="category" dataKey="name" {...axisProps} width={110} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                <Bar isAnimationActive={false} dataKey="blocks" name="Blocks" stackId="a" fill="var(--c-error)" radius={[0, 0, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="advisories" name="Advisories" stackId="a" fill="var(--c-warning)" radius={[0, 0, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="passes" name="Passes" stackId="a" fill="var(--c-success)" radius={[0, 2, 2, 0]} />
              </BarChart>
        </ChartContainer>
      )}

      {/* Per-hook table */}
      <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-primary">
              <th className="text-left px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Hook</th>
              <th className="text-right px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Blocks</th>
              <th className="text-right px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Advisories</th>
              <th className="text-right px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Passes</th>
              <th className="text-right px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Block Rate</th>
              <th className="text-right px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Ignored</th>
              <th className="text-right px-4 py-2.5 text-text-muted font-medium text-xs uppercase tracking-wide">Repeated</th>
            </tr>
          </thead>
          <tbody>
            {hooks.map(([name, g]) => (
              <tr key={name} className="border-b border-border-primary/40 last:border-b-0 hover:bg-bg-tertiary/30">
                <td className="px-4 py-2.5 font-mono text-text-primary text-xs">{name}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <span className={clsx(g.blocks > 0 ? 'text-error font-medium' : 'text-text-disabled')}>
                    {g.blocks > 0 ? fmtNumber(g.blocks) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <span className={clsx(g.advisories > 0 ? 'text-warning font-medium' : 'text-text-disabled')}>
                    {g.advisories > 0 ? fmtNumber(g.advisories) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <span className={clsx(g.passes > 0 ? 'text-success' : 'text-text-disabled')}>
                    {g.passes > 0 ? fmtNumber(g.passes) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <span className={clsx(
                    g.blockRate > 0.2 ? 'text-error' : g.blockRate > 0.05 ? 'text-warning' : 'text-text-secondary'
                  )}>
                    {g.total > 0 ? fmtPct(g.blockRate * 100) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <span className={clsx(g.ignoredAdvisories > 0 ? 'text-warning' : 'text-text-disabled')}>
                    {g.ignoredAdvisories > 0 ? fmtNumber(g.ignoredAdvisories) : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  <span className={clsx(g.repeatedBlocks > 0 ? 'text-error' : 'text-text-disabled')}>
                    {g.repeatedBlocks > 0 ? fmtNumber(g.repeatedBlocks) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ByEventView({ range }: { range: TimeRange }) {
  const { data, isLoading, error, refetch } = useObsHookEvents(range);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string | null>(null);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hook events" retry={refetch} />;

  const filtered = eventFilter
    ? data.invocations.filter((inv) => inv.event === eventFilter)
    : data.invocations;

  const columns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '160px',
      render: (row) => <span className="font-mono text-text-secondary whitespace-nowrap">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'event',
      label: 'Event',
      width: '160px',
      render: (row) => (
        <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-secondary font-mono whitespace-nowrap">
          {row.event}
        </span>
      ),
    },
    {
      key: 'hooks',
      label: 'Hooks fired',
      render: (row) => {
        const isExpanded = expandedRow === row.timestamp;
        if (row.hooks.length === 0) return <span className="text-text-muted">—</span>;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedRow(isExpanded ? null : row.timestamp);
            }}
            className="w-full text-left"
          >
            {isExpanded ? (
              <div className="space-y-1">
                {row.hooks.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-text-primary">{h.command}</span>
                    {h.durationMs !== undefined && (
                      <span className={clsx('text-text-muted', h.durationMs > 500 && 'text-warning')}>
                        {fmtMs(h.durationMs)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-sm text-text-secondary">
                {row.hooks.map((h) => h.command).join(', ')}
              </span>
            )}
          </button>
        );
      },
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '90px',
      render: (row) => <span className="font-mono text-text-muted">{row.sessionId.slice(0, 8)}</span>,
    },
  ];

  return (
    <>
      {data.events.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.events.map((ev) => (
            <button
              key={ev.event}
              onClick={() => setEventFilter(eventFilter === ev.event ? null : ev.event)}
              className={clsx(
                'rounded-lg border p-4 text-left transition-colors',
                eventFilter === ev.event
                  ? 'border-accent bg-accent/10'
                  : 'border-border-primary bg-bg-secondary hover:border-accent/50'
              )}
            >
              <div className="text-2xl font-semibold tracking-tight text-accent">{fmtNumber(ev.count)}</div>
              <div className="mt-1 text-xs text-text-muted font-mono">{ev.event}</div>
              {ev.hooks.length > 0 && (
                <div className="mt-1 text-xs text-text-muted truncate">{ev.hooks.join(', ')}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {filtered.length > 0 ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-secondary">
              Recent Invocations ({filtered.length})
              {eventFilter && <span className="ml-2 text-text-muted">— {eventFilter}</span>}
            </h2>
            {eventFilter && (
              <button onClick={() => setEventFilter(null)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                clear filter
              </button>
            )}
          </div>
          <DataTable<InvocationRow>
            data={filtered}
            columns={columns}
            keyField="timestamp"
            maxRows={100}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-sm text-text-muted">
          No hook invocations recorded in the selected period.
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </>
  );
}

export function HooksPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showMissing, setShowMissing] = useState(false);
  const [showUnused, setShowUnused] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [dataset, setDataset] = useState<HookDataset>('by-hook');
  const [displayMode, setDisplayMode] = useState<DatasetDisplayMode>('top-n-other');
  const [displayN, setDisplayN] = useState(10);
  const { data, isLoading, error, refetch } = useObsHooks(range, granularity);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hooks" retry={refetch} />;

  const rankedWithRate: HookRow[] = data.ranked.map(r => ({
    ...r,
    successRate: r.count > 0 ? ((r.count - r.errors) / r.count) * 100 : 100,
  }));
  const unusedRows: HookRow[] = (data.unused || []).map(h => ({
    command: h.command, event: h.event, count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, errors: 0, active: true, successRate: 100,
    blocking: h.blocking, gate: h.gate, markerFile: h.markerFile, description: h.description, group: h.group,
  }));

  const missingCount = rankedWithRate.filter(r => !r.active).length;

  let filtered = rankedWithRate.filter(r => r.active);
  if (showMissing) filtered = [...filtered, ...rankedWithRate.filter(r => !r.active)];
  if (showUnused) filtered = [...filtered, ...unusedRows];

  const activeHooks = filtered.filter(r => r.count > 0).length;
  const totalExecutions = filtered.filter(r => r.count > 0).reduce((s, r) => s + r.count, 0);
  const totalErrors = filtered.reduce((s, r) => s + r.errors, 0);
  const activeWithCounts = filtered.filter(r => r.active && r.count > 0);
  const avgSuccessRate = activeWithCounts.length > 0
    ? activeWithCounts.reduce((s, r) => s + r.successRate, 0) / activeWithCounts.length
    : 100;

  const toolsWithLatency = filtered.filter(r => r.count > 0);
  const totalCount = toolsWithLatency.reduce((s, r) => s + r.count, 0);
  const weightedP50 = totalCount > 0
    ? toolsWithLatency.reduce((s, r) => s + r.p50Ms * r.count, 0) / totalCount
    : 0;
  const weightedP95 = totalCount > 0
    ? toolsWithLatency.reduce((s, r) => s + r.p95Ms * r.count, 0) / totalCount
    : 0;

  // Helpers for display mode
  const dn = displayN;
  const dm = displayMode;
  function topNHookKeys(days: Array<{ hooks?: Record<string, number> }>): string[] {
    const totals: Record<string, number> = {};
    for (const day of days) for (const [k, v] of Object.entries(day.hooks ?? {})) totals[k] = (totals[k] ?? 0) + v;
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (dm === 'all') return ranked.map(([k]) => k);
    const top = ranked.slice(0, dn).map(([k]) => k);
    if (dm === 'top-n-other' && ranked.length > dn) top.push('Other');
    return top;
  }
  function stackHookDays(days: Array<{ date: string; hooks?: Record<string, number> }>, keys: string[]): Record<string, unknown>[] {
    const hasOther = dm === 'top-n-other' && keys.includes('Other');
    const realKeys = keys.filter(k => k !== 'Other');
    return days.map(day => {
      const entry: Record<string, unknown> = { date: day.date };
      const source = day.hooks ?? {};
      for (const k of realKeys) entry[k] = source[k] ?? 0;
      if (hasOther) {
        let other = 0;
        for (const [k, v] of Object.entries(source)) if (!realKeys.includes(k)) other += v;
        entry['Other'] = other;
      }
      return entry;
    });
  }
  function sliceRanked<T extends Record<string, unknown>>(items: T[], valueKey: string): T[] {
    if (dm === 'all') return items;
    const top = items.slice(0, dn);
    if (dm === 'top-n' || items.length <= dn) return top;
    const rest = items.slice(dn);
    const otherValue = rest.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
    if (otherValue === 0) return top;
    const other = { command: 'Other', event: 'Other', name: 'Other', [valueKey]: otherValue } as unknown as T;
    return [...top, other];
  }

  // By-hook time series
  const topHookNames = topNHookKeys(data.byDay);
  const stackedByHook = stackHookDays(data.byDay, topHookNames);

  // By-event time series
  const hookEventMap = Object.fromEntries(rankedWithRate.map(r => [r.command, r.event]));
  const topEventNames: string[] = (() => {
    const totals: Record<string, number> = {};
    for (const day of data.byDay) {
      for (const [hook, count] of Object.entries(day.hooks ?? {})) {
        const ev = hookEventMap[hook] ?? 'unknown';
        totals[ev] = (totals[ev] ?? 0) + count;
      }
    }
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (dm === 'all') return ranked.map(([k]) => k);
    const top = ranked.slice(0, dn).map(([k]) => k);
    if (dm === 'top-n-other' && ranked.length > dn) top.push('Other');
    return top;
  })();
  const stackedByEvent = data.byDay.map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    const evCounts: Record<string, number> = {};
    for (const [hook, count] of Object.entries(day.hooks ?? {})) {
      const ev = hookEventMap[hook] ?? 'unknown';
      evCounts[ev] = (evCounts[ev] ?? 0) + count;
    }
    const realKeys = topEventNames.filter(k => k !== 'Other');
    for (const e of realKeys) entry[e] = evCounts[e] ?? 0;
    if (dm === 'top-n-other' && topEventNames.includes('Other')) {
      let other = 0;
      for (const [e, v] of Object.entries(evCounts)) if (!realKeys.includes(e)) other += v;
      entry['Other'] = other;
    }
    return entry;
  });

  // Event donut
  const eventDonut = sliceRanked(data.byEvent ?? [], 'count');

  // By-latency time series
  const topLatencyHookNames = topNHookKeys(data.byDayLatency ?? []);
  const stackedByLatency = stackHookDays(data.byDayLatency ?? [], topLatencyHookNames);

  // By-errors time series
  const topErrorHookNames = topNHookKeys(data.byDayErrors ?? []);
  const stackedByErrors = stackHookDays(data.byDayErrors ?? [], topErrorHookNames);

  const topErrorHooksForDist = sliceRanked(
    [...rankedWithRate].filter(r => r.errors > 0).sort((a, b) => b.errors - a.errors) as Record<string, unknown>[],
    'errors'
  );
  const topLatencyHooksForDist = sliceRanked(
    [...rankedWithRate].filter(r => r.count > 0).sort((a, b) => b.p50Ms - a.p50Ms) as Record<string, unknown>[],
    'p50Ms'
  );

  const activeKeys = dataset === 'by-hook' ? topHookNames
    : dataset === 'latency' ? topLatencyHookNames
    : topErrorHookNames;
  const activeData = dataset === 'by-hook' ? stackedByHook
    : dataset === 'latency' ? stackedByLatency
    : stackedByErrors;
  const timeSeriesTitle = `${GRAN_LABEL[granularity]} ${dataset === 'latency' ? 'Latency' : dataset === 'errors' ? 'Errors' : 'Executions'} by Hook`;

  const distTitle = dataset === 'latency' ? 'Top Hooks by Latency'
    : dataset === 'errors' ? 'Top Hooks by Errors'
    : 'Top Events';

  const filterControls = (
    <>
      {missingCount > 0 && (
        <FilterToggle label={`Missing (${missingCount})`} active={showMissing} onToggle={() => setShowMissing(!showMissing)} />
      )}
      {unusedRows.length > 0 && (
        <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => setShowUnused(!showUnused)} />
      )}
    </>
  );

  const activeFilterCount = (showMissing ? 1 : 0) + (showUnused ? 1 : 0);

  // Group chips use chart palette tokens so they re-theme with the rest of the app
  // (light/dark + 30+ presets). Names hash to a palette slot; collisions are fine —
  // groups in the same row are visually distinguishable by label, not color alone.
  const GROUP_PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
  function groupColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return GROUP_PALETTE[h % GROUP_PALETTE.length];
  }

  const columns: Column<HookRow>[] = [
    {
      key: 'command',
      label: 'Hook',
      sortable: true,
      shrink: true,
      render: (row) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            {row.group && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
                style={{ background: `color-mix(in srgb, ${groupColor(row.group)} 15%, transparent)`, color: groupColor(row.group) }}
              >
                {row.group}
              </span>
            )}
            <span className={clsx('font-mono', row.count === 0 ? 'text-text-muted' : 'text-text-primary')}>
              {row.command}
            </span>
            {row.blocking && <span className="text-[10px] px-1 py-0.5 rounded bg-error/15 text-error uppercase tracking-wide shrink-0">blocking</span>}
            {row.count === 0 && <span className="text-xs text-text-disabled uppercase">unused</span>}
            {!row.active && row.count > 0 && <span className="text-xs text-warning uppercase">missing</span>}
          </div>
          {row.description && (
            <div className="text-xs text-text-muted pl-0.5">{row.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'event',
      label: 'Event',
      sortable: true,
      shrink: true,
      render: (row) => <span className="text-text-secondary whitespace-nowrap">{row.event}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      shrink: true,
      render: (row) => <span className="font-mono">{fmtNumber(row.count)}</span>,
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => (
        <span className={clsx('font-mono', row.errors > 0 && 'text-error font-medium')}>
          {row.errors > 0 ? fmtNumber(row.errors) : '—'}
        </span>
      ),
    },
    {
      key: 'successRate',
      label: 'Success',
      align: 'right',
      sortable: true,
      width: '78px',
      render: (row) => row.count > 0
        ? <span className={clsx('font-mono', row.successRate >= 95 ? 'text-success' : row.successRate >= 80 ? 'text-warning' : 'text-error')}>{fmtPct(row.successRate)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'p50Ms',
      label: 'P50',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.count > 0
        ? <span className="font-mono">{fmtMs(row.p50Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.count > 0
        ? <span className={clsx('font-mono', row.p95Ms > 500 && 'text-warning')}>{fmtMs(row.p95Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'lastUsed',
      label: 'Last Used',
      sortable: true,
      width: '100px',
      render: (row) => row.lastUsed
        ? <span className="text-text-secondary whitespace-nowrap">{shortRelativeTime(row.lastUsed)}</span>
        : <span className="text-text-disabled">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title="Hooks"
        datasets={HOOK_DATASETS}
        dataset={dataset}
        onDatasetChange={(d) => setDataset(d as HookDataset)}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
        filters={filterControls}
        activeFilterCount={activeFilterCount}
        displayMode={displayMode}
        onDisplayModeChange={setDisplayMode}
        displayN={displayN}
        onDisplayNChange={setDisplayN}
      />

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 !mt-0">
        <StatCard label="Active Hooks" value={fmtNumber(activeHooks)} />
        <StatCard label="Executions" value={fmtCalls(totalExecutions)} accent="neutral" />
        <StatCard
          label="Errors"
          value={totalErrors === 0 ? '0' : fmtNumber(totalErrors)}
          accent={totalErrors === 0 ? 'success' : totalErrors / Math.max(totalExecutions, 1) < 0.05 ? 'warning' : 'error'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
        <StatCard
          label="P50 Latency"
          value={weightedP50 > 0 ? fmtMs(weightedP50) : '—'}
          accent={weightedP50 > 0 ? (weightedP50 < 500 ? 'success' : weightedP50 < 2000 ? 'warning' : 'error') : undefined}
        />
        <StatCard
          label="P95 Latency"
          value={weightedP95 > 0 ? fmtMs(weightedP95) : '—'}
          accent={weightedP95 > 0 ? (weightedP95 < 500 ? 'success' : weightedP95 < 2000 ? 'warning' : 'error') : undefined}
        />
      </div>

      {data.gating && Object.keys(data.gating).length > 0 && (
        <GatingSection gating={data.gating} />
      )}

      {dataset === 'by-event' ? (
        <ByEventView range={range} />
      ) : (
        <>
          {data.byDay.length > 0 && (
            <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
              <div className="flex-1 min-h-0 flex">
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <h3 className="font-heading text-lg font-medium text-text-secondary">{timeSeriesTitle}</h3>
                    <div className="flex gap-1">
                      {(['line', 'bar'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setChartType(t)}
                          className={clsx(
                            'px-2 py-0.5 text-xs rounded transition-colors',
                            chartType === t ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-1" />
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      {chartType === 'bar' ? (
                        <BarChart data={activeData}>
                          <CartesianGrid {...gridProps} />
                          <XAxis dataKey="date" {...xAxisDateProps} />
                          <YAxis {...axisProps} />
                          <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          {activeKeys.map((name, i) => (
                            <Bar isAnimationActive={false} key={name} dataKey={name} name={fmtLegendLabel(name)} stackId="a" fill={chartColor(name, i)} radius={i === activeKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                          ))}
                        </BarChart>
                      ) : (
                        <AreaChart data={activeData}>
                          <CartesianGrid {...gridProps} />
                          <XAxis dataKey="date" {...xAxisDateProps} />
                          <YAxis {...axisProps} />
                          <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          {activeKeys.map((name, i) => (
                            <Area isAnimationActive={false} key={name} type="monotone" dataKey={name} name={fmtLegendLabel(name)} stackId="a" stroke={chartColor(name, i)} fill={chartColor(name, i)} fillOpacity={0.4} strokeWidth={1.5} dot={false} />
                          ))}
                        </AreaChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="w-px bg-border-primary shrink-0 mx-5" />

                <div className="w-[360px] shrink-0 flex flex-col">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <h3 className="font-heading text-lg font-medium text-text-secondary">{distTitle}</h3>
                  </div>

                  {(dataset === 'by-hook') && (
                    <div className="flex-1 min-h-0">
                      {eventDonut.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie isAnimationActive={false} data={eventDonut} dataKey="count" nameKey="event" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                              {eventDonut.map((entry, i) => <Cell key={i} fill={(entry as any).event === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-xs text-text-muted">No event data</div>
                      )}
                    </div>
                  )}

                  {dataset === 'latency' && (
                    <div className="flex-1 min-h-0">
                      {topLatencyHooksForDist.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart layout="vertical" data={topLatencyHooksForDist}>
                            <CartesianGrid {...gridProps} horizontal={false} />
                            <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtMs(Number(v))} />
                            <YAxis type="category" dataKey="command" {...axisProps} width={90} tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtMs(Number(v)), 'p50 Latency']} />
                            <Bar isAnimationActive={false} dataKey="p50Ms" fill={CHART_PALETTE[1]} name="p50 Latency" radius={[0, 2, 2, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-xs text-text-muted">No latency data</div>
                      )}
                    </div>
                  )}

                  {dataset === 'errors' && (
                    <div className="flex-1 min-h-0">
                      {topErrorHooksForDist.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart layout="vertical" data={topErrorHooksForDist}>
                            <CartesianGrid {...gridProps} horizontal={false} />
                            <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                            <YAxis type="category" dataKey="command" {...axisProps} width={90} tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtNumber(Number(v)), 'Errors']} />
                            <Bar isAnimationActive={false} dataKey="errors" fill={CHART_PALETTE[4]} name="Errors" radius={[0, 2, 2, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-full text-xs text-text-muted">No errors</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {activeKeys.length > 0 && (
                <div className="flex items-center justify-center gap-x-2 gap-y-[5px] mt-1 mb-1 text-xs shrink-0 flex-wrap">
                  {activeKeys.map((name, i) => (
                    <span key={name} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: chartColor(name, i) }} />
                      <span className="font-mono text-text-secondary">{fmtLegendLabel(name)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <DataTable<HookRow>
            data={filtered}
            columns={columns}
            keyField="command"
            defaultSort={{ key: 'event', dir: 'asc' }}
            onRowClick={(row) => navigate(`/observability/hooks/${encodeURIComponent(row.command)}`)}
          />

          <QueryTiming ms={data.queryTimeMs} />
        </>
      )}
    </div>
  );
}
