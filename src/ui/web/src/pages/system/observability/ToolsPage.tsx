import { Icon } from '../../../../components/ui/Icon';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsTools } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtMs, shortDate, parseToolSource, shortRelativeTime, fmtLegendLabel, fmtProject } from '../../../utils/format';
import { clsx } from 'clsx';

type RawToolRow = {
  name: string; count: number; errorCount: number; pct: number; active: boolean;
  lastUsed?: string; avgMs?: number; p50Ms?: number; p95Ms?: number;
  linesAdded?: number; linesRemoved?: number; sessionCount?: number; velocity?: number;
};
type ToolRow = RawToolRow & { server: string; tool: string; successRate: number };
type Dataset = 'calls' | 'churn' | 'projects' | 'velocity' | 'errors' | 'latency' | 'sessions';

const DATASETS: { key: Dataset; label: string }[] = [
  { key: 'calls', label: 'Calls' },
  { key: 'churn', label: 'Code Churn' },
  { key: 'projects', label: 'Projects' },
  { key: 'velocity', label: 'Velocity' },
  { key: 'errors', label: 'Errors' },
  { key: 'latency', label: 'Latency' },
  { key: 'sessions', label: 'Sessions' },
];

function fmtCalls(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function topKeysFromRecord(days: { tools?: Record<string, number>; projects?: Record<string, number> }[], field: 'tools' | 'projects', n = 10): string[] {
  const totals: Record<string, number> = {};
  for (const day of days) {
    for (const [k, v] of Object.entries((day as Record<string, unknown>)[field] as Record<string, number> ?? {})) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function stackByDay<T extends { date: string }>(days: T[], keys: string[], field: 'tools' | 'projects'): Record<string, unknown>[] {
  return days.map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    const source = (day as Record<string, unknown>)[field] as Record<string, number> ?? {};
    for (const k of keys) entry[k] = source[k] ?? 0;
    return entry;
  });
}

export function ToolsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showMissing, setShowMissing] = useState(false);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [tsDataset, setTsDataset] = useState<Dataset>('calls');
  const [distDataset, setDistDataset] = useState<Dataset>('calls');
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsTools(range, granularity);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tools" retry={refetch} />;

  const enriched: ToolRow[] = data.ranked.map((r) => ({
    ...r,
    ...parseToolSource(r.name),
    successRate: r.count > 0 ? ((r.count - r.errorCount) / r.count) * 100 : 100,
  }));
  const inactiveCount = enriched.filter(r => !r.active).length;
  const filtered = showMissing ? enriched : enriched.filter(r => r.active);

  const totalCalls = filtered.reduce((s, r) => s + r.count, 0);
  const activeTools = filtered.filter((r) => r.active).length;
  const totalErrors = filtered.reduce((s, r) => s + r.errorCount, 0);
  const avgSuccessRate = totalCalls > 0 ? ((totalCalls - totalErrors) / totalCalls) * 100 : 100;

  const toolsWithLatency = filtered.filter(r => r.p50Ms !== undefined && r.count > 0);
  const totalCount = toolsWithLatency.reduce((s, r) => s + r.count, 0);
  const weightedP50 = totalCount > 0
    ? toolsWithLatency.reduce((s, r) => s + r.p50Ms! * r.count, 0) / totalCount
    : 0;
  const weightedP95 = totalCount > 0
    ? toolsWithLatency.reduce((s, r) => s + (r.p95Ms ?? r.p50Ms ?? 0) * r.count, 0) / totalCount
    : 0;

  // --- Dataset-specific chart data ---

  const topCallNames = topKeysFromRecord(data.byDay, 'tools');
  const topChurnNames = topKeysFromRecord(data.byDayChurn, 'tools');
  const topProjectNames = topKeysFromRecord(data.byDayProject, 'projects');
  const topErrorNames = topKeysFromRecord(data.byDayErrors ?? [], 'tools');
  const topLatencyNames = topKeysFromRecord(data.byDayLatency ?? [], 'tools');
  const topSessionNames = topKeysFromRecord(data.byDaySessionCount ?? [], 'tools');

  const stackedCalls = stackByDay(data.byDay, topCallNames, 'tools');
  const stackedChurn = stackByDay(data.byDayChurn, topChurnNames, 'tools');
  const stackedProjects = stackByDay(data.byDayProject, topProjectNames, 'projects');
  const stackedErrors = stackByDay(data.byDayErrors ?? [], topErrorNames, 'tools');
  const stackedLatency = stackByDay(data.byDayLatency ?? [], topLatencyNames, 'tools');
  const stackedSessions = stackByDay(data.byDaySessionCount ?? [], topSessionNames, 'tools');

  function getKeys(d: Dataset): string[] {
    return d === 'calls' ? topCallNames : d === 'churn' ? topChurnNames : d === 'projects' ? topProjectNames
      : d === 'errors' ? topErrorNames : d === 'latency' ? topLatencyNames : d === 'sessions' ? topSessionNames : [];
  }
  function getStackedData(d: Dataset): Record<string, unknown>[] {
    return d === 'calls' ? stackedCalls : d === 'churn' ? stackedChurn : d === 'projects' ? stackedProjects
      : d === 'errors' ? stackedErrors : d === 'latency' ? stackedLatency : d === 'sessions' ? stackedSessions : [];
  }

  const tsKeys = getKeys(tsDataset);
  const tsData = getStackedData(tsDataset);

  const granularityLabel: Record<Granularity, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };
  const datasetLabel: Record<Dataset, string> = { calls: 'Calls', churn: 'Code Churn', projects: 'Usage', velocity: 'Velocity', errors: 'Errors', latency: 'Latency', sessions: 'Sessions' };
  const tsSegmentLabel = tsDataset === 'projects' ? 'Project' : 'Tool';
  const timeSeriesTitle = `${granularityLabel[granularity]} ${datasetLabel[tsDataset]} by ${tsSegmentLabel}`;
  const distTitle = distDataset === 'projects' ? 'Top Projects'
    : distDataset === 'sessions' ? 'Top Tools by Sessions'
    : `Top Tools by ${datasetLabel[distDataset]}`;

  const topChurnTools = [...enriched]
    .map(r => ({ ...r, totalChurn: (r.linesAdded || 0) + (r.linesRemoved || 0) }))
    .filter(r => r.totalChurn > 0)
    .sort((a, b) => b.totalChurn - a.totalChurn)
    .slice(0, 10);

  const topVelocityTools = [...enriched]
    .filter(r => r.velocity !== undefined)
    .sort((a, b) => (b.velocity || 0) - (a.velocity || 0))
    .slice(0, 10);

  const top5Tools = filtered.slice(0, 5);
  const toolsOther = filtered.slice(5).reduce((s, r) => s + r.count, 0);
  const callsDonut = toolsOther > 0 ? [...top5Tools, { name: 'other', tool: 'Other', count: toolsOther } as ToolRow] : top5Tools;

  const top5Projects = data.projectRanked.slice(0, 5);
  const projectsOther = data.projectRanked.slice(5).reduce((s, r) => s + r.count, 0);
  const projectsDonut = projectsOther > 0 ? [...top5Projects, { project: 'Other', count: projectsOther, pct: 0 }] : top5Projects;

  const topErrorTools = [...enriched].filter(r => r.errorCount > 0).sort((a, b) => b.errorCount - a.errorCount).slice(0, 10);
  const topLatencyTools = [...enriched].filter(r => r.p50Ms !== undefined && r.count > 0).sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0)).slice(0, 10);

  const top5SessionTools = (() => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDaySessionCount ?? [])) {
      for (const [k, v] of Object.entries(day.tools ?? {})) totals[k] = (totals[k] ?? 0) + v;
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, tool: parseToolSource(name).tool, count }));
  })();
  const sessionsOther = (() => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDaySessionCount ?? [])) {
      for (const [k, v] of Object.entries(day.tools ?? {})) totals[k] = (totals[k] ?? 0) + v;
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(5).reduce((s, [, v]) => s + v, 0);
  })();
  const sessionsDonut = sessionsOther > 0 ? [...top5SessionTools, { name: 'other', tool: 'Other', count: sessionsOther }] : top5SessionTools;

  const hasTimeSeries = tsDataset === 'velocity' ? data.byDayVelocity.length > 0 : tsData.length > 0;

  const columns: Column<ToolRow>[] = [
    {
      key: 'tool',
      label: 'Tool',
      sortable: true,
      render: (row) => <span className="font-mono text-text-primary">{row.tool}</span>,
    },
    {
      key: 'active',
      label: 'Installed',
      align: 'right',
      sortable: true,
      width: '64px',
      render: (row) => row.active
        ? <Icon name="check" size="sm" className="text-success" />
        : <span className="text-text-disabled text-xs">—</span>,
    },
    {
      key: 'server',
      label: 'Server',
      sortable: true,
      width: '120px',
      render: (row) => row.server === 'builtin'
        ? <span className="font-mono text-text-muted">{row.server}</span>
        : <span className="font-mono text-text-primary">{row.server}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      width: '80px',
      render: (row) => <span className="font-mono">{fmtNumber(row.count)}</span>,
    },
    {
      key: 'errorCount',
      label: 'Errors',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => (
        <span className={clsx('font-mono', row.errorCount > 0 && 'text-error font-medium')}>
          {row.errorCount > 0 ? fmtNumber(row.errorCount) : '—'}
        </span>
      ),
    },
    {
      key: 'p50Ms',
      label: 'P50',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.p50Ms !== undefined
        ? <span className="font-mono">{fmtMs(row.p50Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.p95Ms !== undefined
        ? <span className={clsx('font-mono', row.p95Ms > 5000 && 'text-warning')}>{fmtMs(row.p95Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'successRate',
      label: 'Success',
      align: 'right',
      sortable: true,
      width: '80px',
      render: (row) => (
        <span className={clsx('font-mono', row.successRate < 95 && 'text-warning', row.successRate < 80 && 'text-error')}>
          {row.count > 0 ? fmtPct(row.successRate) : '—'}
        </span>
      ),
    },
    {
      key: 'lastUsed',
      label: 'Last Used',
      sortable: true,
      width: '100px',
      render: (row) => row.lastUsed
        ? <span className="text-text-secondary whitespace-nowrap">{shortRelativeTime(row.lastUsed)}</span>
        : <span className="text-text-disabled">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="font-heading text-2xl font-bold text-text-primary">Tools</h1>}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
        filters={inactiveCount > 0 ? (
          <FilterToggle label={`Missing (${inactiveCount})`} active={showMissing} onToggle={() => setShowMissing(!showMissing)} activeColor="accent" />
        ) : undefined}
        activeFilterCount={showMissing ? 1 : 0}
      />

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Tool Calls"
          value={fmtCalls(totalCalls)}
          accent="neutral"
          secondary={{
            value: totalErrors === 0 ? 'No errors' : `${fmtNumber(totalErrors)} errors`,
            accent: totalErrors === 0 ? 'success' : totalErrors / Math.max(totalCalls, 1) < 0.05 ? 'warning' : 'error',
          }}
        />
        <StatCard label="Active Tools" value={fmtNumber(activeTools)} />
        <StatCard
          label="Latency"
          value={weightedP50 > 0 ? fmtMs(weightedP50) : '—'}
          valueLabel={weightedP50 > 0 ? 'p50' : undefined}
          secondary={weightedP95 > 0 ? {
            value: fmtMs(weightedP95),
            label: 'p95',
            accent: weightedP95 < 1000 ? 'success' : weightedP95 < 5000 ? 'warning' : 'error',
          } : undefined}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {filtered.length > 0 && (
        <>
          <div className="flex gap-4 items-stretch h-[320px]">
            {/* Time series chart */}
            {hasTimeSeries && (
              <div className="flex-1 min-w-0 rounded-lg border border-border-primary bg-bg-secondary p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-text-secondary">{timeSeriesTitle}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={tsDataset}
                      onChange={(e) => setTsDataset(e.target.value as Dataset)}
                      className="text-xs bg-bg-tertiary border border-border-primary rounded px-1.5 py-0.5 text-text-secondary focus:outline-none focus:border-accent cursor-pointer"
                    >
                      {DATASETS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                    {tsDataset !== 'velocity' && (
                      <div className="flex gap-1">
                        {(['bar', 'line'] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setChartType(t)}
                            className={clsx(
                              'px-2 py-0.5 text-xs rounded transition-colors',
                              chartType === t ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
                            )}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {tsDataset === 'velocity' ? (
                      <AreaChart data={data.byDayVelocity}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="date" {...xAxisDateProps} />
                        <YAxis {...axisProps} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [v, 'Calls/Session']} />
                        <Area type="monotone" dataKey="velocity" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Velocity" />
                      </AreaChart>
                    ) : chartType === 'bar' ? (
                      <BarChart data={tsData}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="date" {...xAxisDateProps} />
                        <YAxis {...axisProps} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                        {tsKeys.map((name, i) => (
                          <Bar key={name} dataKey={name} name={fmtLegendLabel(name)} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === tsKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                        ))}
                      </BarChart>
                    ) : (
                      <AreaChart data={tsData}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="date" {...xAxisDateProps} />
                        <YAxis {...axisProps} />
                        <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                        {tsKeys.map((name, i) => (
                          <Area key={name} type="monotone" dataKey={name} name={fmtLegendLabel(name)} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.4} strokeWidth={1.5} dot={false} />
                        ))}
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Distribution chart */}
            <div className="w-[400px] shrink-0 rounded-lg border border-border-primary bg-bg-secondary p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="text-sm font-medium text-text-secondary">{distTitle}</h3>
                <select
                  value={distDataset}
                  onChange={(e) => setDistDataset(e.target.value as Dataset)}
                  className="text-xs bg-bg-tertiary border border-border-primary rounded px-1.5 py-0.5 text-text-secondary focus:outline-none focus:border-accent cursor-pointer"
                >
                  {DATASETS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>

              {distDataset === 'calls' && (
                <div className="flex-1 min-h-0 flex gap-3">
                  <div className="flex-1 min-w-0 min-h-0 flex items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={callsDonut} dataKey="count" nameKey="tool" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                          {callsDonut.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1.5 justify-center shrink-0 w-36">
                    {callsDonut.map((row, i) => (
                      <div key={row.name} className="flex items-center gap-1.5 text-xs min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                        <span className="font-mono text-text-secondary truncate flex-1">{row.tool}</span>
                        <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtNumber(row.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {distDataset === 'churn' && (
                <>
                  <div className="flex-1 min-h-0">
                    {topChurnTools.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={topChurnTools}>
                          <CartesianGrid {...gridProps} horizontal={false} />
                          <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                          <YAxis type="category" dataKey="tool" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                          <Bar dataKey="linesAdded" stackId="a" fill={CHART_PALETTE[2]} name="Added" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="linesRemoved" stackId="a" fill={CHART_PALETTE[4]} name="Removed" radius={[0, 2, 2, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-text-muted">No churn data</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs shrink-0">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: CHART_PALETTE[2] }} />Added</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: CHART_PALETTE[4] }} />Removed</span>
                  </div>
                </>
              )}

              {distDataset === 'projects' && (
                <div className="flex-1 min-h-0 flex gap-3">
                  {projectsDonut.length > 0 ? (
                    <>
                      <div className="flex-1 min-w-0 min-h-0 flex items-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={projectsDonut} dataKey="count" nameKey="project" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                              {projectsDonut.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-col gap-1.5 justify-center shrink-0 w-44">
                        {projectsDonut.map((row, i) => (
                          <div key={row.project} className="flex items-center gap-1.5 text-xs min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                            <span className="font-mono text-text-secondary truncate flex-1">{fmtProject(row.project)}</span>
                            <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtNumber(row.count)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No project data</div>
                  )}
                </div>
              )}

              {distDataset === 'velocity' && (
                <>
                  <div className="flex-1 min-h-0">
                    {topVelocityTools.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={topVelocityTools}>
                          <CartesianGrid {...gridProps} horizontal={false} />
                          <XAxis type="number" {...axisProps} />
                          <YAxis type="category" dataKey="tool" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Calls/Session']} />
                          <Bar dataKey="velocity" fill={CHART_PALETTE[0]} name="Velocity" radius={[0, 2, 2, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-text-muted">No velocity data</div>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-text-muted shrink-0">avg calls per session</p>
                </>
              )}

              {distDataset === 'errors' && (
                <div className="flex-1 min-h-0">
                  {topErrorTools.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={topErrorTools}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                        <YAxis type="category" dataKey="tool" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtNumber(Number(v)), 'Errors']} />
                        <Bar dataKey="errorCount" fill={CHART_PALETTE[4]} name="Errors" radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-text-muted">No errors</div>
                  )}
                </div>
              )}

              {distDataset === 'latency' && (
                <div className="flex-1 min-h-0">
                  {topLatencyTools.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={topLatencyTools}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtMs(Number(v))} />
                        <YAxis type="category" dataKey="tool" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtMs(Number(v)), 'p50 Latency']} />
                        <Bar dataKey="p50Ms" fill={CHART_PALETTE[1]} name="p50 Latency" radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-xs text-text-muted">No latency data</div>
                  )}
                </div>
              )}

              {distDataset === 'sessions' && (
                <div className="flex-1 min-h-0 flex gap-3">
                  {sessionsDonut.length > 0 ? (
                    <>
                      <div className="flex-1 min-w-0 min-h-0 flex items-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={sessionsDonut} dataKey="count" nameKey="tool" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                              {sessionsDonut.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-col gap-1.5 justify-center shrink-0 w-36">
                        {sessionsDonut.map((row, i) => (
                          <div key={row.name} className="flex items-center gap-1.5 text-xs min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                            <span className="font-mono text-text-secondary truncate flex-1">{row.tool}</span>
                            <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtNumber(row.count)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-center flex-1 text-xs text-text-muted">No session data</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <DataTable<ToolRow>
        data={filtered}
        columns={columns}
        keyField="name"
        onRowClick={(row) => navigate(`/observability/tools/${encodeURIComponent(row.name)}`)}
      />

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
