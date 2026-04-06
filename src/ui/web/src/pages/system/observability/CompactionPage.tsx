import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useObsCompaction } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { relativeTime, shortDate, fmtNumber } from '../../../utils/format';
import { useState } from 'react';
import type { TimeRange } from '../../../api/observability-hooks';

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
  const { data, isLoading, error, refetch } = useObsCompaction(range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load compaction data" retry={refetch} />;

  const events: CompactEvent[] = data.events ?? [];

  // Compute derived stats
  const eventsWithCalls = events.filter((e) => e.toolCallCount !== undefined);
  const avgToolCalls = eventsWithCalls.length > 0
    ? Math.round(eventsWithCalls.reduce((s, e) => s + (e.toolCallCount ?? 0), 0) / eventsWithCalls.length)
    : 0;

  const eventsWithCtx = events.filter((e) => e.contextPct !== undefined);
  const avgContextPct = eventsWithCtx.length > 0
    ? Math.round(eventsWithCtx.reduce((s, e) => s + (e.contextPct ?? 0), 0) / eventsWithCtx.length)
    : 0;

  // Distribution: early (<30 calls), mid (30-70), late (>70)
  const dist = { early: 0, mid: 0, late: 0 };
  for (const e of events) dist[phaseBucket(e.toolCallCount)]++;
  const distData = [
    { phase: 'Early (<30)', count: dist.early, color: PHASE_COLOR.early },
    { phase: 'Mid (30-70)', count: dist.mid, color: PHASE_COLOR.mid },
    { phase: 'Late (>70)', count: dist.late, color: PHASE_COLOR.late },
  ];

  const columns: Column<CompactEvent>[] = [
    {
      key: 'timestamp',
      label: 'When',
      width: '110px',
      render: (row) => <span className="text-text-muted text-sm">{relativeTime(row.timestamp)}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-xs text-text-secondary truncate block max-w-[140px]" title={row.sessionId}>
          {row.sessionId.slice(0, 8)}…
        </span>
      ),
    },
    {
      key: 'trigger',
      label: 'Trigger',
      width: '120px',
      render: (row) => <span className="font-mono text-xs text-text-secondary">{row.trigger}</span>,
    },
    {
      key: 'preTokens',
      label: 'Pre-tokens',
      align: 'right',
      sortable: true,
      width: '110px',
      render: (row) => <span className="text-text-secondary text-sm">{fmtNumber(row.preTokens)}</span>,
    },
    {
      key: 'toolCallCount',
      label: 'Tool calls',
      align: 'right',
      sortable: true,
      width: '90px',
      render: (row) => (
        <span className="text-text-secondary text-sm">
          {row.toolCallCount !== undefined ? (
            <span className={
              phaseBucket(row.toolCallCount) === 'early' ? 'text-green-500' :
              phaseBucket(row.toolCallCount) === 'mid' ? 'text-yellow-500' : 'text-red-500'
            }>
              {row.toolCallCount}
            </span>
          ) : '—'}
        </span>
      ),
    },
    {
      key: 'contextPct',
      label: 'Context %',
      align: 'right',
      sortable: true,
      width: '90px',
      render: (row) => (
        <span className="text-text-secondary text-sm">
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
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Compaction</h1>
          <p className="text-text-secondary text-sm mt-1">Context compaction events — when and how deep</p>
        </div>
        <ObsControlBar title="" range={range} onRangeChange={setRange} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Compactions" value={String(data.totalCompactions)} />
        <StatCard label="Avg Pre-tokens" value={fmtNumber(data.avgPreTokens)} />
        <StatCard label="Avg Tool Calls" value={avgToolCalls > 0 ? String(avgToolCalls) : '—'} />
        <StatCard label="Avg Context %" value={avgContextPct > 0 ? `${avgContextPct}%` : '—'} />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-3">
          <ChartContainer title="Compactions by Day">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.byDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                <Bar dataKey="count" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Compactions" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>

        <ChartContainer title="Phase Distribution">
          <ResponsiveContainer width="100%" height={180}>
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
        </ChartContainer>
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
    </div>
  );
}
