import { useState } from 'react';
import { BarChart, Bar, ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { curveCardinal } from 'd3-shape';
import { useObsSessions, useObsSubagents } from '../../../api/observability-hooks';
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
import { fmtNumber, fmtMs, fmtCurrency, shortDate, granLabel, shortRelativeTime, fmtProject, fmtDuration, fmtSeriesName, stripMarkdown } from '../../../utils/format';
import { clsx } from 'clsx';

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
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
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

      <div className="flex gap-4 items-stretch">
        <div className="flex-1 min-w-0">
          <ChartContainer title={granLabel(granularity, "Sessions")} chartType={chartType} onChartTypeChange={setChartType}>
            {chartType === 'bar' ? (
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

        {subagents.data && subagents.data.byType.length > 0 && (
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 w-1/4 min-w-[220px] shrink-0">
            <h3 className="mb-3 text-sm font-medium text-text-secondary">Subagents by Type</h3>
            <div className="flex flex-col gap-3">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={subagents.data.byType} dataKey="count" nameKey="subagentType" cx="50%" cy="50%" innerRadius={50} outerRadius={78}>
                    {subagents.data.byType.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="w-full flex flex-col gap-1">
                {subagents.data.byType.slice(0, 6).map((row, i) => (
                  <div key={row.subagentType} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                    <span className="text-text-secondary truncate">{fmtSeriesName(row.subagentType)}</span>
                    <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
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
