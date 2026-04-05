import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';
import { useObsTools } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtMs, shortDate, parseToolSource, relativeTime, fmtSeriesName } from '../../../utils/format';
import { clsx } from 'clsx';

type RawToolRow = { name: string; count: number; errorCount: number; pct: number; active: boolean; lastUsed?: string; avgMs?: number; p50Ms?: number; p95Ms?: number };
type ToolRow = RawToolRow & { server: string; tool: string };

export function ToolsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [hideInactive, setHideInactive] = useState(true);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsTools(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tools" retry={refetch} />;

  const enriched: ToolRow[] = data.ranked.map((r) => ({ ...r, ...parseToolSource(r.name) }));
  const filtered = hideInactive ? enriched.filter((r) => r.active) : enriched;

  const totalCalls = filtered.reduce((s, r) => s + r.count, 0);
  const activeTools = filtered.filter((r) => r.active).length;
  const totalErrors = filtered.reduce((s, r) => s + r.errorCount, 0);
  const avgSuccessRate = totalCalls > 0 ? ((totalCalls - totalErrors) / totalCalls) * 100 : 100;

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
      render: (row) => {
        return row.server === 'builtin'
          ? <span className="font-mono text-text-tertiary">{row.server}</span>
          : <span className="font-mono text-text-primary">{row.server}</span>;
      },
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
    {
      key: 'errorCount',
      label: 'Errors',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={clsx(row.errorCount > 0 && 'text-error font-medium')}>
          {row.errorCount > 0 ? fmtNumber(row.errorCount) : '-'}
        </span>
      ),
    },
    {
      key: 'avgMs',
      label: 'Avg',
      align: 'right',
      sortable: true,
      render: (row) => row.avgMs !== undefined ? fmtMs(row.avgMs) : <span className="text-text-tertiary">—</span>,
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      render: (row) => row.p95Ms !== undefined ? <span className={clsx(row.p95Ms > 5000 && 'text-warning')}>{fmtMs(row.p95Ms)}</span> : <span className="text-text-tertiary">—</span>,
    },
    {
      key: 'lastUsed',
      label: 'Last Used',
      align: 'right',
      sortable: true,
      render: (row) => row.lastUsed
        ? <span className="text-text-muted">{relativeTime(row.lastUsed)}</span>
        : <span className="text-text-tertiary">—</span>,
    },
  ];

  const top10 = filtered.slice(0, 10);

  // Build stacked series for top tools by day
  const topToolNames: string[] = (() => {
    const totals: Record<string, number> = {};
    for (const day of data.byDay) {
      for (const [tool, count] of Object.entries(day.tools ?? {})) {
        totals[tool] = (totals[tool] ?? 0) + count;
      }
    }
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);
  })();

  const stackedByDay = data.byDay.map((day) => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of topToolNames) {
      entry[name] = (day.tools ?? {})[name] ?? 0;
    }
    return entry;
  });

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Tools</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        <FilterToggle label="Active only" active={hideInactive} onToggle={() => setHideInactive(!hideInactive)} />
      </ObsControlBar>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Tool Calls" value={fmtNumber(totalCalls)} />
        <StatCard label="Active Tools" value={fmtNumber(activeTools)} />
        <StatCard
          label="Total Errors"
          value={fmtNumber(totalErrors)}
          accent={totalErrors > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="Avg Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {top10.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-secondary">Tool Call Distribution</h3>
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
            <div className="shrink-0" style={{ width: 200 }}>
              <PieChart width={160} height={160}>
                <Pie data={top10} dataKey="count" nameKey="tool" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                  {top10.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
              </PieChart>
              <div className="flex flex-col gap-1 mt-2">
                {top10.map((row, i) => (
                  <div key={row.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                    <span className="font-mono text-text-secondary truncate">{row.tool}</span>
                    <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                  </div>
                ))}
              </div>
            </div>

            {stackedByDay.length > 0 && (
              <div className="flex-1 min-w-0">
                {chartType === 'bar' ? (
                  <BarChart width={undefined as unknown as number} height={260} data={stackedByDay} style={{ width: '100%' }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    {topToolNames.map((name, i) => (
                      <Bar key={name} dataKey={name} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topToolNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                ) : (
                  <AreaChart width={undefined as unknown as number} height={260} data={stackedByDay} style={{ width: '100%' }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    {topToolNames.map((name, i) => (
                      <Area key={name} type="linear" dataKey={name} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.4} strokeWidth={1.5} dot={false} />
                    ))}
                  </AreaChart>
                )}
              </div>
            )}
          </div>
        </div>
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
