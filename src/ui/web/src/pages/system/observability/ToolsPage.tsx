import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsTools } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type ToolRow = { name: string; count: number; errorCount: number; pct: number; active: boolean };

export function ToolsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [hideInactive, setHideInactive] = useState(true);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsTools(range, granularity);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tools" retry={refetch} />;

  const filtered = hideInactive ? data.ranked.filter((r) => r.active) : data.ranked;
  const maxCount = Math.max(...filtered.map((r) => r.count), 1);

  const columns: Column<ToolRow>[] = [
    {
      key: 'active',
      label: 'Status',
      render: (row) => (
        <span className={cn('inline-block h-2 w-2 rounded-full', row.active ? 'bg-success' : 'bg-text-muted/30')} title={row.active ? 'Active' : 'Inactive'} />
      ),
    },
    {
      key: 'name',
      label: 'Tool',
      render: (row) => <span className="font-mono text-text-primary">{row.name}</span>,
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
        <span className={cn(row.errorCount > 0 && 'text-error font-medium')}>
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
      key: 'bar',
      label: '',
      width: '25%',
      render: (row) => (
        <div className="h-2 w-full rounded-full bg-bg-tertiary">
          <div
            className="h-2 rounded-full bg-accent"
            style={{ width: `${(row.count / maxCount) * 100}%` }}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-xl font-semibold text-text-primary">Tools</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        <FilterToggle label="Active only" active={hideInactive} onToggle={() => setHideInactive(!hideInactive)} />
      </ObsControlBar>

      <DataTable<ToolRow>
        data={filtered}
        columns={columns}
        keyField="name"
        onRowClick={(row) => navigate(`/system/observability/tools/${encodeURIComponent(row.name)}`)}
      />

      {data.byDay.length > 0 && (
        <ChartContainer title="Tool Calls Over Time" chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Calls" />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Calls" />
            </LineChart>
          )}
        </ChartContainer>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
