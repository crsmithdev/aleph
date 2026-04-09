import { useState } from 'react';
import { BarChart, Bar, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { curveCardinal } from 'd3-shape';
import { useObsSessions, useObsSubagents, useObsCost } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { useNavigate } from 'react-router-dom';
import { fmtNumber, fmtMs, fmtCurrency, fmtDuration, fmtLegendLabel, formatModelName, stripMarkdown, fmtProject, shortRelativeTime } from '../../../utils/format';
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

  const distTitles: Record<SessionDataset, string> = {
    sessions: 'Top Projects',
    dispatches: 'Subagents by Type',
    cost: 'Cost by Model',
    churn: 'Top Sessions by Churn',
    'by-project': 'Top Projects',
    commits: 'Top Sessions by Commits',
  };

  function getLegendKeys(): { name: string; color: string }[] {
    if (dataset === 'sessions') {
      return [
        { name: 'User Msgs', color: CHART_PALETTE[2] },
        { name: 'Assistant Msgs', color: CHART_PALETTE[1] },
        { name: 'Sessions', color: CHART_PALETTE[0] },
      ];
    }
    if (dataset === 'dispatches') {
      return [
        { name: 'Foreground', color: CHART_PALETTE[0] },
        { name: 'Background', color: CHART_PALETTE[1] },
      ];
    }
    if (dataset === 'cost') {
      return [{ name: 'Cost', color: CHART_PALETTE[3] }];
    }
    if (dataset === 'churn') {
      return [
        { name: 'Added', color: CHART_PALETTE[2] },
        { name: 'Removed', color: CHART_PALETTE[4] },
      ];
    }
    if (dataset === 'by-project') {
      return topProjectNames.map((name, i) => ({ name: fmtLegendLabel(name), color: CHART_PALETTE[i % CHART_PALETTE.length] }));
    }
    if (dataset === 'commits') {
      return [{ name: 'Commits', color: CHART_PALETTE[1] }];
    }
    return [];
  }

  const activeFilterCount = (includeChildSubagents ? 1 : 0) + (onlyWithSubagents ? 1 : 0);

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
      label: 'Last Used',
      sortable: true,
      width: '100px',
      render: (row) => <span className="text-text-secondary text-base whitespace-nowrap">{shortRelativeTime(row.lastTimestamp)}</span>,
    },
  ];

  const hasFilters = childCount > 0 || spawnerCount > 0;

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="font-heading text-2xl font-bold text-text-primary">Sessions</h1>}
        datasets={SESSION_DATASETS}
        dataset={dataset}
        onDatasetChange={(d) => setDataset(d as SessionDataset)}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
        filters={hasFilters ? (
          <>
            {childCount > 0 && (
              <FilterToggle
                label={`Subagent (${childCount})`}
                active={includeChildSubagents}
                onToggle={() => setIncludeChildSubagents(!includeChildSubagents)}
              />
            )}
            {spawnerCount > 0 && (
              <FilterToggle
                label={`Dispatcher (${spawnerCount})`}
                active={onlyWithSubagents}
                onToggle={() => setOnlyWithSubagents(!onlyWithSubagents)}
              />
            )}
          </>
        ) : undefined}
        activeFilterCount={activeFilterCount}
      />

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
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

      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
        <div className="flex-1 min-h-0 flex">
          {/* Left: Time series */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h3 className="text-sm font-medium text-text-secondary">{chartTitles[dataset]}</h3>
              <div className="flex gap-1">
                {(['line', 'bar'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    className={clsx(
                      'px-2 py-0.5 text-xs rounded transition-colors',
                      chartType === t ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-1" />
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                {dataset === 'dispatches' ? (
                  chartType === 'bar' ? (
                    <BarChart data={subagents.data?.byDay ?? []}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Bar dataKey="foregroundCount" stackId="d" fill={CHART_PALETTE[0]} radius={[0, 0, 0, 0]} name="Foreground" />
                      <Bar dataKey="backgroundCount" stackId="d" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Background" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={subagents.data?.byDay ?? []}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Area type={curveCardinal.tension(0.5) as any} dataKey="foregroundCount" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Foreground" />
                      <Area type={curveCardinal.tension(0.5) as any} dataKey="backgroundCount" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Background" />
                    </ComposedChart>
                  )
                ) : dataset === 'cost' ? (
                  chartType === 'bar' ? (
                    <BarChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtCurrency(Number(v)), 'Cost']} />
                      <Bar dataKey="cost" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Cost" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtCurrency(Number(v)), 'Cost']} />
                      <Area type={curveCardinal.tension(0.5) as any} dataKey="cost" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Cost" />
                    </ComposedChart>
                  )
                ) : dataset === 'churn' ? (
                  chartType === 'bar' ? (
                    <BarChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Bar dataKey="linesAdded" stackId="churn" fill={CHART_PALETTE[2]} radius={[0, 0, 0, 0]} name="Added" />
                      <Bar dataKey="linesRemoved" stackId="churn" fill={CHART_PALETTE[4]} radius={[2, 2, 0, 0]} name="Removed" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Area type={curveCardinal.tension(0.5) as any} dataKey="linesAdded" stackId="churn" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Added" />
                      <Area type={curveCardinal.tension(0.5) as any} dataKey="linesRemoved" stackId="churn" stroke={CHART_PALETTE[4]} fill={CHART_PALETTE[4]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Removed" />
                    </ComposedChart>
                  )
                ) : dataset === 'by-project' ? (
                  chartType === 'bar' ? (
                    <BarChart data={stackedByProject}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      {topProjectNames.map((name, i) => (
                        <Bar key={name} dataKey={name} name={fmtLegendLabel(name)} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topProjectNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : (
                    <ComposedChart data={stackedByProject}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      {topProjectNames.map((name, i) => (
                        <Area key={name} type={curveCardinal.tension(0.5) as any} dataKey={name} name={fmtLegendLabel(name)} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.15} strokeWidth={2} dot={false} />
                      ))}
                    </ComposedChart>
                  )
                ) : dataset === 'commits' ? (
                  chartType === 'bar' ? (
                    <BarChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Bar dataKey="commits" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Commits" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Area type={curveCardinal.tension(0.5) as any} dataKey="commits" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Commits" />
                    </ComposedChart>
                  )
                ) : chartType === 'bar' ? (
                  <ComposedChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis yAxisId="left" {...axisProps} domain={[0, maxMessages]} />
                    <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, maxSessions]} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Bar yAxisId="left" dataKey="userMessages" stackId="msgs" fill={CHART_PALETTE[2]} radius={[0, 0, 0, 0]} name="User Msgs" />
                    <Bar yAxisId="left" dataKey="assistantMessages" stackId="msgs" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Assistant Msgs" />
                    <Bar yAxisId="right" dataKey="sessions" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Sessions" />
                  </ComposedChart>
                ) : (
                  <ComposedChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis yAxisId="left" {...axisProps} domain={[0, maxMessages]} />
                    <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, maxSessions]} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area yAxisId="left" type={curveCardinal.tension(0.5) as any} dataKey="userMessages" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="User Msgs" />
                    <Area yAxisId="left" type={curveCardinal.tension(0.5) as any} dataKey="assistantMessages" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Assistant Msgs" />
                    <Area yAxisId="right" type={curveCardinal.tension(0.5) as any} dataKey="sessions" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Sessions" />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="w-px bg-border-primary shrink-0 mx-5" />

          {/* Right: Distribution */}
          <div className="w-[360px] shrink-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="text-sm font-medium text-text-secondary">{distTitles[dataset]}</h3>
            </div>

            {(dataset === 'sessions' || dataset === 'by-project') && (() => {
              const top5 = data.byProject.slice(0, 5);
              const other = data.byProject.slice(5).reduce((s, r) => s + r.sessions, 0);
              const donut = other > 0 ? [...top5, { project: 'Other', sessions: other }] : top5;
              if (donut.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No data</div>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="sessions" nameKey="project" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                        {donut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'dispatches' && (() => {
              if (!subagents.data || subagents.data.byType.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No data</div>;
              const top5 = subagents.data.byType.slice(0, 5);
              const other = subagents.data.byType.slice(5).reduce((s: number, r: { count: number }) => s + r.count, 0);
              const donut = other > 0 ? [...top5, { subagentType: 'Other', count: other }] : top5;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="count" nameKey="subagentType" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                        {donut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'cost' && (() => {
              if (!cost.data || cost.data.byModel.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No data</div>;
              const top5 = cost.data.byModel.slice(0, 5);
              const otherUsd = cost.data.byModel.slice(5).reduce((s, r) => s + r.usd, 0);
              const donut = otherUsd > 0 ? [...top5, { model: 'Other', usd: otherUsd, pct: 0 }] : top5;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="usd" nameKey="model" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                        {donut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtCurrency(Number(v)), formatModelName(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'churn' && (() => {
              const topChurn = [...filteredSessions]
                .map(s => ({ ...s, totalChurn: s.linesAdded + s.linesRemoved }))
                .filter(s => s.totalChurn > 0)
                .sort((a, b) => b.totalChurn - a.totalChurn)
                .slice(0, 10);
              if (topChurn.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No churn data</div>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={topChurn}>
                      <CartesianGrid {...gridProps} horizontal={false} />
                      <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                      <YAxis type="category" dataKey="sessionId" {...axisProps} width={60} tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(0, 8)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Bar dataKey="linesAdded" stackId="a" fill={CHART_PALETTE[2]} name="Added" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="linesRemoved" stackId="a" fill={CHART_PALETTE[4]} name="Removed" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'commits' && (() => {
              const topCommits = [...filteredSessions]
                .filter(s => s.commits > 0)
                .sort((a, b) => b.commits - a.commits)
                .slice(0, 10);
              if (topCommits.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No commits data</div>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={topCommits}>
                      <CartesianGrid {...gridProps} horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="sessionId" {...axisProps} width={60} tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(0, 8)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtNumber(Number(v)), 'Commits']} />
                      <Bar dataKey="commits" fill={CHART_PALETTE[1]} name="Commits" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Shared legend */}
        <div className="flex items-center justify-center gap-4 mt-4 mb-1 text-xs shrink-0 flex-wrap">
          {getLegendKeys().map(({ name, color }) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="font-mono text-text-secondary">{name}</span>
            </span>
          ))}
        </div>
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
