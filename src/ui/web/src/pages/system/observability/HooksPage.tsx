import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useObsHooks, useObsHookEvents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, dateTime, shortDate, shortRelativeTime, fmtSeriesName, granLabel } from '../../../utils/format';
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
};

type InvocationRow = {
  timestamp: string;
  sessionId: string;
  event: string;
  hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }>;
};

type ViewMode = 'by-hook' | 'by-event';

function fmtCalls(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function ByHookView({ range, granularity }: { range: TimeRange; granularity: Granularity }) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsHooks(range, granularity);
  const [showMissing, setShowMissing] = useState(false);
  const [showUnused, setShowUnused] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hooks" retry={refetch} />;

  const rankedWithRate: HookRow[] = data.ranked.map(r => ({
    ...r,
    successRate: r.count > 0 ? ((r.count - r.errors) / r.count) * 100 : 100,
  }));
  const unusedRows: HookRow[] = (data.unused || []).map(h => ({
    command: h.command, event: h.event, count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, errors: 0, active: true, successRate: 100,
    blocking: h.blocking, gate: h.gate, markerFile: h.markerFile, description: h.description,
  }));

  const missingCount = rankedWithRate.filter(r => !r.active).length;

  let filtered = rankedWithRate.filter(r => r.active);
  if (showMissing) filtered = [...filtered, ...rankedWithRate.filter(r => !r.active)];
  if (showUnused) filtered = [...filtered, ...unusedRows];

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

  const columns: Column<HookRow>[] = [
    {
      key: 'command',
      label: 'Hook',
      sortable: true,
      render: (row) => (
        <span className={clsx('font-mono', row.count === 0 ? 'text-text-muted' : 'text-text-primary')}>
          {row.command}
          {row.count === 0 && <span className="ml-2 text-xs text-text-disabled uppercase">unused</span>}
          {!row.active && row.count > 0 && <span className="ml-2 text-xs text-warning uppercase">missing</span>}
        </span>
      ),
    },
    {
      key: 'event',
      label: 'Event',
      width: '160px',
      render: (row) => <span className="text-text-secondary whitespace-nowrap">{row.event}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      width: '80px',
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
      key: 'successRate',
      label: 'Success',
      align: 'right',
      sortable: true,
      width: '80px',
      render: (row) => row.count > 0
        ? <span className={clsx('font-mono', row.successRate < 95 && 'text-warning', row.successRate < 80 && 'text-error')}>{fmtPct(row.successRate)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'lastUsed',
      label: 'Last Used',
      sortable: true,
      width: '100px',
      render: (row) => row.lastUsed
        ? <span className="font-mono text-text-secondary whitespace-nowrap">{shortRelativeTime(row.lastUsed)}</span>
        : <span className="text-text-disabled">—</span>,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Hook Executions"
          value={fmtCalls(totalExecutions)}
          detail={totalErrors > 0 ? `${fmtNumber(totalErrors)} errors` : 'No errors'}
          accent={totalErrors > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="P50 / P95"
          value={weightedP50 > 0 ? fmtMs(weightedP50) : '—'}
          detail={weightedP95 > 0 ? `p95 ${fmtMs(weightedP95)}` : undefined}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {data.byDay.length > 0 && (() => {
        const topHookNames: string[] = (() => {
          const totals: Record<string, number> = {};
          for (const day of data.byDay) {
            for (const [hook, count] of Object.entries(day.hooks ?? {})) {
              totals[hook] = (totals[hook] ?? 0) + count;
            }
          }
          return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
        })();
        const stackedByDay = data.byDay.map(day => {
          const entry: Record<string, unknown> = { date: day.date };
          for (const name of topHookNames) entry[name] = (day.hooks ?? {})[name] ?? 0;
          return entry;
        });
        const byEventAll = data.byEvent ?? [];
        const top5Events = byEventAll.slice(0, 5);
        const eventsOther = byEventAll.slice(5).reduce((s, r) => s + r.count, 0);
        const eventDonut = eventsOther > 0 ? [...top5Events, { event: 'Other', count: eventsOther }] : top5Events;
        return (
          <div className="flex gap-4 items-stretch h-[320px]">
            <div className="flex-1 min-w-0 h-full">
              <ChartContainer title={granLabel(granularity, 'Executions')} chartType={chartType} onChartTypeChange={setChartType} fill className="h-full">
                {chartType === 'bar' ? (
                  <BarChart data={stackedByDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    {topHookNames.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topHookNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                ) : (
                  <AreaChart data={stackedByDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    {topHookNames.map((name, i) => (
                      <Area key={name} type="monotone" dataKey={name} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.4} strokeWidth={1.5} dot={false} />
                    ))}
                  </AreaChart>
                )}
              </ChartContainer>
            </div>
            {eventDonut.length > 0 && (
              <div className="flex flex-col rounded-lg border border-border-primary bg-bg-secondary p-4 w-1/4 min-w-[220px] shrink-0 h-full">
                <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">By Event</h3>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={eventDonut} dataKey="count" nameKey="event" cx="50%" cy="50%" innerRadius={50} outerRadius={78}>
                        {eventDonut.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 shrink-0">
                  {eventDonut.map((row, i) => (
                    <div key={row.event} className="flex items-center gap-1.5 text-xs min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="font-mono text-text-secondary truncate">{fmtSeriesName(row.event)}</span>
                      <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex items-center gap-3">
        {missingCount > 0 && (
          <FilterToggle label={`Missing (${missingCount})`} active={showMissing} onToggle={() => setShowMissing(!showMissing)} activeColor="error" />
        )}
        {unusedRows.length > 0 && (
          <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => setShowUnused(!showUnused)} />
        )}
      </div>

      <DataTable<HookRow>
        data={filtered}
        columns={columns}
        keyField="command"
        onRowClick={(row) => navigate(`/observability/hooks/${encodeURIComponent(row.command)}`)}
      />

      <QueryTiming ms={data.queryTimeMs} />
    </>
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
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [view, setView] = useState<ViewMode>('by-hook');

  const viewToggle = (
    <div className="flex items-center gap-0.5 rounded-md border border-border-primary bg-bg-secondary p-0.5">
      <button
        onClick={() => setView('by-hook')}
        className={clsx(
          'rounded px-2.5 py-1 text-xs transition-colors',
          view === 'by-hook' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
        )}
      >
        By Hook
      </button>
      <button
        onClick={() => setView('by-event')}
        className={clsx(
          'rounded px-2.5 py-1 text-xs transition-colors',
          view === 'by-event' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
        )}
      >
        By Event
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="font-heading text-2xl font-bold text-text-primary">Hooks</h1>}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      >
        {viewToggle}
      </ObsControlBar>

      {view === 'by-hook' ? (
        <ByHookView range={range} granularity={granularity} />
      ) : (
        <ByEventView range={range} />
      )}
    </div>
  );
}
