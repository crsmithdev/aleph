import { useState } from 'react';
import { BarChart, Bar, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { curveCardinal } from 'd3-shape';
import { useObsSessions, useObsSubagents, useObsCost } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle, type DatasetDisplayMode } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, CHART_OTHER, chartColor, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
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

function topProjectKeys(days: Array<{ projects?: Record<string, number> }>, n: number, mode: DatasetDisplayMode): string[] {
  const totals: Record<string, number> = {};
  for (const day of days) for (const [k, v] of Object.entries(day.projects ?? {})) {
    totals[k] = (totals[k] ?? 0) + v;
  }
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (mode === 'all') return ranked.map(([k]) => k);
  const top = ranked.slice(0, n).map(([k]) => k);
  if (mode === 'top-n-other' && ranked.length > n) top.push('Other');
  return top;
}
function stackProjectsByDay(days: Array<{ date: string; projects?: Record<string, number> }>, keys: string[], mode: DatasetDisplayMode): Record<string, unknown>[] {
  const hasOther = mode === 'top-n-other' && keys.includes('Other');
  const realKeys = keys.filter(k => k !== 'Other');
  return days.map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    const source = day.projects ?? {};
    for (const k of realKeys) entry[k] = source[k] ?? 0;
    if (hasOther) {
      let other = 0;
      for (const [k, v] of Object.entries(source)) {
        if (!realKeys.includes(k)) other += v;
      }
      entry['Other'] = other;
    }
    return entry;
  });
}
function sliceRanked<T extends Record<string, unknown>>(items: T[], valueKey: string, n: number, mode: DatasetDisplayMode): T[] {
  if (mode === 'all') return items;
  const top = items.slice(0, n);
  if (mode === 'top-n' || items.length <= n) return top;
  const rest = items.slice(n);
  const otherValue = rest.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0);
  if (otherValue === 0) return top;
  const other = { ...Object.fromEntries(Object.keys(items[0] ?? {}).map(k => [k, k === valueKey ? otherValue : 'Other'])) } as unknown as T;
  return [...top, other];
}
import { GRAN_LABEL } from '../../../utils/chart-helpers';

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
  gateInfo?: { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; hookBlocks: number; hookAdvisories: number; mode: 'dispatched' | 'inline' | 'none' };
  firstUserMessage?: string;
  intent?: string;
  outcome?: string;
};

