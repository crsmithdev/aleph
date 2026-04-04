import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { useObsToolDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, dateTime, granLabel, fmtToolName, fmtProject } from '../../../utils/format';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { clsx } from 'clsx';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; isError?: boolean; errorMessage?: string };

export function ToolDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const toolName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { data, isLoading, error, refetch } = useObsToolDetail(toolName, range);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tool details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errorCount) / data.totalCount) * 100
    : 100;

  const filteredInvocations = errorsOnly
    ? data.invocations.filter((inv: InvocationRow) => inv.isError)
    : data.invocations;

  // Build per-project breakdown from invocations
  const projectTotals: Record<string, number> = {};
  const byDayProject: Record<string, Record<string, number>> = {};
  for (const inv of data.invocations) {
    const proj = fmtProject(inv.project);
    projectTotals[proj] = (projectTotals[proj] ?? 0) + 1;
    const dateKey = inv.timestamp.slice(0, 10);
    if (!byDayProject[dateKey]) byDayProject[dateKey] = {};
    byDayProject[dateKey][proj] = (byDayProject[dateKey][proj] ?? 0) + 1;
  }

  const projectNames = Object.entries(projectTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const stackedByDay = data.byDay.map((day) => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of projectNames) {
      entry[name] = (byDayProject[day.date] ?? {})[name] ?? 0;
    }
    return entry;
  });

  const donutData = projectNames.map((name) => ({ name, value: projectTotals[name] }));

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'project',
      label: 'Project',
      render: (row) => <span className="font-mono text-xs text-text-muted">{fmtProject(row.project)}</span>,
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
      key: 'duration',
      label: 'Duration',
      align: 'right',
      render: () => <span className="text-text-tertiary">—</span>,
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
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-secondary">{granLabel(granularity, 'Usage')}</h3>
            <div className="flex gap-1">
              {(['bar', 'line'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setChartType(t)}
                  className={clsx(
                    'px-2 py-0.5 text-xs rounded font-mono transition-colors',
                    chartType === t
                      ? 'bg-accent/20 text-accent'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-stretch gap-4">
            <div className="flex-1 min-w-0">
              {chartType === 'bar' ? (
                <BarChart width={undefined as unknown as number} height={220} data={stackedByDay} style={{ width: '100%' }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  {projectNames.length > 0 ? projectNames.map((name, i) => (
                    <Bar key={name} dataKey={name} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === projectNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                  )) : (
                    <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Calls" />
                  )}
                </BarChart>
              ) : (
                <AreaChart width={undefined as unknown as number} height={220} data={stackedByDay} style={{ width: '100%' }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  {projectNames.length > 0 ? projectNames.map((name, i) => (
                    <Area key={name} type="monotone" dataKey={name} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.4} strokeWidth={1.5} dot={false} />
                  )) : (
                    <Area type="monotone" dataKey="count" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.4} strokeWidth={2} dot={false} name="Calls" />
                  )}
                </AreaChart>
              )}
            </div>

            {donutData.length > 0 && (
              <div className="shrink-0 flex flex-col items-center" style={{ width: 160 }}>
                <PieChart width={140} height={140}>
                  <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={60}>
                    {donutData.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                </PieChart>
                <div className="flex flex-col gap-1 mt-2 w-full">
                  {donutData.slice(0, 6).map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="font-mono text-text-muted truncate">{d.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
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
            expandedKey={expandedRow}
            onExpandToggle={(key) => setExpandedRow(key === expandedRow ? null : key)}
            renderExpanded={(row) => {
              if (!row.params) return <p className="text-xs text-text-muted font-mono">No params</p>;
              return (
                <pre className="text-xs font-mono text-text-secondary max-h-60 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(row.params, null, 2)}
                </pre>
              );
            }}
          />
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
