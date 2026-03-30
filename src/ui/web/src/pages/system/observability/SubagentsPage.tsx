import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useObsSubagents, type SubagentsData, type SubagentTypeBucket, type SubagentInvocation } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { fmtNumber, fmtMs, relativeTime, shortDate, granLabel } from '../../../utils/format';
import { cn } from '../../../utils/cn';


export function SubagentsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('7d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [bgOnly, setBgOnly] = useState(false);
  const { data, isLoading, error, refetch } = useObsSubagents(range, granularity);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load subagent data" retry={refetch} />;

  const filteredRecent = bgOnly ? data.recent.filter((r) => r.runInBackground) : data.recent;

  const typeColumns: Column<SubagentTypeBucket>[] = [
    {
      key: 'subagentType',
      label: 'Type',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.subagentType}</span>,
    },
    { key: 'count', label: 'Count', align: 'right', sortable: true, render: (row) => fmtNumber(row.count) },
    { key: 'pct', label: '% Total', align: 'right', render: (row) => `${row.pct}%` },
    { key: 'avgMs', label: 'Avg', align: 'right', sortable: true, render: (row) => fmtMs(row.avgMs) },
    { key: 'p95Ms', label: 'p95', align: 'right', sortable: true, render: (row) => fmtMs(row.p95Ms) },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      render: (row) => <span className={row.errors > 0 ? 'text-error' : ''}>{fmtNumber(row.errors)}</span>,
    },
  ];

  const recentColumns: Column<SubagentInvocation>[] = [
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <span className="text-text-primary text-xs max-w-xs truncate block" title={row.description}>
          {row.description || '—'}
        </span>
      ),
    },
    {
      key: 'timestamp',
      label: 'Time',
      sortable: true,
      render: (row) => <span className="text-text-secondary text-xs whitespace-nowrap">{relativeTime(row.timestamp)}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      render: (row) => (
        <Link
          to={`/observability/sessions/${encodeURIComponent(row.sessionId)}`}
          className="font-mono text-xs text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.sessionId.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'subagentType',
      label: 'Type',
      render: (row) => <span className="font-mono text-text-secondary text-xs">{row.subagentType || '—'}</span>,
    },
    {
      key: 'model',
      label: 'Model',
      render: (row) => <span className="text-text-secondary text-xs">{row.model || '—'}</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      sortable: true,
      render: (row) => <span className="text-xs">{row.durationMs ? fmtMs(row.durationMs) : '—'}</span>,
    },
    {
      key: 'runInBackground',
      label: 'BG',
      align: 'center',
      render: (row) => row.runInBackground
        ? <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent">bg</span>
        : <span className="text-xs text-text-tertiary">fg</span>,
    },
    {
      key: 'isError',
      label: 'Status',
      align: 'center',
      render: (row) => row.isError
        ? <span className="text-xs px-1.5 py-0.5 rounded bg-error/20 text-error">error</span>
        : <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">ok</span>,
    },
    {
      key: 'subagentSessionId',
      label: 'Child',
      render: (row) => row.subagentSessionId ? (
        <Link
          to={`/observability/sessions/${encodeURIComponent(row.subagentSessionId)}`}
          className="font-mono text-xs text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.subagentSessionId.slice(0, 8)}
        </Link>
      ) : <span className="text-text-tertiary text-xs">—</span>,
    },
  ];


  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="text-2xl font-bold text-text-primary">Subagents</h1>}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      >
        <button
          className={cn(
            'px-3 py-1 text-xs rounded-md border transition-colors',
            bgOnly
              ? 'bg-accent/20 border-accent text-accent'
              : 'border-border text-text-secondary hover:text-text-primary',
          )}
          onClick={() => setBgOnly(!bgOnly)}
        >
          Background only
        </button>
      </ObsControlBar>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Active Now"
          value={<span className={data.activeNow > 0 ? 'text-accent' : ''}>{fmtNumber(data.activeNow)}</span>}
        />
        <StatCard label="Total Dispatches" value={fmtNumber(data.totalDispatches)} />
        <StatCard label="Spawner Sessions" value={fmtNumber(data.parentSessionCount)} />
        <StatCard
          label="Avg Duration"
          value={fmtMs(data.avgMs)}
          detail={`p95: ${fmtMs(data.p95Ms)}`}
        />
      </div>

      {data.byDay.length > 0 && (
        <ChartContainer title={granLabel(granularity, 'Dispatches')}>
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Legend {...legendProps} />
            <Bar dataKey="backgroundCount" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Background" stackId="a" />
            <Bar dataKey="foregroundCount" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Foreground" stackId="a" />
          </BarChart>
        </ChartContainer>
      )}

      {data.byType.length > 0 && (
        <DataTable<SubagentTypeBucket>
          data={data.byType}
          columns={typeColumns}
          keyField="subagentType"
        />
      )}

      {filteredRecent.length > 0 && (
        <DataTable<SubagentInvocation>
          data={filteredRecent}
          columns={recentColumns}
          keyField="timestamp"
          onRowClick={(row) => {
            const target = row.subagentSessionId || row.sessionId;
            navigate(`/observability/sessions/${encodeURIComponent(target)}`);
          }}
        />
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
