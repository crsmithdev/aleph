import { useState } from 'react';
import { BarChart, Bar, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { curveCardinal } from 'd3-shape';
import { useObsSessions, useObsSubagents, useObsCost } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { useNavigate } from 'react-router-dom';
import { fmtNumber, fmtMs, fmtCurrency, shortDate, shortRelativeTime, fmtProject, fmtDuration, fmtSeriesName, stripMarkdown } from '../../../utils/format';
import { clsx } from 'clsx';

type SessionDataset = 'sessions' | 'dispatches' | 'cost' | 'churn' | 'by-project' | 'commits';
const SESSION_DATASETS: { key: SessionDataset; label: string }[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'dispatches', label: 'Dispatches' },
  { key: 'cost', label: 'Cost' },
  { key: 'churn', label: 'Code Churn' },
  { key: 'by-project', label: 'By Project' },
  { key: 'commits', label: 'Commits' },
];

function topProjectKeys(days: Array<{ projects?: Record<string, number> }>, n = 10): string[] {
  const totals: Record<string, number> = {};
  for (const day of days) for (const [k, v] of Object.entries(day.projects ?? {})) {
    totals[k] = (totals[k] ?? 0) + v;
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}
function stackProjectsByDay(days: Array<{ date: string; projects?: Record<string, number> }>, keys: string[]): Record<string, unknown>[] {
  return days.map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const k of keys) entry[k] = (day.projects ?? {})[k] ?? 0;
    return entry;
  });
}
const GRAN_LABEL: Record<string, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };

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
  gateInfo?: { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; mode: 'dispatched' | 'inline' | 'none' };
  firstUserMessage?: string;
};

