import { Icon } from '../../../components/ui/Icon';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsHookDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtMs, fmtPct, fmtLegendLabel } from '../../../utils/format';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { CodeBlock } from '../../../components/data/CodeBlock';

type InvocationRow = { timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string; trigger?: string; isError?: boolean; errorMessage?: string };
type Dataset = 'status' | 'latency';

const DATASETS: { key: Dataset; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'latency', label: 'Latency' },
];

function compactDate(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day} ${format(d, 'h:mmaaa')}`;
}

export function HookDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const hookName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(true);
  const [showErrors, setShowErrors] = useState(true);
  const [tsDataset, setTsDataset] = useState<Dataset>('status');
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [distChartType, setDistChartType] = useState<'donut' | 'bar'>('donut');
  const { data, isLoading, error, refetch } = useObsHookDetail(hookName, range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load hook details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errors) / data.totalCount) * 100
    : 100;
  const successCount = data.totalCount - data.errors;

  // Filter invocations by success/error toggles
  const filteredInvocations = data.invocations.filter((inv: InvocationRow) => {
    if (inv.isError) return showErrors;
    return showSuccess;
  });

  // Build success/error by day from invocations
  const byDayStatus: Record<string, { success: number; error: number }> = {};
  for (const inv of data.invocations) {
    const dateKey = inv.timestamp.slice(0, 10);
    if (!byDayStatus[dateKey]) byDayStatus[dateKey] = { success: 0, error: 0 };
    if (inv.isError) byDayStatus[dateKey].error++;
    else byDayStatus[dateKey].success++;
  }

  const statusByDay = data.byDay.map((day) => ({
    date: day.date,
    Success: byDayStatus[day.date]?.success ?? day.count,
    Errors: byDayStatus[day.date]?.error ?? 0,
  }));

  // Latency time series
  const latencyByDay = data.byDay.map((day) => ({
    date: day.date,
    Avg: day.avgMs ?? 0,
  }));

  // Donut data
  const statusDonut = [
    { name: 'Success', value: successCount },
    ...(data.errors > 0 ? [{ name: 'Errors', value: data.errors }] : []),
  ];

  const STATUS_COLORS = ['var(--c-success)', 'var(--c-error)'];
  const LATENCY_COLORS = ['var(--c-accent)'];

  // Filter out empty datasets
  const hasLatency = data.invocations.some((inv: InvocationRow) => inv.durationMs > 0);
  const visibleDatasets = DATASETS.filter(d => {
    if (d.key === 'latency' && !hasLatency) return false;
    return true;
  });

  // Dynamic chart config per dataset
  type ChartConfig = { data: Record<string, unknown>[]; keys: string[]; colors: string[]; title: string; distTitle: string; yFormatter?: (v: number) => string; stacked?: boolean; distData?: { name: string; value: number }[] };
  const granularityLabel: Record<Granularity, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };

  const chartConfig: Record<Dataset, ChartConfig> = {
    status: {
      data: statusByDay, keys: ['Success', 'Errors'], colors: STATUS_COLORS, stacked: true,
      title: `${granularityLabel[granularity]} Executions by Status`, distTitle: 'Success vs Errors', distData: statusDonut,
    },
    latency: {
      data: latencyByDay, keys: ['Avg'], colors: LATENCY_COLORS,
      title: `${granularityLabel[granularity]} Latency`, distTitle: 'Latency Distribution',
      yFormatter: (v) => fmtMs(v),
    },
  };

  const cfg = chartConfig[tsDataset];
  const activeFilterCount = (showSuccess ? 0 : 1) + (showErrors ? 0 : 1);

  const hasTriggers = data.invocations.some((inv: InvocationRow) => inv.trigger);

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Date',
      shrink: true,
      sortable: true,
      render: (row) => <span className="font-mono text-text-secondary whitespace-nowrap">{compactDate(row.timestamp)}</span>,
    },
    ...(hasTriggers ? [{
      key: 'trigger',
      label: 'Trigger',
      shrink: true,
      render: (row: InvocationRow) => row.trigger
        ? <span className="font-mono text-sm text-accent-primary whitespace-nowrap">{row.trigger}</span>
        : <span className="text-text-muted">—</span>,
    }] : []) as Column<InvocationRow>[],
    {
      key: 'sessionId',
      label: 'Session',
      shrink: true,
      render: (row) => (
        <Link
          to={`/observability/sessions/${row.sessionId}?t=${encodeURIComponent(row.timestamp)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-sm text-accent-primary hover:underline whitespace-nowrap"
        >
          {row.sessionId.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'output',
      label: 'Output',
      render: (row) => {
        if (!row.output) return <span className="text-text-muted">—</span>;
        const truncated = row.output.length > 120 ? row.output.slice(0, 120) + '…' : row.output;
        return <span className="text-sm text-text-secondary font-mono">{truncated}</span>;
      },
    },
    {
      key: 'errorMessage',
      label: 'Error',
      render: (row) => row.errorMessage
        ? <span className="text-sm text-error font-mono">{row.errorMessage.slice(0, 80)}{(row.errorMessage.length > 80 ? '…' : '')}</span>
        : <span className="text-text-muted">—</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      shrink: true,
      sortable: true,
      render: (row) => row.durationMs > 0
        ? <span className="font-mono text-sm whitespace-nowrap">{fmtMs(row.durationMs)}</span>
        : <span className="text-text-muted">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <div className="flex items-center gap-2">
            <Link
              to="/observability/hooks"
              className="flex items-center gap-1 text-text-muted hover:text-text-primary transition-colors"
            >
              <Icon name="webhook" size="xs" className="text-text-muted" />
              <span className="font-heading text-lg text-text-muted">Hooks</span>
            </Link>
            <Icon name="chevron_right" size="xs" className="text-text-disabled" />
            <h1 className="font-heading text-lg font-semibold text-text-primary">{hookName}</h1>
            {data.event && (
              <span className="rounded-md bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted font-mono">{data.event}</span>
            )}
            <span className={clsx(
              'inline-block h-2 w-2 rounded-full',
              data.active ? 'bg-success' : 'bg-text-muted/30'
            )} title={data.active ? 'Active' : 'Removed'} />
          </div>
        }
        datasets={visibleDatasets}
        dataset={tsDataset}
        onDatasetChange={(d) => setTsDataset(d as Dataset)}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
        filters={
          <>
            <FilterToggle label="Success" active={showSuccess} onToggle={() => setShowSuccess(!showSuccess)} activeColor="success" />
            <FilterToggle label="Error" active={showErrors} onToggle={() => setShowErrors(!showErrors)} activeColor="error" />
          </>
        }
        activeFilterCount={activeFilterCount}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Executions" value={fmtNumber(data.totalCount)} accent="neutral" />
        <StatCard
          label="Errors"
          value={data.errors === 0 ? '0' : fmtNumber(data.errors)}
          accent={data.errors === 0 ? 'success' : data.errors / Math.max(data.totalCount, 1) < 0.05 ? 'warning' : 'error'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
        />
        <StatCard
          label="P50 Latency"
          value={data.p50Ms > 0 ? fmtMs(data.p50Ms) : '—'}
          accent={data.p50Ms > 0 ? (data.p50Ms < 500 ? 'success' : data.p50Ms < 2000 ? 'warning' : 'error') : undefined}
        />
        <StatCard
          label="P95 Latency"
          value={data.p95Ms > 0 ? fmtMs(data.p95Ms) : '—'}
          accent={data.p95Ms > 0 ? (data.p95Ms < 500 ? 'success' : data.p95Ms < 2000 ? 'warning' : 'error') : undefined}
        />
      </div>

      {data.byDay.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
          <div className="flex-1 min-h-0 flex">
            {/* Time series */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h3 className="text-sm font-medium text-text-secondary">{cfg.title}</h3>
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
                  {chartType === 'bar' ? (
                    <BarChart data={cfg.data}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} tickFormatter={cfg.yFormatter || axisProps.tickFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [cfg.yFormatter ? cfg.yFormatter(Number(v)) : fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {cfg.keys.map((name, i) => (
                        <Bar
                          key={name}
                          dataKey={name}
                          name={fmtLegendLabel(name)}
                          stackId={cfg.stacked ? 'a' : undefined}
                          fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]}
                          radius={i === cfg.keys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  ) : (
                    <AreaChart data={cfg.data}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} tickFormatter={cfg.yFormatter || axisProps.tickFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [cfg.yFormatter ? cfg.yFormatter(Number(v)) : fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {cfg.keys.map((name, i) => (
                        <Area
                          key={name}
                          type="monotone"
                          dataKey={name}
                          name={fmtLegendLabel(name)}
                          stackId={cfg.stacked ? 'a' : undefined}
                          stroke={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]}
                          fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]}
                          fillOpacity={cfg.stacked ? 0.4 : 0.15}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      ))}
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>

            {/* Distribution panel — only shown when there's donut/bar data */}
            {cfg.distData && cfg.distData.length > 0 && (
              <>
                <div className="w-px bg-border-primary shrink-0 mx-5" />
                <div className="w-[360px] shrink-0 flex flex-col">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <h3 className="text-sm font-medium text-text-secondary">{cfg.distTitle}</h3>
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
                  </div>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      {distChartType === 'donut' ? (
                        <PieChart>
                          <Pie data={cfg.distData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                            {cfg.distData.map((_, i) => <Cell key={i} fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                        </PieChart>
                      ) : (
                        <BarChart layout="vertical" data={cfg.distData}>
                          <CartesianGrid {...gridProps} horizontal={false} />
                          <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                          <YAxis type="category" dataKey="name" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          <Bar dataKey="value" name="Count" radius={[0, 2, 2, 0]}>
                            {cfg.distData.map((_, i) => <Cell key={i} fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                          </Bar>
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-4 mb-1 text-xs shrink-0 flex-wrap">
            {cfg.keys.map((name, i) => (
              <span key={name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length] }} />
                <span className="font-mono text-text-secondary">{fmtLegendLabel(name)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {data.invocations.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            Recent Invocations ({filteredInvocations.length}{(showSuccess !== showErrors || !showSuccess) ? ` of ${data.invocations.length}` : ''})
          </h2>
          <DataTable<InvocationRow>
            data={filteredInvocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
            rowClassName={(row) => row.isError ? 'bg-error/5' : undefined}
            expandedKey={expandedRow}
            onExpandToggle={(key) => setExpandedRow(key === expandedRow ? null : key)}
            renderExpanded={(row) => {
              const fullOutput = row.output || row.errorMessage;
              if (!fullOutput) return <p className="text-xs text-text-muted font-mono">No data</p>;
              return (
                <pre className={clsx(
                  'text-xs font-mono max-h-80 overflow-auto whitespace-pre-wrap break-words leading-relaxed rounded px-3 py-2',
                  row.isError ? 'text-error bg-error/5' : 'text-text-secondary'
                )}>
                  {fullOutput}
                </pre>
              );
            }}
          />
        </div>
      )}

      {data.sourceCode && (
        <CodeBlock
          code={data.sourceCode}
          filename={data.fullCommand?.split(/\s+/).find((p: string) => p.startsWith('/'))?.split('/').pop()}
        />
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
