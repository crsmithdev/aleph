import { useState } from 'react';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useObsTokens, useObsCost } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { fmtCurrency, fmtNumber, fmtPct, shortDate } from '../../../utils/format';

type ModelRow = { model: string; usd: number; pct: number };

export function TokensCostPage() {
  const [days, setDays] = useState(30);
  const tokens = useObsTokens(days);
  const cost = useObsCost(days);
  const { chartType: tokensChartType, setChartType: setTokensChartType } = useChartType('line');
  const { chartType: costChartType, setChartType: setCostChartType } = useChartType('line');

  if (tokens.isLoading || cost.isLoading) return <PageLoading />;
  if (tokens.error || !tokens.data)
    return <ErrorState message="Failed to load token data" retry={tokens.refetch} />;
  if (cost.error || !cost.data)
    return <ErrorState message="Failed to load cost data" retry={cost.refetch} />;

  const avgDaily = cost.data.byDay.length > 0
    ? cost.data.totalUsd / cost.data.byDay.length
    : 0;

  const modelColumns: Column<ModelRow>[] = [
    {
      key: 'model',
      label: 'Model',
      render: (row) => <span className="font-mono text-text-primary">{row.model}</span>,
    },
    {
      key: 'usd',
      label: 'Cost',
      align: 'right',
      sortable: true,
      render: (row) => fmtCurrency(row.usd),
    },
    {
      key: 'pct',
      label: '%',
      align: 'right',
      sortable: true,
      render: (row) => fmtPct(row.pct),
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar days={days} onDaysChange={setDays}>
        <h1 className="text-xl font-semibold text-text-primary">Tokens & Cost</h1>
      </ObsControlBar>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Total Cost" value={fmtCurrency(cost.data.totalUsd)} accent="success" />
        <StatCard label="Avg Daily" value={fmtCurrency(avgDaily)} />
      </div>

      <ChartContainer title="Tokens per Day" chartType={tokensChartType} onChartTypeChange={setTokensChartType}>
        {tokensChartType === 'bar' ? (
          <BarChart data={tokens.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} tickFormatter={fmtNumber} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Legend />
            <Bar dataKey="input" stackId="tokens" fill={CHART_PALETTE[0]} name="Input" />
            <Bar dataKey="output" stackId="tokens" fill={CHART_PALETTE[1]} name="Output" />
            <Bar dataKey="cacheRead" stackId="tokens" fill={CHART_PALETTE[2]} name="Cache Read" />
          </BarChart>
        ) : (
          <AreaChart data={tokens.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} tickFormatter={fmtNumber} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Legend />
            <Area type="monotone" dataKey="input" stackId="tokens" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} name="Input" />
            <Area type="monotone" dataKey="output" stackId="tokens" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} name="Output" />
            <Area type="monotone" dataKey="cacheRead" stackId="tokens" stroke={CHART_PALETTE[2]} fill={CHART_PALETTE[2]} fillOpacity={0.3} name="Cache Read" />
          </AreaChart>
        )}
      </ChartContainer>

      <ChartContainer title="Cost per Day" chartType={costChartType} onChartTypeChange={setCostChartType}>
        {costChartType === 'bar' ? (
          <BarChart data={cost.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} formatter={(value) => [fmtCurrency(Number(value ?? 0)), 'Cost']} />
            <Bar dataKey="usd" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Cost" />
          </BarChart>
        ) : (
          <LineChart data={cost.data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} formatter={(value) => [fmtCurrency(Number(value ?? 0)), 'Cost']} />
            <Line type="monotone" dataKey="usd" stroke={CHART_PALETTE[3]} strokeWidth={2} dot={false} name="Cost" />
          </LineChart>
        )}
      </ChartContainer>

      <DataTable<ModelRow>
        data={cost.data.byModel}
        columns={modelColumns}
        keyField="model"
      />

      <QueryTiming ms={(tokens.data.queryTimeMs || 0) + (cost.data.queryTimeMs || 0)} />
    </div>
  );
}
