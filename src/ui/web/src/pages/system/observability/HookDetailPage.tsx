import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsHookDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, shortDate, dateTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';

type InvocationRow = { timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string; trigger?: string; isError?: boolean; errorMessage?: string };

export function HookDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const hookName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsHookDetail(hookName, range);
  const { chartType, setChartType } = useChartType('bar');
  const [errorsOnly, setErrorsOnly] = useState(false);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hook details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errors) / data.totalCount) * 100
    : 100;

  const filteredInvocations = errorsOnly
    ? data.invocations.filter((inv: InvocationRow) => inv.isError)
    : data.invocations;

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'status',
      label: '',
      width: '2rem',
      render: (row) => row.isError
        ? <span className="inline-block w-2 h-2 rounded-full bg-error" title={row.errorMessage || `Exit code ${row.exitCode}`} />
        : <span className="inline-block w-2 h-2 rounded-full bg-success/50" />,
    },
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    ...(data.invocations.some((inv: InvocationRow) => inv.trigger) ? [{
      key: 'trigger',
      label: 'Trigger',
      render: (row: InvocationRow) => row.trigger
        ? <span className="font-mono text-xs text-accent">{row.trigger}</span>
        : <span className="text-text-muted">-</span>,
    }] : []) as Column<InvocationRow>[],
    {
      key: 'exitCode',
      label: 'Exit',
      width: '3rem',
      align: 'right',
      render: (row) => row.exitCode != null
        ? <span className={cn('font-mono text-xs', row.exitCode !== 0 ? 'text-error font-medium' : 'text-text-muted')}>{row.exitCode}</span>
        : <span className="text-text-muted">-</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      sortable: true,
      render: (row) => row.durationMs > 0 ? (
        <span className={cn('font-mono text-xs', row.durationMs > 500 ? 'text-warning' : 'text-text-muted')}>
          {fmtMs(row.durationMs)}
        </span>
      ) : <span className="text-text-muted">-</span>,
    },
    ...(data.invocations.some((inv: InvocationRow) => inv.output || inv.errorMessage) ? [{
      key: 'message',
      label: 'Message',
      render: (row: InvocationRow) => {
        const msg = row.errorMessage || row.output;
        if (!msg) return <span className="text-text-muted">-</span>;
        return <span className={cn('font-mono text-xs truncate block max-w-xs', row.isError ? 'text-error' : 'text-text-muted')} title={msg}>{msg.slice(0, 80)}{msg.length > 80 ? '...' : ''}</span>;
      },
    }] : []) as Column<InvocationRow>[],
    {
      key: 'sessionId',
      label: 'Session',
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
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
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      >
        {data.errors > 0 && (
          <FilterToggle
            label="Errors only"
            active={errorsOnly}
            onToggle={() => setErrorsOnly(!errorsOnly)}
            activeColor="error"
          />
        )}
      </ObsControlBar>

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
        <ChartContainer title="Daily Executions" chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Executions" />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Executions" />
            </LineChart>
          )}
        </ChartContainer>
      )}

      {data.invocations.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-text-secondary">
            Recent Executions ({filteredInvocations.length}{errorsOnly ? ` of ${data.invocations.length}` : ''})
          </h2>
          <DataTable<InvocationRow>
            data={filteredInvocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
            rowClassName={(row) => row.isError ? 'bg-error/5' : undefined}
          />
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
