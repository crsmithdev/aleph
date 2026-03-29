import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsHooks, useObsHookEvents } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, shortDate, dateTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';

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
};

type InvocationRow = {
  timestamp: string;
  sessionId: string;
  event: string;
  hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }>;
};

type ViewMode = 'by-hook' | 'by-event';

function ByHookView({ range, granularity, hideInactive, onHideInactiveChange, showUnused, onShowUnusedChange }: {
  range: TimeRange;
  granularity: Granularity;
  hideInactive: boolean;
  onHideInactiveChange: (v: boolean) => void;
  showUnused: boolean;
  onShowUnusedChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsHooks(range, granularity);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hooks" retry={refetch} />;

  const rankedWithRate: HookRow[] = data.ranked.map(r => ({
    ...r,
    successRate: r.count > 0 ? ((r.count - r.errors) / r.count) * 100 : 100,
  }));
  const unusedRows: HookRow[] = (data.unused || []).map(h => ({
    command: h.command, event: h.event, count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, errors: 0, active: true, successRate: 100,
  }));
  let filtered = hideInactive ? rankedWithRate.filter((r) => r.active) : rankedWithRate;
  if (showUnused) filtered = [...filtered, ...unusedRows];

  const columns: Column<HookRow>[] = [
    {
      key: 'command',
      label: 'Hook',
      sortable: true,
      render: (row) => (
        <span className={cn('font-mono', row.count === 0 ? 'text-text-muted' : 'text-text-primary')}>
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
        <span className={cn(row.errors > 0 && 'text-error font-medium')}>
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
        <span className={cn(row.successRate < 95 && 'text-warning', row.successRate < 80 && 'text-error')}>
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
        <span className={cn(row.p95Ms > 500 && 'text-warning')}>
          {fmtMs(row.p95Ms)}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="flex items-center gap-3">
        <FilterToggle label="Active only" active={hideInactive} onToggle={() => onHideInactiveChange(!hideInactive)} />
        {unusedRows.length > 0 && (
          <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => onShowUnusedChange(!showUnused)} />
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

      {data.byDay.length > 0 && (
        <ChartContainer title="Hook Executions Over Time" chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Bar dataKey="count" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="Executions" />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} name="Executions" />
            </LineChart>
          )}
        </ChartContainer>
      )}

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
                      <span className={cn('text-text-muted', h.durationMs > 500 && 'text-warning')}>
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
              className={cn(
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
  const [hideInactive, setHideInactive] = useState(true);
  const [showUnused, setShowUnused] = useState(true);
  const [view, setView] = useState<ViewMode>('by-hook');

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Hooks</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        <div className="flex items-center gap-1 rounded-md border border-border-primary bg-bg-secondary p-0.5">
          <button
            onClick={() => setView('by-hook')}
            className={cn(
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
            className={cn(
              'rounded px-2.5 py-1 text-xs transition-colors',
              view === 'by-event'
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            By Event
          </button>
        </div>
      </ObsControlBar>

      {view === 'by-hook' ? (
        <ByHookView
          range={range}
          granularity={granularity}
          hideInactive={hideInactive}
          onHideInactiveChange={setHideInactive}
          showUnused={showUnused}
          onShowUnusedChange={setShowUnused}
        />
      ) : (
        <ByEventView range={range} />
      )}
    </div>
  );
}