export function SessionsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsSessions(range, granularity);
  const subagents = useObsSubagents(range, granularity);
  const cost = useObsCost(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [dataset, setDataset] = useState<SessionDataset>('sessions');
  const [includeChildSubagents, setIncludeChildSubagents] = useState(false);
  const [onlyWithSubagents, setOnlyWithSubagents] = useState(false);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load sessions" retry={refetch} />;

  const childCount = data.sessions.filter(s => s.parentSessionId).length;
  const spawnerCount = data.sessions.filter(s => s.hasSubagents && !s.parentSessionId).length;
  let filteredSessions = data.sessions;
  if (!includeChildSubagents) filteredSessions = filteredSessions.filter(s => !s.parentSessionId);
  if (onlyWithSubagents) filteredSessions = filteredSessions.filter(s => s.hasSubagents);

  const maxMessages = Math.max(1, ...data.byDay.map(d => (d.userMessages ?? 0) + (d.assistantMessages ?? 0)));
  const maxSessions = Math.max(1, ...data.byDay.map(d => d.sessions ?? 0));

  // By-project stacked data
  const byDayProject = data.byDayProject ?? [];
  const topProjectNames = topProjectKeys(byDayProject);
  const stackedByProject = stackProjectsByDay(byDayProject, topProjectNames);

  const chartTitles: Record<SessionDataset, string> = {
    sessions: `${GRAN_LABEL[granularity]} Sessions by Day`,
    dispatches: `${GRAN_LABEL[granularity]} Dispatches by Type`,
    cost: `${GRAN_LABEL[granularity]} Cost by Day`,
    churn: `${GRAN_LABEL[granularity]} Code Churn by Day`,
    'by-project': `${GRAN_LABEL[granularity]} Sessions by Project`,
    commits: `${GRAN_LABEL[granularity]} Commits by Day`,
  };

  const sessionColumns: Column<SessionRow>[] = [
    {
      key: 'project',
      label: 'Conversation',
      sortable: true,
      render: (row) => (
        <div className="flex flex-col gap-0.5 min-w-0">
          {row.firstUserMessage && !row.firstUserMessage.startsWith('Caveat:') && (
            <span className="text-text-primary text-base truncate">
              {row.parentSessionId && <span className="text-text-muted mr-1">↳</span>}
              {(() => { const t = stripMarkdown(row.firstUserMessage!); return t.length > 120 ? t.slice(0, 120) + '…' : t; })()}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'gitBranch',
      label: 'Project',
      shrink: true,
      render: (row) => (
        <span className="text-text-secondary text-base truncate block" title={row.project}>
          {fmtProject(row.project)}
        </span>
      ),
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      sortable: true,
      shrink: true,
      render: (row) => <span className="font-mono text-base text-text-secondary whitespace-nowrap">{fmtDuration(row.durationMs)}</span>,
    },
    {
      key: 'userMessages',
      label: 'Messages',
      align: 'right',
      sortable: true,
      shrink: true,
      render: (row) => (
        <span className="font-mono text-base whitespace-nowrap">
          <span className="text-text-secondary">{fmtNumber(row.userMessages + row.assistantMessages)}</span>
          <span className="text-text-disabled ml-1">({fmtNumber(row.assistantMessages)} / {fmtNumber(row.userMessages)})</span>
        </span>
      ),
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      sortable: true,
      shrink: true,
      render: (row) => <span className="font-mono text-base text-text-secondary">{fmtCurrency(row.cost)}</span>,
    },
    {
      key: 'lastTimestamp',
      label: 'Last',
      sortable: true,
      shrink: true,
      render: (row) => <span className="text-text-secondary text-base whitespace-nowrap">{shortRelativeTime(row.lastTimestamp)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="font-heading text-2xl font-bold text-text-primary">Sessions</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Sessions" value={fmtNumber(data.sessions.length)} />
        <StatCard label="Avg Duration" value={fmtDuration(data.avgDurationMs)} />
        <StatCard label="Messages" value={fmtNumber(data.totalUserMessages + data.totalAssistantMessages)} />
        {subagents.data && (
          <>
            <StatCard label="Dispatches" value={fmtNumber(subagents.data.totalDispatches)} />
            <StatCard label="Spawner Sessions" value={fmtNumber(subagents.data.parentSessionCount)} />
          </>
        )}
        <StatCard label="Avg Dispatch" value={subagents.data ? fmtMs(subagents.data.avgMs) : '—'} />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-text-muted">Dataset</span>
        <div className="flex items-center gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
          {SESSION_DATASETS.map(d => (
            <button
              key={d.key}
              onClick={() => setDataset(d.key)}
              className={clsx(
                'px-3 py-1 text-xs rounded transition-colors whitespace-nowrap',
                dataset === d.key
                  ? 'bg-bg-secondary text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 items-stretch h-[320px]">
        <div className="flex-1 min-w-0 h-full">
          <ChartContainer
            title={chartTitles[dataset]}
            chartType={chartType}
            onChartTypeChange={setChartType}
            fill
            className="h-full"
          >
            {dataset === 'dispatches' ? (
              chartType === 'bar' ? (
                <BarChart data={subagents.data?.byDay ?? []}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Bar dataKey="foregroundCount" stackId="d" fill={CHART_PALETTE[0]} radius={[0, 0, 0, 0]} name="Foreground" />
                  <Bar dataKey="backgroundCount" stackId="d" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Background" />
                </BarChart>
              ) : (
                <ComposedChart data={subagents.data?.byDay ?? []}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Area type={curveCardinal.tension(0.5) as any} dataKey="foregroundCount" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Foreground" />
                  <Area type={curveCardinal.tension(0.5) as any} dataKey="backgroundCount" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Background" />
                </ComposedChart>
              )
            ) : dataset === 'cost' ? (
              chartType === 'bar' ? (
                <BarChart data={data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtCurrency(Number(v)), 'Cost']} />
                  <Bar dataKey="cost" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Cost" />
                </BarChart>
              ) : (
                <ComposedChart data={data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtCurrency(Number(v)), 'Cost']} />
                  <Area type={curveCardinal.tension(0.5) as any} dataKey="cost" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Cost" />
                </ComposedChart>
              )
            ) : dataset === 'churn' ? (
              chartType === 'bar' ? (
                <BarChart data={data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                  <Legend {...legendProps} />
                  <Bar dataKey="linesAdded" stackId="churn" fill={CHART_PALETTE[2]} radius={[0, 0, 0, 0]} name="Added" />
                  <Bar dataKey="linesRemoved" stackId="churn" fill={CHART_PALETTE[4]} radius={[2, 2, 0, 0]} name="Removed" />
                </BarChart>
              ) : (
                <ComposedChart data={data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                  <Legend {...legendProps} />
                  <Area type={curveCardinal.tension(0.5) as any} dataKey="linesAdded" stackId="churn" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Added" />
                  <Area type={curveCardinal.tension(0.5) as any} dataKey="linesRemoved" stackId="churn" stroke={CHART_PALETTE[4]} fill={CHART_PALETTE[4]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Removed" />
                </ComposedChart>
              )
            ) : dataset === 'by-project' ? (
              chartType === 'bar' ? (
                <BarChart data={stackedByProject}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                  {topProjectNames.map((name, i) => (
                    <Bar key={name} dataKey={name} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topProjectNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                  ))}
                </BarChart>
              ) : (
                <ComposedChart data={stackedByProject}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                  {topProjectNames.map((name, i) => (
                    <Area key={name} type={curveCardinal.tension(0.5) as any} dataKey={name} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.15} strokeWidth={2} dot={false} />
                  ))}
                </ComposedChart>
              )
            ) : dataset === 'commits' ? (
              chartType === 'bar' ? (
                <BarChart data={data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Bar dataKey="commits" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Commits" />
                </BarChart>
              ) : (
                <ComposedChart data={data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Area type={curveCardinal.tension(0.5) as any} dataKey="commits" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Commits" />
                </ComposedChart>
              )
            ) : chartType === 'bar' ? (
              <ComposedChart data={data.byDay}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                <YAxis yAxisId="left" {...axisProps} domain={[0, maxMessages]} />
                <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, maxSessions]} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                <Legend {...legendProps} />
                <Bar yAxisId="left" dataKey="userMessages" stackId="msgs" fill={CHART_PALETTE[2]} radius={[0, 0, 0, 0]} name="User Msgs" />
                <Bar yAxisId="left" dataKey="assistantMessages" stackId="msgs" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Assistant Msgs" />
                <Bar yAxisId="right" dataKey="sessions" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Sessions" />
              </ComposedChart>
            ) : (
              <ComposedChart data={data.byDay}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                <YAxis yAxisId="left" {...axisProps} domain={[0, maxMessages]} />
                <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, maxSessions]} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                <Legend {...legendProps} />
                <Area yAxisId="left" type={curveCardinal.tension(0.5) as any} dataKey="userMessages" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="User Msgs" />
                <Area yAxisId="left" type={curveCardinal.tension(0.5) as any} dataKey="assistantMessages" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Assistant Msgs" />
                <Area yAxisId="right" type={curveCardinal.tension(0.5) as any} dataKey="sessions" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Sessions" />
              </ComposedChart>
            )}
          </ChartContainer>
        </div>

        {(() => {
          if (dataset === 'sessions') {
            const top5 = data.byProject.slice(0, 5);
            const other = data.byProject.slice(5).reduce((s, r) => s + r.sessions, 0);
            const donut = other > 0 ? [...top5, { project: 'Other', sessions: other }] : top5;
            if (donut.length === 0) return null;
            return (
              <div className="flex flex-col rounded-lg border border-border-primary bg-bg-secondary p-4 w-[400px] shrink-0 h-full">
                <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">Top Projects</h3>
                <div className="flex-1 min-h-0 flex gap-3">
                  <div className="flex-1 min-w-0 min-h-0 flex items-center">
                    <ResponsiveContainer width="100%" height={212}>
                      <PieChart>
                        <Pie data={donut} dataKey="sessions" nameKey="project" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                          {donut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1.5 justify-center shrink-0 w-36">
                    {donut.map((row: { project: string; sessions: number }, i: number) => (
                      <div key={row.project} className="flex items-center gap-1.5 text-xs min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                        <span className="font-mono text-text-secondary truncate flex-1">{fmtProject(row.project)}</span>
                        <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtNumber(row.sessions)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }
          if (!subagents.data || subagents.data.byType.length === 0) return null;
          const top5 = subagents.data.byType.slice(0, 5);
          const other = subagents.data.byType.slice(5).reduce((s: number, r: { count: number }) => s + r.count, 0);
          const donut = other > 0 ? [...top5, { subagentType: 'Other', count: other }] : top5;
          return (
            <div className="flex flex-col rounded-lg border border-border-primary bg-bg-secondary p-4 w-[400px] shrink-0 h-full">
              <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">Subagents by Type</h3>
              <div className="flex-1 min-h-0 flex gap-3">
                <div className="flex-1 min-w-0 min-h-0 flex items-center">
                  <ResponsiveContainer width="100%" height={212}>
                    <PieChart>
                      <Pie data={donut} dataKey="count" nameKey="subagentType" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                        {donut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1.5 justify-center shrink-0 w-36">
                  {donut.map((row: { subagentType: string; count: number }, i: number) => (
                    <div key={row.subagentType} className="flex items-center gap-1.5 text-xs min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="text-text-secondary truncate flex-1">{fmtSeriesName(row.subagentType)}</span>
                      <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtNumber(row.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="flex items-center gap-2">
        {childCount > 0 && (
          <button
            onClick={() => setIncludeChildSubagents(!includeChildSubagents)}
            className={clsx(
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
            className={clsx(
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

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
