import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useObsCompaction } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { shortRelativeTime, fmtNumber } from '../../../utils/format';
import { useState } from 'react';
import { clsx } from 'clsx';

type CompactEvent = {
  timestamp: string;
  sessionId: string;
  trigger: string;
  preTokens: number;
  toolCallCount?: number;
  contextPct?: number;
};

function phaseBucket(toolCallCount?: number): 'early' | 'mid' | 'late' {
  if (!toolCallCount) return 'early';
  if (toolCallCount < 30) return 'early';
  if (toolCallCount <= 70) return 'mid';
  return 'late';
}

const PHASE_COLOR: Record<string, string> = {
  early: CHART_PALETTE[2],
  mid: CHART_PALETTE[1],
  late: CHART_PALETTE[0],
};

export function CompactionPage() {
  const [range, setRange] = useState<TimeRange>('7d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const { data, isLoading, error, refetch } = useObsCompaction(range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load compaction data" retry={refetch} />;

  const events: CompactEvent[] = data.events ?? [];

  const eventsWithCalls = events.filter((e) => e.toolCallCount !== undefined);
  const avgToolCalls = eventsWithCalls.length > 0
    ? Math.round(eventsWithCalls.reduce((s, e) => s + (e.toolCallCount ?? 0), 0) / eventsWithCalls.length)
    : 0;

  const eventsWithCtx = events.filter((e) => e.contextPct !== undefined);
  const avgContextPct = eventsWithCtx.length > 0
    ? Math.round(eventsWithCtx.reduce((s, e) => s + (e.contextPct ?? 0), 0) / eventsWithCtx.length)
    : 0;

  const uniqueSessions = new Set(events.map(e => e.sessionId)).size;
  const uniqueTriggers = new Set(events.map(e => e.trigger)).size;

  const dist = { early: 0, mid: 0, late: 0 };
  for (const e of events) dist[phaseBucket(e.toolCallCount)]++;
  const distData = [
    { phase: 'Early (<30)', count: dist.early, color: PHASE_COLOR.early },
    { phase: 'Mid (30-70)', count: dist.mid, color: PHASE_COLOR.mid },
    { phase: 'Late (>70)', count: dist.late, color: PHASE_COLOR.late },
  ];

  const columns: Column<CompactEvent>[] = [
    {
      key: 'sessionId',
      label: 'Session',
      shrink: true,
      render: (row) => (
        <span className="font-mono text-text-secondary truncate block max-w-[140px]" title={row.sessionId}>
          {row.sessionId.slice(0, 8)}…
        </span>
      ),
    },
    {
      key: 'trigger',
      label: 'Trigger',
      shrink: true,
      render: (row) => <span className="font-mono text-text-secondary">{row.trigger}</span>,
    },
    {
      key: 'preTokens',
      label: 'Pre-tokens',
      align: 'right',
      sortable: true,
      shrink: true,
      render: (row) => <span className="font-mono text-text-secondary">{fmtNumber(row.preTokens)}</span>,
    },
    {
      key: 'toolCallCount',
      label: 'Tool Calls',
      align: 'right',
      sortable: true,
      width: '90px',
      render: (row) => {
        const phase = row.toolCallCount !== undefined ? phaseBucket(row.toolCallCount) : undefined;
        const color = phase === 'early' ? 'text-green-500' : phase === 'mid' ? 'text-yellow-500' : 'text-red-500';
        return (
          <span className="font-mono text-text-secondary">
            {phase ? <span className={color}>{row.toolCallCount}</span> : '—'}
          </span>
        );
      },
    },
    {
      key: 'contextPct',
      label: 'Context %',
      align: 'right',
      sortable: true,
      width: '90px',
      render: (row) => (
        <span className="font-mono text-text-secondary">
          {row.contextPct !== undefined ? (
            <span className={
              row.contextPct >= 80 ? 'text-red-500' :
              row.contextPct >= 60 ? 'text-yellow-500' : 'text-green-500'
            }>
              {row.contextPct}%
            </span>
          ) : '—'}
        </span>
      ),
    },
    {
      key: 'timestamp',
      label: 'Last Used',
      width: '100px',
      render: (row) => <span className="font-mono text-text-muted">{shortRelativeTime(row.timestamp)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="font-heading text-2xl font-bold text-text-primary">Compaction</h1>}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Compactions" value={String(data.totalCompactions)} />
        <StatCard label="Avg Pre-tokens" value={fmtNumber(data.avgPreTokens)} />
        <StatCard label="Avg Tool Calls" value={avgToolCalls > 0 ? String(avgToolCalls) : '—'} />
        <StatCard label="Avg Context %" value={avgContextPct > 0 ? `${avgContextPct}%` : '—'} />
        <StatCard label="Sessions" value={String(uniqueSessions)} />
        <StatCard label="Triggers" value={String(uniqueTriggers)} />
      </div>

      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h3 className="font-heading text-lg font-medium text-text-secondary">Compactions by Day</h3>
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
                  <BarChart data={data.byDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Bar dataKey="count" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Compactions" />
                  </BarChart>
                ) : (
                  <AreaChart data={data.byDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area type="monotone" dataKey="count" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Compactions" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
          <div className="w-px bg-border-primary shrink-0 mx-5" />
          <div className="w-[360px] shrink-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="font-heading text-lg font-medium text-text-secondary">Phase Distribution</h3>
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid {...gridProps} horizontal={false} />
                  <XAxis type="number" {...axisProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="phase" {...axisProps} width={80} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[0, 2, 2, 0]} name="Count">
                    {distData.map((entry) => (
                      <Cell key={entry.phase} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center gap-x-2 gap-y-[5px] mt-1 mb-1 text-xs shrink-0">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: PHASE_COLOR.early }} />Early (&lt;30)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: PHASE_COLOR.mid }} />Mid (30-70)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: PHASE_COLOR.late }} />Late (&gt;70)</span>
        </div>
      </div>

      {events.length > 0 ? (
        <DataTable<CompactEvent>
          data={events}
          columns={columns}
          keyField="timestamp"
          rowKeyFn={(row) => `${row.sessionId}-${row.timestamp}`}
        />
      ) : (
        <div className="flex items-center justify-center py-16">
          <p className="text-text-secondary text-sm">No compaction events in this time range.</p>
        </div>
      )}

      {data.queryTimeMs != null && <QueryTiming ms={data.queryTimeMs} />}
    </div>
  );
}
