import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsHooks } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector, type Granularity } from '../../../components/data/TimeRangeSelector';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, shortDate } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type HookRow = {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
  active: boolean;
};

export function HooksPage() {
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [hideInactive, setHideInactive] = useState(false);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsHooks(days, granularity);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hooks" retry={refetch} />;

  const filtered = hideInactive ? data.ranked.filter((r) => r.active) : data.ranked;

  const columns: Column<HookRow>[] = [
    {
      key: 'active',
      label: 'Status',
      render: (row) => (
        <span className={cn('inline-block h-2 w-2 rounded-full', row.active ? 'bg-success' : 'bg-text-muted/30')} title={row.active ? 'Active' : 'Removed'} />
      ),
    },
    {
      key: 'command',
      label: 'Hook',
      render: (row) => <span className="font-mono text-text-primary">{row.command}</span>,
    },
    {
      key: 'event',
      label: 'Event',
      render: (row) => <span className="text-text-secondary">{row.event}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cn(row.errors > 0 && 'text-error font-medium')}>
          {row.errors > 0 ? fmtNumber(row.errors) : '-'}
        </span>
      ),
    },
    {
      key: 'successRate',
      label: 'Success',
      align: 'right',
      render: (row) => {
        const rate = row.count > 0 ? ((row.count - row.errors) / row.count) * 100 : 100;
        return (
          <span className={cn(rate < 95 && 'text-warning', rate < 80 && 'text-error')}>
            {fmtPct(rate)}
          </span>
        );
      },
    },
    {
      key: 'avgMs',
      label: 'Avg',
      align: 'right',
      sortable: true,
      render: (row) => fmtMs(row.avgMs),
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cn(row.p95Ms > 500 && 'text-warning')}>
          {fmtMs(row.p95Ms)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-text-primary">Hooks</h1>
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={hideInactive}
              onChange={(e) => setHideInactive(e.target.checked)}
              className="rounded border-border-primary"
            />
            Hide removed
          </label>
        </div>
        <TimeRangeSelector value={days} onChange={setDays} granularity={granularity} onGranularityChange={setGranularity} />
      </div>

      <DataTable<HookRow>
        data={filtered}
        columns={columns}
        keyField="command"
        onRowClick={(row) =>
          navigate(`/system/observability/hooks/${encodeURIComponent(row.command)}`)
        }
      />

      {data.byDay.length > 0 && (
        <ChartContainer title="Hook Executions Over Time">
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="count" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="Executions" />
          </BarChart>
        </ChartContainer>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
