import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { useObsTools } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtMs, shortDate, parseToolSource } from '../../../utils/format';
import { clsx } from 'clsx';

type RawToolRow = { name: string; count: number; errorCount: number; pct: number; active: boolean; avgMs?: number; p50Ms?: number; p95Ms?: number };
type ToolRow = RawToolRow & { server: string; tool: string };

export function ToolsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [hideInactive, setHideInactive] = useState(true);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsTools(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tools" retry={refetch} />;

  const enriched: ToolRow[] = data.ranked.map((r) => ({ ...r, ...parseToolSource(r.name) }));
  const filtered = hideInactive ? enriched.filter((r) => r.active) : enriched;

  const columns: Column<ToolRow>[] = [
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
      key: 'tool',
      label: 'Tool',
      sortable: true,
      render: (row) => <span className="font-mono text-text-primary">{row.tool}</span>,
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
      key: 'pct',
      label: '%',
      align: 'right',
      sortable: true,
      render: (row) => fmtPct(row.pct),
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
  ];

  const top10 = filtered.slice(0, 10);

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Tools</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        <FilterToggle label="Active only" active={hideInactive} onToggle={() => setHideInactive(!hideInactive)} />
      </ObsControlBar>

      {top10.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">Tool Call Distribution</h3>
          <div className="flex items-center gap-6">
            <PieChart width={160} height={160}>
              <Pie data={top10} dataKey="count" nameKey="tool" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                {top10.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
            </PieChart>
            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
              {top10.map((row, i) => (
                <div key={row.name} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                  <span className="font-mono text-text-secondary truncate">{row.tool}</span>
                  <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                  <span className="text-text-disabled font-mono shrink-0 w-10 text-right">{fmtPct(row.pct)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <DataTable<ToolRow>
        data={filtered}
        columns={columns}
        keyField="name"
        onRowClick={(row) => navigate(`/observability/tools/${encodeURIComponent(row.name)}`)}
      />

      {data.byDay.length > 0 && (
        <ChartContainer title="Tool Calls Over Time" chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Calls" />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Calls" />
            </LineChart>
          )}
        </ChartContainer>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
