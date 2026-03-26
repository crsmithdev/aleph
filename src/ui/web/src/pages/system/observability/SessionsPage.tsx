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
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { useNavigate } from 'react-router-dom';
import { fmtNumber, fmtMs, fmtCurrency, shortDate, granLabel, relativeTime } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type ProjectRow = { project: string; sessions: number };
type ActivityRow = { date: string; count: number };
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
  parentSessionId?: string;
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
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsSessions(range, granularity);
  const { chartType, setChartType } = useChartType('bar');
  const [includeChildSubagents, setIncludeChildSubagents] = useState(false);
  const [onlyWithSubagents, setOnlyWithSubagents] = useState(false);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load sessions" retry={refetch} />;

  const childCount = data.sessions.filter(s => s.parentSessionId).length;
  const spawnerCount = data.sessions.filter(s => s.hasSubagents && !s.parentSessionId).length;
  let filteredSessions = data.sessions;
  if (!includeChildSubagents) filteredSessions = filteredSessions.filter(s => !s.parentSessionId);
  if (onlyWithSubagents) filteredSessions = filteredSessions.filter(s => s.hasSubagents);

  const activityData: ActivityRow[] = data.byActivity;

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
      render: (row) => (
        <span className="font-mono text-text-primary text-xs">
          {row.parentSessionId && <span className="text-text-muted mr-1">↳</span>}
          {row.project}
        </span>
      ),
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
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Sessions</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Sessions" value={fmtNumber(data.sessions.length)} />
        <StatCard label="Avg Duration" value={fmtDuration(data.avgDurationMs)} />
        <StatCard label="User Messages" value={fmtNumber(data.totalUserMessages)} />
        <StatCard label="Assistant Messages" value={fmtNumber(data.totalAssistantMessages)} />
        <StatCard label="Lines Changed" value={<><span className="text-green-400">+{fmtNumber(data.totalLinesAdded)}</span><span className="text-text-muted"> / </span><span className="text-red-400">-{fmtNumber(data.totalLinesRemoved)}</span></>} />
        <StatCard label="Commits" value={fmtNumber(data.totalCommits)} />
      </div>

      <ChartContainer title={granLabel(granularity, "Sessions")} chartType={chartType} onChartTypeChange={setChartType}>
        {chartType === 'bar' ? (
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Legend {...legendProps} />
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
            <Legend {...legendProps} />
            <Line type="monotone" dataKey="sessions" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Sessions" />
            <Line type="monotone" dataKey="userMessages" stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} name="User Msgs" />
            <Line type="monotone" dataKey="assistantMessages" stroke={CHART_PALETTE[1]} strokeWidth={2} dot={false} name="Assistant Msgs" />
          </LineChart>
        )}
      </ChartContainer>

      <ChartContainer title={granLabel(granularity, "Activity")}>
        <BarChart data={activityData}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
          <Bar dataKey="count" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="Events" />
        </BarChart>
      </ChartContainer>

      <div className="flex items-center gap-2">
        {childCount > 0 && (
          <button
            onClick={() => setIncludeChildSubagents(!includeChildSubagents)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-xs border transition-colors',
              includeChildSubagents
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border-primary bg-bg-secondary text-text-muted',
            )}
          >
            Subagent
            <span className="text-text-disabled">({childCount})</span>
          </button>
        )}
        {spawnerCount > 0 && (
          <button
            onClick={() => setOnlyWithSubagents(!onlyWithSubagents)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-xs border transition-colors',
              onlyWithSubagents
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border-primary bg-bg-secondary text-text-muted',
            )}
          >
            Dispatcher
            <span className="text-text-disabled">({spawnerCount})</span>
          </button>
        )}
      </div>

      <DataTable<SessionRow>
        data={filteredSessions.slice(0, 50)}
        columns={sessionColumns}
        keyField="sessionId"
        onRowClick={(row) => navigate(`/observability/sessions/${encodeURIComponent(row.sessionId)}`)}
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
