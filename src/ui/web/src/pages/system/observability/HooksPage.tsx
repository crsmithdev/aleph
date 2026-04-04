import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
import { useObsHooks, useObsHookEvents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, CHART_PALETTE } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, dateTime } from '../../../utils/format';
import { clsx } from 'clsx';

type HookRow = {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
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

function ByHookView({ range, granularity }: {
  range: TimeRange;
  granularity: Granularity;
}) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsHooks(range, granularity);
  const [hideInactive, setHideInactive] = useState(true);
  const [showUnused, setShowUnused] = useState(true);

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
  let filtered = hideInactive ? rankedWithRate.filter((r) => r.active) : rankedWithRate;
  if (showUnused) filtered = [...filtered, ...unusedRows];

  const totalExecutions = filtered.filter(r => r.count > 0).reduce((s, r) => s + r.count, 0);
  const activeScripts = filtered.filter(r => r.active && r.count > 0).length;
  const totalErrors = filtered.reduce((s, r) => s + r.errors, 0);
  const activeWithCounts = filtered.filter(r => r.active && r.count > 0);
  const avgSuccessRate = activeWithCounts.length > 0
    ? activeWithCounts.reduce((s, r) => s + r.successRate, 0) / activeWithCounts.length
    : 100;

  const columns: Column<HookRow>[] = [
    {
      key: 'command',
      label: 'Hook',
      sortable: true,
      render: (row) => (
        <span className={clsx('font-mono', row.count === 0 ? 'text-text-muted' : 'text-text-primary')}>
          {row.command}
          {row.count === 0 && <span className="ml-2 text-[10px] text-text-disabled uppercase">unused</span>}
        </span>
      ),
    },
    {
      key: 'event',
      label: 'Event',
      render: (row) => <span className="text-text-secondary">{row.event}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={clsx(row.errors > 0 && 'text-error font-medium')}>
          {row.errors > 0 ? fmtNumber(row.errors) : '—'}
        </span>
      ),
    },
    {
      key: 'successRate',
      label: 'Success',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={clsx(row.successRate < 95 && 'text-warning', row.successRate < 80 && 'text-error')}>
          {fmtPct(row.successRate)}
        </span>
      ),
    },
    {
      key: 'avgMs',
      label: 'Avg',
      align: 'right',
      sortable: true,
      render: (row) => fmtMs(row.avgMs),
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={clsx(row.p95Ms > 500 && 'text-warning')}>
          {fmtMs(row.p95Ms)}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Executions" value={fmtNumber(totalExecutions)} />
        <StatCard label="Active Scripts" value={fmtNumber(activeScripts)} />
        <StatCard label="Total Errors" value={fmtNumber(totalErrors)} accent={totalErrors > 0 ? 'error' : 'default'} />
        <StatCard
          label="Avg Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {filtered.filter(r => r.count > 0).length > 0 && (
        <div className="flex gap-4">
          <div className="flex-1 rounded-lg border border-border-primary bg-bg-secondary p-4">
            <h3 className="mb-3 text-sm font-medium text-text-secondary">Executions by Script</h3>
            <div className="flex items-center gap-6">
              <PieChart width={180} height={180}>
                <Pie
                  data={filtered.filter(r => r.count > 0)}
                  dataKey="count"
                  nameKey="command"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                >
                  {filtered.filter(r => r.count > 0).map((_, i) => (
                    <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                  ))}
                </Pie>
                <RechartsTooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
              </PieChart>
              <div className="flex flex-col gap-1.5 min-w-0">
                {filtered.filter(r => r.count > 0).slice(0, 10).map((row, i) => (
                  <div key={row.command} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                    <span className="font-mono text-text-secondary truncate">{row.command}</span>
                    <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {data.byEvent && data.byEvent.length > 0 && (
            <div className="rounded-lg border border-border-primary bg-bg-secondary p-4" style={{ width: 220 }}>
              <h3 className="mb-3 text-sm font-medium text-text-secondary">By Event</h3>
              <div className="flex flex-col items-center gap-4">
                <PieChart width={120} height={120}>
                  <Pie data={data.byEvent} dataKey="count" nameKey="event" cx="50%" cy="50%" innerRadius={30} outerRadius={50}>
                    {data.byEvent.map((_, i) => (
                      <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                </PieChart>
                <div className="flex flex-col gap-2 w-full">
                  {data.byEvent.map((row, i) => (
                    <div key={row.event} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="font-mono text-text-secondary">{row.event}</span>
                      <span className="ml-auto text-text-muted font-mono">{fmtNumber(row.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <FilterToggle label="Active only" active={hideInactive} onToggle={() => setHideInactive(!hideInactive)} />
        {unusedRows.length > 0 && (
          <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => setShowUnused(!showUnused)} />
        )}
      </div>

      <DataTable<HookRow>
        data={filtered}
        columns={columns}
        keyField="command"
        onRowClick={(row) =>
          navigate(`/observability/hooks/${encodeURIComponent(row.command)}`)
        }
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
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'event',
      label: 'Event',
      render: (row) => (
        <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary font-mono">
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
                  <div key={i} className="flex items-center gap-2 text-xs">
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
              <span className="text-xs text-text-secondary">
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
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>,
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
              {eventFilter && (
                <span className="ml-2 text-text-muted">— {eventFilter}</span>
              )}
            </h2>
            {eventFilter && (
              <button
                onClick={() => setEventFilter(null)}
                className="text-xs text-text-muted hover:text-text-primary transition-colors"
              >
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

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Scripts</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity} />

      <div className="flex items-center gap-1 rounded-md border border-border-primary bg-bg-secondary p-0.5 self-start w-fit">
        <button
          onClick={() => setView('by-hook')}
          className={clsx(
            'rounded px-2.5 py-1 text-xs transition-colors',
            view === 'by-hook'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          By Hook
        </button>
        <button
          onClick={() => setView('by-event')}
          className={clsx(
            'rounded px-2.5 py-1 text-xs transition-colors',
            view === 'by-event'
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          By Event
        </button>
      </div>

      {view === 'by-hook' ? (
        <ByHookView range={range} granularity={granularity} />
      ) : (
        <ByEventView range={range} />
      )}
    </div>
  );
}
