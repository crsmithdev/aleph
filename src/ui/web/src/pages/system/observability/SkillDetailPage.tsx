import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsSkillDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, dateTime } from '../../../utils/format';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown> };

export function SkillDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const skillName = decodeURIComponent(rawName ?? '');
  const [days, setDays] = useState(30);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useObsSkillDetail(skillName, days);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skill details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errorCount) / data.totalCount) * 100
    : 100;

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
    {
      key: 'params',
      label: 'Params',
      width: '300px',
      render: (row) => {
        if (!row.params) return <span className="text-text-muted">-</span>;
        const isExpanded = expandedRow === row.timestamp;
        const preview = JSON.stringify(row.params);
        const short = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setExpandedRow(isExpanded ? null : row.timestamp); }}
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
      <ObsControlBar days={days} onDaysChange={setDays}>
        <Link
          to="/system/observability/skills"
          className="text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          &larr; Skills
        </Link>
        <h1 className="text-xl font-semibold font-mono text-text-primary">{skillName}</h1>
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
        <ChartContainer title="Daily Usage">
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="count" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Invocations" />
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

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
