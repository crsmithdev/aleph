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
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtMs, shortDate, parseToolSource, shortRelativeTime, fmtSeriesName } from '../../../utils/format';
import { clsx } from 'clsx';

type RawToolRow = {
  name: string; count: number; errorCount: number; pct: number; active: boolean;
  lastUsed?: string; avgMs?: number; p50Ms?: number; p95Ms?: number;
  linesAdded?: number; linesRemoved?: number; sessionCount?: number; velocity?: number;
};
type ToolRow = RawToolRow & { server: string; tool: string; successRate: number };
type Dataset = 'calls' | 'churn' | 'projects' | 'velocity';

const DATASETS: { key: Dataset; label: string }[] = [
  { key: 'calls', label: 'Calls' },
  { key: 'churn', label: 'Code Churn' },
  { key: 'projects', label: 'Projects' },
  { key: 'velocity', label: 'Velocity' },
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
  const [dataset, setDataset] = useState<Dataset>('calls');
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

  const stackedCalls = stackByDay(data.byDay, topCallNames, 'tools');
  const stackedChurn = stackByDay(data.byDayChurn, topChurnNames, 'tools');
  const stackedProjects = stackByDay(data.byDayProject, topProjectNames, 'projects');

  const activeKeys = dataset === 'calls' ? topCallNames : dataset === 'churn' ? topChurnNames : dataset === 'projects' ? topProjectNames : [];
  const activeStackedData = dataset === 'calls' ? stackedCalls : dataset === 'churn' ? stackedChurn : dataset === 'projects' ? stackedProjects : [];

  const timeSeriesTitle = dataset === 'calls' ? 'Calls Over Time' : dataset === 'churn' ? 'Code Churn Over Time' : dataset === 'projects' ? 'Usage by Project' : 'Velocity Over Time';
  const distTitle = dataset === 'calls' ? 'Top Tools' : dataset === 'churn' ? 'Top by Churn' : dataset === 'projects' ? 'By Project' : 'Top by Velocity';

  const topChurnTools = [...enriched]
    .map(r => ({ ...r, totalChurn: (r.linesAdded || 0) + (r.linesRemoved || 0) }))
    .filter(r => r.totalChurn > 0)
    .sort((a, b) => b.totalChurn - a.totalChurn)
    .slice(0, 10);

  const topVelocityTools = [...enriched]
    .filter(r => r.velocity !== undefined)
    .sort((a, b) => (b.velocity || 0) - (a.velocity || 0))
    .slice(0, 10);

  const top10 = filtered.slice(0, 10);
  const projectTop8 = data.projectRanked.slice(0, 8);

  const hasTimeSeries = dataset === 'velocity' ? data.byDayVelocity.length > 0 : activeStackedData.length > 0;

  const columns: Column<ToolRow>[] = [
    {
      key: 'tool',
      label: 'Tool',
      sortable: true,
      render: (row) => <span className="font-mono text-text-primary">{row.tool}</span>,
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
        ? <span className="font-mono text-text-secondary whitespace-nowrap">{shortRelativeTime(row.lastUsed)}</span>
        : <span className="text-text-disabled">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="font-heading text-2xl font-bold text-text-primary">Tools</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        {inactiveCount > 0 && (
          <FilterToggle label={`Missing (${inactiveCount})`} active={showMissing} onToggle={() => setShowMissing(!showMissing)} activeColor="error" />
        )}
      </ObsControlBar>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Tool Calls"
          value={fmtCalls(totalCalls)}
          accent="neutral"
          detailContent={
            totalErrors === 0
              ? <span className="text-sm text-success font-semibold">No errors</span>
              : totalErrors / Math.max(totalCalls, 1) < 0.05
              ? <span className="text-sm text-warning font-semibold">{fmtNumber(totalErrors)} errors</span>
              : <span className="text-sm text-error font-semibold">{fmtNumber(totalErrors)} errors</span>
          }
        />
        <StatCard label="Active Tools" value={fmtNumber(activeTools)} />
        <StatCard
          label="Latency"
          value={weightedP50 > 0 ? fmtMs(weightedP50) : '—'}
          detailContent={weightedP95 > 0 ? (
            <span className="text-sm">
              <span className="text-text-muted">p95 </span>
              <span className="font-mono font-semibold text-text-primary">{fmtMs(weightedP95)}</span>
            </span>
          ) : undefined}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {top10.length > 0 && (
        <>
          {/* Dataset selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">Dataset</span>
            <div className="flex items-center gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
              {DATASETS.map(d => (
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

          <div className="flex gap-4 items-start">
            {/* Time series chart */}
            {hasTimeSeries && (
              <div className="flex-1 min-w-0 rounded-lg border border-border-primary bg-bg-secondary p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-text-secondary">{timeSeriesTitle}</h3>
                  {dataset !== 'velocity' && (
                    <div className="flex gap-1">
                      {(['bar', 'line'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setChartType(t)}
                          className={clsx(
                            'px-2 py-0.5 text-xs rounded font-mono transition-colors',
                            chartType === t ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-secondary'
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {dataset === 'velocity' ? (
                  <AreaChart width={undefined as unknown as number} height={240} data={data.byDayVelocity} style={{ width: '100%' }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [v, 'Calls/Session']} />
                    <Area type="monotone" dataKey="velocity" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} strokeWidth={2} dot={false} name="Velocity" />
                  </AreaChart>
                ) : chartType === 'bar' ? (
                  <BarChart width={undefined as unknown as number} height={240} data={activeStackedData} style={{ width: '100%' }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    {activeKeys.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === activeKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                ) : (
                  <AreaChart width={undefined as unknown as number} height={240} data={activeStackedData} style={{ width: '100%' }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    {activeKeys.map((name, i) => (
                      <Area key={name} type="monotone" dataKey={name} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.4} strokeWidth={1.5} dot={false} />
                    ))}
                  </AreaChart>
                )}
              </div>
            )}

            {/* Distribution chart */}
            <div className="w-1/4 min-w-[220px] shrink-0 rounded-lg border border-border-primary bg-bg-secondary p-4">
              <h3 className="text-sm font-medium text-text-secondary mb-3">{distTitle}</h3>

              {dataset === 'calls' && (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={top10} dataKey="count" nameKey="tool" cx="50%" cy="50%" innerRadius={50} outerRadius={78}>
                        {top10.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-1 mt-3">
                    {top10.map((row, i) => (
                      <div key={row.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                        <span className="font-mono text-text-secondary truncate">{row.tool}</span>
                        <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {dataset === 'churn' && (
                <>
                  {topChurnTools.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
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
                    <div className="flex items-center justify-center h-40 text-xs text-text-muted">No churn data</div>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: CHART_PALETTE[2] }} />Added</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: CHART_PALETTE[4] }} />Removed</span>
                  </div>
                </>
              )}

              {dataset === 'projects' && (
                <>
                  {projectTop8.length > 0 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={projectTop8} dataKey="count" nameKey="project" cx="50%" cy="50%" innerRadius={50} outerRadius={78}>
                          {projectTop8.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-40 text-xs text-text-muted">No project data</div>
                  )}
                  <div className="flex flex-col gap-1 mt-3">
                    {projectTop8.map((row, i) => (
                      <div key={row.project} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                        <span className="font-mono text-text-secondary truncate">{row.project}</span>
                        <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {dataset === 'velocity' && (
                <>
                  {topVelocityTools.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart layout="vertical" data={topVelocityTools}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} />
                        <YAxis type="category" dataKey="tool" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Calls/Session']} />
                        <Bar dataKey="velocity" fill={CHART_PALETTE[0]} name="Velocity" radius={[0, 2, 2, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-40 text-xs text-text-muted">No velocity data</div>
                  )}
                  <p className="mt-2 text-xs text-text-muted">avg calls per session</p>
                </>
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
