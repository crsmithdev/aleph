import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsToolDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, dateTime, granLabel, fmtToolName } from '../../../utils/format';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; isError?: boolean; errorMessage?: string };

export function ToolDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const toolName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { data, isLoading, error, refetch } = useObsToolDetail(toolName, range);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tool details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errorCount) / data.totalCount) * 100
    : 100;

  const filteredInvocations = errorsOnly
    ? data.invocations.filter((inv: InvocationRow) => inv.isError)
    : data.invocations;

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'project',
      label: 'Project',
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.project}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '90px',
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>,
    },
    ...(data.errorCount > 0 ? [{
      key: 'errorMessage',
      label: 'Error',
      render: (row: InvocationRow) => row.errorMessage
        ? <span className="text-xs text-error truncate block max-w-xs" title={row.errorMessage}>{row.errorMessage.slice(0, 80)}{row.errorMessage.length > 80 ? '...' : ''}</span>
        : <span className="text-text-muted">—</span>,
    }] : []) as Column<InvocationRow>[],
    {
      key: 'params',
      label: 'Params',
      render: (row) => {
        if (!row.params) return <span className="text-text-muted">—</span>;
        const key = `${row.timestamp}-${row.sessionId}`;
        const isExpanded = expandedRow === key;
        const preview = JSON.stringify(row.params);
        const short = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : key); }}
            className="w-full text-left font-mono text-xs text-text-muted hover:text-text-primary"
          >
            {isExpanded ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(row.params, null, 2)}</pre>
            ) : (
              <span className="block truncate">{short}</span>
            )}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <div className="flex items-center gap-3">
            <Link
              to="/observability/tools"
              className="text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              &larr; Tools
            </Link>
            <h1 className="text-2xl font-bold font-mono text-text-primary">{fmtToolName(toolName!)}</h1>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      >
        {data.errorCount > 0 && (
          <FilterToggle
            label="Errors only"
            active={errorsOnly}
            onToggle={() => setErrorsOnly(!errorsOnly)}
            activeColor="error"
          />
        )}
      </ObsControlBar>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(data.totalCount)} />
        <StatCard
          label="Errors"
          value={fmtNumber(data.errorCount)}
          accent={data.errorCount > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {data.byDay.length > 0 && (
        <ChartContainer title={granLabel(granularity, "Usage")} chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Calls" />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Calls" />
            </LineChart>
          )}
        </ChartContainer>
      )}

      {data.invocations.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            Recent Invocations ({filteredInvocations.length}{errorsOnly ? ` of ${data.invocations.length}` : ''})
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
