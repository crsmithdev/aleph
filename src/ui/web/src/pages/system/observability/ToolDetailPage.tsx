import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsToolDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, dateTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; isError?: boolean; errorMessage?: string };

export function ToolDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const toolName = decodeURIComponent(rawName ?? '');
  const [days, setDays] = useState(30);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { data, isLoading, error, refetch } = useObsToolDetail(toolName, days);

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
      key: 'status',
      label: '',
      width: '2rem',
      render: (row) => row.isError
        ? <span className="inline-block w-2 h-2 rounded-full bg-error" title="Error" />
        : <span className="inline-block w-2 h-2 rounded-full bg-success/50" />,
    },
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
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>,
    },
    ...(data.errorCount > 0 ? [{
      key: 'errorMessage',
      label: 'Error',
      render: (row: InvocationRow) => row.errorMessage
        ? <span className="text-xs text-error truncate block max-w-xs" title={row.errorMessage}>{row.errorMessage.slice(0, 80)}{row.errorMessage.length > 80 ? '...' : ''}</span>
        : <span className="text-text-muted">-</span>,
    }] : []) as Column<InvocationRow>[],
    {
      key: 'params',
      label: 'Params',
      render: (row) => {
        if (!row.params) return <span className="text-text-muted">-</span>;
        const key = `${row.timestamp}-${row.sessionId}`;
        const isExpanded = expandedRow === key;
        const preview = JSON.stringify(row.params);
        const short = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : key); }}
            className="text-left font-mono text-xs text-text-muted hover:text-text-primary"
          >
            {isExpanded ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(row.params, null, 2)}</pre>
            ) : (
              short
            )}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/system/observability/tools"
            className="text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            &larr; Tools
          </Link>
          <h1 className="text-xl font-semibold font-mono text-text-primary">{toolName}</h1>
        </div>
        <TimeRangeSelector value={days} onChange={setDays} />
      </div>

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
        <ChartContainer title="Daily Usage">
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Calls" />
          </BarChart>
        </ChartContainer>
      )}

      {data.invocations.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-secondary">
              Recent Invocations ({filteredInvocations.length}{errorsOnly ? ` of ${data.invocations.length}` : ''})
            </h2>
            <div className="flex items-center gap-3">
              {data.errorCount > 0 && (
                <button
                  onClick={() => setErrorsOnly(!errorsOnly)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md border transition-colors',
                    errorsOnly
                      ? 'bg-error/10 border-error text-error'
                      : 'bg-bg-tertiary border-border-primary text-text-muted hover:text-text-secondary'
                  )}
                >
                  {errorsOnly ? 'Showing errors' : 'Errors only'}
                </button>
              )}
            </div>
          </div>
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
