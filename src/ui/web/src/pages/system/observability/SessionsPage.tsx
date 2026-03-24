import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useObsSessions } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { fmtNumber, fmtMs, fmtCurrency, shortDate, granLabel, relativeTime } from '../../../utils/format';

type ProjectRow = { project: string; sessions: number };
type HourRow = { hour: number; count: number };
type SessionRow = {
  sessionId: string;
  project: string;
  durationMs: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  cost: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  compactions: number;
  firstTimestamp: string;
  lastTimestamp: string;
  gitBranch?: string;
};

function fmtDuration(ms: number): string {
  if (ms < 60000) return fmtMs(ms);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function SessionsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsSessions(range, granularity);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load sessions" retry={refetch} />;

  const hourData: HourRow[] = data.byHour.map((h) => ({
    ...h,
    label: `${String(h.hour).padStart(2, '0')}:00`,
  }));

  const projectColumns: Column<ProjectRow>[] = [
    {
      key: 'project',
      label: 'Project',
      render: (row) => <span className="font-mono text-text-primary">{row.project}</span>,
    },
    {
      key: 'sessions',
      label: 'Sessions',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.sessions),
    },
  ];

  const sessionColumns: Column<SessionRow>[] = [
    {
      key: 'lastTimestamp',
      label: 'Last Active',
      sortable: true,
      render: (row) => <span className="text-text-secondary text-xs">{relativeTime(row.lastTimestamp)}</span>,
    },
    {
      key: 'project',
      label: 'Project',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.project}</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      sortable: true,
      render: (row) => fmtDuration(row.durationMs),
    },
    {
      key: 'userMessages',
      label: 'User',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.userMessages),
    },
    {
      key: 'assistantMessages',
      label: 'Assistant',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.assistantMessages),
    },
    {
      key: 'toolCalls',
      label: 'Tools',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.toolCalls),
    },
    {
      key: 'linesAdded',
      label: 'Lines',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span>
          {row.linesAdded > 0 && <span className="text-green-400">+{fmtNumber(row.linesAdded)}</span>}
          {row.linesAdded > 0 && row.linesRemoved > 0 && ' '}
          {row.linesRemoved > 0 && <span className="text-red-400">-{fmtNumber(row.linesRemoved)}</span>}
          {!row.linesAdded && !row.linesRemoved && <span className="text-text-tertiary">—</span>}
        </span>
      ),
    },
    {
      key: 'commits',
      label: 'Commits',
      align: 'right',
      sortable: true,
      render: (row) => row.commits > 0 ? fmtNumber(row.commits) : <span className="text-text-tertiary">—</span>,
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      sortable: true,
      render: (row) => fmtCurrency(row.cost),
    },
    {
      key: 'gitBranch',
      label: 'Branch',
      render: (row) => row.gitBranch ? <span className="font-mono text-text-secondary text-xs">{row.gitBranch}</span> : <span className="text-text-tertiary">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-xl font-semibold text-text-primary">Sessions</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Sessions" value={fmtNumber(data.sessions.length)} />
        <StatCard label="Avg Duration" value={fmtDuration(data.avgDurationMs)} />
        <StatCard label="User Messages" value={fmtNumber(data.totalUserMessages)} />
        <StatCard label="Assistant Messages" value={fmtNumber(data.totalAssistantMessages)} />
        <StatCard label="Lines Changed" value={`+${fmtNumber(data.totalLinesAdded)} / -${fmtNumber(data.totalLinesRemoved)}`} />
        <StatCard label="Commits" value={fmtNumber(data.totalCommits)} />
      </div>

      <ChartContainer title={granLabel(granularity, "Sessions")} chartType={chartType} onChartTypeChange={setChartType}>
        {chartType === 'bar' ? (
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Legend />
            <Bar dataKey="sessions" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Sessions" />
            <Bar dataKey="userMessages" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="User Msgs" />
            <Bar dataKey="assistantMessages" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Assistant Msgs" />
          </BarChart>
        ) : (
          <LineChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Legend />
            <Line type="monotone" dataKey="sessions" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Sessions" />
            <Line type="monotone" dataKey="userMessages" stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} name="User Msgs" />
            <Line type="monotone" dataKey="assistantMessages" stroke={CHART_PALETTE[1]} strokeWidth={2} dot={false} name="Assistant Msgs" />
          </LineChart>
        )}
      </ChartContainer>

      <ChartContainer title="Activity by Hour">
        <BarChart data={hourData}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Bar dataKey="count" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="Events" />
        </BarChart>
      </ChartContainer>

      <DataTable<SessionRow>
        data={data.sessions.slice(0, 50)}
        columns={sessionColumns}
        keyField="sessionId"
      />

      <DataTable<ProjectRow>
        data={data.byProject}
        columns={projectColumns}
        keyField="project"
      />

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
