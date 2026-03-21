import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsHookDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, shortDate, dateTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type InvocationRow = { timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string };

export function HookDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const hookName = decodeURIComponent(rawName ?? '');
  const [days, setDays] = useState(30);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useObsHookDetail(hookName, days);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hook details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errors) / data.totalCount) * 100
    : 100;

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cn('font-mono text-xs', row.durationMs > 500 ? 'text-warning' : 'text-text-muted')}>
          {fmtMs(row.durationMs)}
        </span>
      ),
    },
    {
      key: 'exitCode',
      label: 'Exit',
      align: 'right',
      render: (row) => {
        if (row.exitCode === undefined) return <span className="text-text-muted">-</span>;
        return (
          <span className={cn('font-mono text-xs', row.exitCode !== 0 ? 'text-error font-medium' : 'text-text-muted')}>
            {row.exitCode}
          </span>
        );
      },
    },
    {
      key: 'output',
      label: 'Output',
      render: (row) => {
        if (!row.output) return <span className="text-text-muted">-</span>;
        const isExpanded = expandedRow === row.timestamp;
        const short = row.output.length > 80 ? row.output.slice(0, 80) + '...' : row.output;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : row.timestamp); }}
            className={cn(
              'text-left font-mono text-xs hover:text-text-primary max-w-md',
              row.exitCode !== undefined && row.exitCode !== 0 ? 'text-error' : 'text-text-muted'
            )}
          >
            {isExpanded ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{row.output}</pre>
            ) : (
              short
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/system/observability/hooks"
            className="text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            &larr; Hooks
          </Link>
          <h1 className="text-xl font-semibold font-mono text-text-primary">{hookName}</h1>
          {data.event && (
            <span className="rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted">{data.event}</span>
          )}
          <span className={cn(
            'inline-block h-2.5 w-2.5 rounded-full',
            data.active ? 'bg-success' : 'bg-text-muted/30'
          )} title={data.active ? 'Active' : 'Removed'} />
        </div>
        <TimeRangeSelector value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total Executions" value={fmtNumber(data.totalCount)} />
        <StatCard label="Avg Latency" value={fmtMs(data.avgMs)} />
        <StatCard label="P50" value={fmtMs(data.p50Ms)} />
        <StatCard
          label="P95"
          value={fmtMs(data.p95Ms)}
          accent={data.p95Ms > 500 ? 'warning' : 'default'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
          detail={data.errors > 0 ? `${fmtNumber(data.errors)} errors` : undefined}
        />
      </div>

      {data.byDay.length > 0 && (
        <ChartContainer title="Daily Executions">
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Executions" />
          </BarChart>
        </ChartContainer>
      )}

      {data.invocations.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-text-secondary">
            Recent Executions ({data.invocations.length})
          </h2>
          <DataTable<InvocationRow>
            data={data.invocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
          />
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
