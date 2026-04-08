import { useState } from 'react';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { useObsTokens, useObsCost } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps, xAxisDateProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { fmtCurrency, fmtNumber, fmtPct, shortDate, granLabel, rangeToDays, formatModelName } from '../../../utils/format';

type ModelRow = { model: string; usd: number; pct: number };

export function TokensCostPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const tokens = useObsTokens(range, granularity);
  const cost = useObsCost(range, granularity);
  const [tokensChartType, setTokensChartType] = useState<'bar' | 'line'>('line');
  const [costChartType, setCostChartType] = useState<'bar' | 'line'>('line');

  if (tokens.isLoading || cost.isLoading) return <PageLoading />;
  if (tokens.error || !tokens.data)
    return <ErrorState message="Failed to load token data" retry={tokens.refetch} />;
  if (cost.error || !cost.data)
    return <ErrorState message="Failed to load cost data" retry={cost.refetch} />;

  const days = rangeToDays(range);
  const avgDaily = days > 0
    ? cost.data.totalUsd / days
    : 0;

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="font-heading text-2xl font-bold text-text-primary">Tokens</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Cost" value={fmtCurrency(cost.data.totalUsd)} accent="success" />
        <StatCard label="Avg / Day" value={fmtCurrency(avgDaily)} />
        <StatCard
          label="Cache Efficiency"
          value={fmtPct(tokens.data.cacheEfficiency)}
          accent={tokens.data.cacheEfficiency >= 80 ? 'success' : tokens.data.cacheEfficiency >= 50 ? 'warning' : 'error'}
          detailContent={<><span className="text-success font-medium">{fmtNumber(tokens.data.totalCacheRead)}</span><span className="text-text-muted"> read / </span><span className="text-warning font-medium">{fmtNumber(tokens.data.totalCacheCreation)}</span><span className="text-text-muted"> created</span></>}
        />
        <StatCard label="Total Tokens" value={fmtNumber(tokens.data.totalInput + tokens.data.totalOutput)} detailContent={<><span className="text-text-secondary font-medium">{fmtNumber(tokens.data.totalInput)}</span><span className="text-text-muted"> in / </span><span className="text-text-secondary font-medium">{fmtNumber(tokens.data.totalOutput)}</span><span className="text-text-muted"> out</span></>} />
      </div>

      <ChartContainer title={granLabel(granularity, "Tokens")} chartType={tokensChartType} onChartTypeChange={setTokensChartType}>
        {tokensChartType === 'bar' ? (
          <BarChart data={tokens.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} tickFormatter={fmtNumber} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Legend {...legendProps} />
            <Bar dataKey="input" stackId="tokens" fill={CHART_PALETTE[0]} name="Input" />
            <Bar dataKey="output" stackId="tokens" fill={CHART_PALETTE[1]} name="Output" />
            <Bar dataKey="cacheRead" stackId="tokens" fill={CHART_PALETTE[2]} name="Cache Read" />
          </BarChart>
        ) : (
          <AreaChart data={tokens.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} tickFormatter={fmtNumber} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Legend {...legendProps} />
            <Area type="monotone" dataKey="input" stackId="tokens" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} name="Input" />
            <Area type="monotone" dataKey="output" stackId="tokens" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} name="Output" />
            <Area type="monotone" dataKey="cacheRead" stackId="tokens" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.3} name="Cache Read" />
          </AreaChart>
        )}
      </ChartContainer>

      <ChartContainer title={granLabel(granularity, "Cost")} chartType={costChartType} onChartTypeChange={setCostChartType}>
        {costChartType === 'bar' ? (
          <BarChart data={cost.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(value) => [fmtCurrency(Number(value ?? 0)), 'Cost']} />
            <Bar dataKey="usd" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Cost" />
          </BarChart>
        ) : (
          <LineChart data={cost.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(value) => [fmtCurrency(Number(value ?? 0)), 'Cost']} />
            <Line type="monotone" dataKey="usd" stroke={CHART_PALETTE[3]} strokeWidth={2} dot={false} name="Cost" />
          </LineChart>
        )}
      </ChartContainer>

      {cost.data.byModel.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <h3 className="mb-3 text-sm font-medium text-text-secondary">Cost by Model</h3>
          <div className="flex items-center gap-6">
            <PieChart width={160} height={160}>
              <Pie data={cost.data.byModel} dataKey="usd" nameKey="model" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                {cost.data.byModel.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtCurrency(Number(v)), formatModelName(String(n))]} />
            </PieChart>
            <div className="flex flex-col gap-2 min-w-0">
              {cost.data.byModel.map((row, i) => (
                <div key={row.model} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                  <span className="font-mono text-text-secondary truncate">{formatModelName(row.model)}</span>
                  <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtCurrency(row.usd)}</span>
                  <span className="text-text-disabled font-mono shrink-0 w-10 text-right">{fmtPct(row.pct)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <QueryTiming ms={(tokens.data.queryTimeMs || 0) + (cost.data.queryTimeMs || 0)} />
    </div>
  );
}
