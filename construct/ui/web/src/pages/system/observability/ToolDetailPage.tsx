import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsToolDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, shortDate, dateTime } from '../../../utils/format';

type InvocationRow = { timestamp: string; sessionId: string; project: string };

export function ToolDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const toolName = decodeURIComponent(rawName ?? '');
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useObsToolDetail(toolName, days);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tool details" retry={refetch} />;

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
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.sessionId.slice(0, 8)}</span>,
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

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(data.totalCount)} />
        <StatCard
          label="Errors"
          value={fmtNumber(data.errorCount)}
          accent={data.errorCount > 0 ? 'error' : 'default'}
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
          <h2 className="mb-3 text-sm font-medium text-text-secondary">
            Recent Invocations ({data.invocations.length})
          </h2>
          <DataTable<InvocationRow>
            data={data.invocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
          />
        </div>
      )}
    </div>
  );
}
