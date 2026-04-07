import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useObsEvals, type EvalResult } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { relativeTime, shortDate } from '../../../utils/format';
import { PageHeader } from '../../../components/layout/PageHeader';
import { clsx } from 'clsx';

function TrendBadge({ trend }: { trend: EvalResult['trend'] }) {
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono',
      trend === 'improving' && 'bg-green-500/10 text-green-500',
      trend === 'regressing' && 'bg-red-500/10 text-red-500',
      trend === 'stable' && 'bg-bg-tertiary text-text-muted',
    )}>
      {trend === 'improving' ? '↑' : trend === 'regressing' ? '↓' : '→'} {trend}
    </span>
  );
}

function PassRateBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full', value >= 90 ? 'bg-green-500' : value >= 70 ? 'bg-yellow-500' : 'bg-red-500')}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs font-mono text-text-secondary w-10 text-right">{label}</span>
    </div>
  );
}

export function EvalsPage() {
  const { data, isLoading, error, refetch } = useObsEvals();

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load evals data" retry={refetch} />;

  const columns: Column<EvalResult>[] = [
    {
      key: 'name',
      label: 'Eval',
      render: (row) => <span className="text-text-primary">{row.name}</span>,
    },
    {
      key: 'totalRuns',
      label: 'Runs',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => <span className="font-mono text-text-secondary">{row.totalRuns}</span>,
    },
    {
      key: 'passAt1Rate',
      label: 'pass@1',
      align: 'right',
      sortable: true,
      width: '130px',
      render: (row) => <PassRateBar value={row.passAt1Rate} label={`${row.passAt1Rate}%`} />,
    },
    {
      key: 'passAt3Rate',
      label: 'pass@3',
      align: 'right',
      sortable: true,
      width: '130px',
      render: (row) => <PassRateBar value={row.passAt3Rate} label={`${row.passAt3Rate}%`} />,
    },
    {
      key: 'trend',
      label: 'Trend',
      width: '120px',
      render: (row) => <TrendBadge trend={row.trend} />,
    },
    {
      key: 'lastRun',
      label: 'Last Run',
      sortable: true,
      width: '130px',
      render: (row) => <span className="font-mono text-text-muted">{relativeTime(row.lastRun)}</span>,
    },
  ];

  const hasData = data.evals.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Evals" subtitle="Eval-driven reliability — pass@k metrics over time" />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Runs" value={String(data.totalRuns)} />
        <StatCard label="Evals Defined" value={String(data.evals.length)} />
        <StatCard
          label="Overall pass@3"
          value={`${data.overallPassAt3Rate}%`}
          className={data.overallPassAt3Rate >= 90 ? 'text-green-500' : data.overallPassAt3Rate >= 70 ? 'text-yellow-500' : 'text-red-500'}
        />
      </div>

      {hasData && data.byDay.length > 1 && (
        <ChartContainer title="Pass Rate Over Time">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.byDay} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${v}%`, 'Pass rate']}
                labelFormatter={labelFormatter}
              />
              <Line type="monotone" dataKey="passRate" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Pass %" />
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {hasData ? (
        <DataTable<EvalResult>
          data={data.evals}
          columns={columns}
          keyField="name"
          rowKeyFn={(row) => row.name}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <p className="text-text-secondary text-sm max-w-sm">
            No evals defined yet. Use <code className="font-mono bg-bg-tertiary px-1 rounded">/eval define &lt;name&gt;</code> to create your first eval, then run it with <code className="font-mono bg-bg-tertiary px-1 rounded">/eval run &lt;name&gt;</code>.
          </p>
          <p className="text-text-muted text-xs max-w-sm">
            Results are stored in <code className="font-mono">~/.construct/evals/results.jsonl</code>
          </p>
        </div>
      )}
    </div>
  );
}