export function SessionsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsSessions(range, granularity);
  const subagents = useObsSubagents(range, granularity);
  const cost = useObsCost(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [distChartType, setDistChartType] = useState<'donut' | 'bar'>('donut');
  const [dataset, setDataset] = useState<SessionDataset>('sessions');
  const [includeChildSubagents, setIncludeChildSubagents] = useState(false);
  const [onlyWithSubagents, setOnlyWithSubagents] = useState(false);
  const [displayMode, setDisplayMode] = useState<DatasetDisplayMode>('top-n-other');
  const [displayN, setDisplayN] = useState(10);

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
  const topProjectNames = topProjectKeys(byDayProject, displayN, displayMode);
  const stackedByProject = stackProjectsByDay(byDayProject, topProjectNames, displayMode);

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
      return topProjectNames.map((name, i) => ({ name: fmtLegendLabel(name), color: chartColor(name, i) }));
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
          {row.parentSessionId && <span className="text-text-muted text-xs">↳ subagent</span>}
          {(() => {
            const SKIP_INTENTS = new Set(['unknown task', '[request interrupted by user]']);
            const meaningfulIntent = row.intent
              && !SKIP_INTENTS.has(row.intent.toLowerCase())
              && !/^#+ /.test(row.intent.trimStart())
              ? row.intent : undefined;
            if (meaningfulIntent) {
              return (
                <span className="text-text-primary text-base truncate" title={meaningfulIntent}>
                  {meaningfulIntent.length > 100 ? meaningfulIntent.slice(0, 100) + '…' : meaningfulIntent}
                </span>
              );
            }
            if (row.firstUserMessage && !row.firstUserMessage.startsWith('Caveat:')) {
              return (
                <span className="text-text-primary text-base truncate">
                  {(() => { const t = stripMarkdown(row.firstUserMessage!); return t.length > 100 ? t.slice(0, 100) + '…' : t; })()}
                </span>
              );
            }
            return null;
          })()}
          {row.outcome && (
            <span className="text-text-muted text-xs truncate" title={row.outcome}>
              → {row.outcome.length > 90 ? row.outcome.slice(0, 90) + '…' : row.outcome}
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
          <span className="text-text-muted ml-1">({fmtNumber(row.assistantMessages)} / {fmtNumber(row.userMessages)})</span>
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
      key: 'gateInfo',
      label: 'Gates',
      shrink: true,
      render: (row) => {
        const gi = row.gateInfo;
        if (!gi || (gi.hookBlocks === 0 && gi.hookAdvisories === 0)) {
          return <span className="text-text-disabled">—</span>;
        }
        return (
          <div className="flex items-center gap-1">
            {gi.hookBlocks > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-error/15 text-error border border-error/30" title="Hook blocks">
                {gi.hookBlocks}B
              </span>
            )}
            {gi.hookAdvisories > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-warning/15 text-warning border border-warning/30" title="Hook advisories">
                {gi.hookAdvisories}A
              </span>
            )}
          </div>
        );
      },
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
        displayMode={displayMode}
        onDisplayModeChange={setDisplayMode}
        displayN={displayN}
        onDisplayNChange={setDisplayN}
      />

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4 !mt-0">
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
              <h3 className="font-heading text-lg font-medium text-text-secondary">{chartTitles[dataset]}</h3>
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
                      <Bar isAnimationActive={false} dataKey="foregroundCount" stackId="d" fill={CHART_PALETTE[0]} radius={[0, 0, 0, 0]} name="Foreground" />
                      <Bar isAnimationActive={false} dataKey="backgroundCount" stackId="d" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Background" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={subagents.data?.byDay ?? []}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Area isAnimationActive={false} type={curveCardinal.tension(0.5) as any} dataKey="foregroundCount" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Foreground" />
                      <Area isAnimationActive={false} type={curveCardinal.tension(0.5) as any} dataKey="backgroundCount" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Background" />
                    </ComposedChart>
                  )
                ) : dataset === 'cost' ? (
                  chartType === 'bar' ? (
                    <BarChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtCurrency(Number(v)), 'Cost']} />
                      <Bar isAnimationActive={false} dataKey="cost" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Cost" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtCurrency(Number(v)), 'Cost']} />
                      <Area isAnimationActive={false} type={curveCardinal.tension(0.5) as any} dataKey="cost" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Cost" />
                    </ComposedChart>
                  )
                ) : dataset === 'churn' ? (
                  chartType === 'bar' ? (
                    <BarChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Bar isAnimationActive={false} dataKey="linesAdded" stackId="churn" fill={CHART_PALETTE[2]} radius={[0, 0, 0, 0]} name="Added" />
                      <Bar isAnimationActive={false} dataKey="linesRemoved" stackId="churn" fill={CHART_PALETTE[4]} radius={[2, 2, 0, 0]} name="Removed" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Area isAnimationActive={false} type={curveCardinal.tension(0.5) as any} dataKey="linesAdded" stackId="churn" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Added" />
                      <Area isAnimationActive={false} type={curveCardinal.tension(0.5) as any} dataKey="linesRemoved" stackId="churn" stroke={CHART_PALETTE[4]} fill={CHART_PALETTE[4]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Removed" />
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
                        <Bar isAnimationActive={false} key={name} dataKey={name} name={fmtLegendLabel(name)} stackId="a" fill={chartColor(name, i)} radius={i === topProjectNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : (
                    <ComposedChart data={stackedByProject}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      {topProjectNames.map((name, i) => (
                        <Area isAnimationActive={false} key={name} type={curveCardinal.tension(0.5) as any} dataKey={name} name={fmtLegendLabel(name)} stackId="a" stroke={chartColor(name, i)} fill={chartColor(name, i)} fillOpacity={0.15} strokeWidth={2} dot={false} />
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
                      <Bar isAnimationActive={false} dataKey="commits" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Commits" />
                    </BarChart>
                  ) : (
                    <ComposedChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Area isAnimationActive={false} type={curveCardinal.tension(0.5) as any} dataKey="commits" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Commits" />
                    </ComposedChart>
                  )
                ) : chartType === 'bar' ? (
                  <ComposedChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis yAxisId="left" {...axisProps} domain={[0, maxMessages]} />
                    <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, maxSessions]} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Bar isAnimationActive={false} yAxisId="left" dataKey="userMessages" stackId="msgs" fill={CHART_PALETTE[2]} radius={[0, 0, 0, 0]} name="User Msgs" />
                    <Bar isAnimationActive={false} yAxisId="left" dataKey="assistantMessages" stackId="msgs" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Assistant Msgs" />
                    <Bar isAnimationActive={false} yAxisId="right" dataKey="sessions" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Sessions" />
                  </ComposedChart>
                ) : (
                  <ComposedChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...xAxisDateProps} />
                    <YAxis yAxisId="left" {...axisProps} domain={[0, maxMessages]} />
                    <YAxis yAxisId="right" orientation="right" {...axisProps} domain={[0, maxSessions]} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area isAnimationActive={false} yAxisId="left" type={curveCardinal.tension(0.5) as any} dataKey="userMessages" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.15} strokeWidth={2} dot={false} name="User Msgs" />
                    <Area isAnimationActive={false} yAxisId="left" type={curveCardinal.tension(0.5) as any} dataKey="assistantMessages" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Assistant Msgs" />
                    <Area isAnimationActive={false} yAxisId="right" type={curveCardinal.tension(0.5) as any} dataKey="sessions" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Sessions" />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="w-px bg-border-primary shrink-0 mx-5" />

          {/* Right: Distribution */}
          <div className="w-[360px] shrink-0 flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="font-heading text-lg font-medium text-text-secondary">{distTitles[dataset]}</h3>
              {(dataset === 'sessions' || dataset === 'by-project' || dataset === 'dispatches' || dataset === 'cost') && (
                <div className="flex gap-1">
                  {(['donut', 'bar'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setDistChartType(t)}
                      className={clsx(
                        'px-2 py-0.5 text-xs rounded transition-colors',
                        distChartType === t ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(dataset === 'sessions' || dataset === 'by-project') && (() => {
              const items = sliceRanked(data.byProject as Record<string, unknown>[], 'sessions', displayN, displayMode) as Array<{ project: string; sessions: number }>;
              if (items.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No data</div>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {distChartType === 'donut' ? (
                      <PieChart>
                        <Pie isAnimationActive={false} data={items} dataKey="sessions" nameKey="project" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                          {items.map((entry: any, i: number) => <Cell key={i} fill={entry.project === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      </PieChart>
                    ) : (
                      <BarChart layout="vertical" data={items}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                        <YAxis type="category" dataKey="project" {...axisProps} width={80} tick={{ fontSize: 10 }} tickFormatter={(v: string) => fmtLegendLabel(v)} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                        <Bar isAnimationActive={false} dataKey="sessions" name="Sessions" radius={[0, 2, 2, 0]}>
                          {items.map((entry: any, i: number) => <Cell key={i} fill={entry.project === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'dispatches' && (() => {
              if (!subagents.data || subagents.data.byType.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No data</div>;
              const items = sliceRanked(subagents.data.byType as unknown as Record<string, unknown>[], 'count', displayN, displayMode) as Array<{ subagentType: string; count: number }>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {distChartType === 'donut' ? (
                      <PieChart>
                        <Pie isAnimationActive={false} data={items} dataKey="count" nameKey="subagentType" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                          {items.map((entry: any, i: number) => <Cell key={i} fill={entry.subagentType === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      </PieChart>
                    ) : (
                      <BarChart layout="vertical" data={items}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                        <YAxis type="category" dataKey="subagentType" {...axisProps} width={80} tick={{ fontSize: 10 }} tickFormatter={(v: string) => fmtLegendLabel(v)} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                        <Bar isAnimationActive={false} dataKey="count" name="Count" radius={[0, 2, 2, 0]}>
                          {items.map((entry: any, i: number) => <Cell key={i} fill={entry.subagentType === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'cost' && (() => {
              if (!cost.data || cost.data.byModel.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No data</div>;
              const items = sliceRanked(cost.data.byModel as Record<string, unknown>[], 'usd', displayN, displayMode) as Array<{ model: string; usd: number; pct: number }>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {distChartType === 'donut' ? (
                      <PieChart>
                        <Pie isAnimationActive={false} data={items} dataKey="usd" nameKey="model" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                          {items.map((entry: any, i: number) => <Cell key={i} fill={entry.model === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtCurrency(Number(v)), formatModelName(String(n))]} />
                      </PieChart>
                    ) : (
                      <BarChart layout="vertical" data={items}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtCurrency(Number(v))} />
                        <YAxis type="category" dataKey="model" {...axisProps} width={80} tick={{ fontSize: 10 }} tickFormatter={(v: string) => formatModelName(v)} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtCurrency(Number(v)), formatModelName(String(n))]} />
                        <Bar isAnimationActive={false} dataKey="usd" name="Cost" radius={[0, 2, 2, 0]}>
                          {items.map((entry: any, i: number) => <Cell key={i} fill={entry.model === 'Other' ? CHART_OTHER : CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'churn' && (() => {
              const topChurn = sliceRanked(
                [...filteredSessions]
                  .map(s => ({ ...s, totalChurn: s.linesAdded + s.linesRemoved }))
                  .filter(s => s.totalChurn > 0)
                  .sort((a, b) => b.totalChurn - a.totalChurn) as Record<string, unknown>[],
                'totalChurn', displayN, displayMode
              ) as Array<SessionRow & { totalChurn: number }>;
              if (topChurn.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No churn data</div>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={topChurn}>
                      <CartesianGrid {...gridProps} horizontal={false} />
                      <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                      <YAxis type="category" dataKey="sessionId" {...axisProps} width={60} tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(0, 8)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Bar isAnimationActive={false} dataKey="linesAdded" stackId="a" fill={CHART_PALETTE[2]} name="Added" radius={[0, 0, 0, 0]} />
                      <Bar isAnimationActive={false} dataKey="linesRemoved" stackId="a" fill={CHART_PALETTE[4]} name="Removed" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}

            {dataset === 'commits' && (() => {
              const topCommits = sliceRanked(
                [...filteredSessions]
                  .filter(s => s.commits > 0)
                  .sort((a, b) => b.commits - a.commits) as Record<string, unknown>[],
                'commits', displayN, displayMode
              ) as SessionRow[];
              if (topCommits.length === 0) return <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No commits data</div>;
              return (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={topCommits}>
                      <CartesianGrid {...gridProps} horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="sessionId" {...axisProps} width={60} tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(0, 8)} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtNumber(Number(v)), 'Commits']} />
                      <Bar isAnimationActive={false} dataKey="commits" fill={CHART_PALETTE[1]} name="Commits" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Shared legend */}
        <div className="flex items-center justify-center gap-x-2 gap-y-[5px] mt-1 mb-1 text-xs shrink-0 flex-wrap">
          {getLegendKeys().map(({ name, color }) => (
            <span key={name} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="font-mono text-text-secondary">{name}</span>
            </span>
          ))}
        </div>
      </div>

      <DataTable<SessionRow>
        data={filteredSessions}
        columns={sessionColumns}
        keyField="sessionId"
        pageSize={50}
        onRowClick={(row) => navigate(`/observability/sessions/${encodeURIComponent(row.sessionId)}`)}
      />

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
