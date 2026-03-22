import { useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsOverview } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtCurrency, fmtPct, shortDate } from '../../../utils/format';

export function OverviewPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useObsOverview(days);
  const { chartType, setChartType } = useChartType('line');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load overview" retry={refetch} />;

  const toolSuccessPct = data.toolCalls > 0
    ? ((data.toolCalls - data.toolErrors) / data.toolCalls) * 100
    : 100;

  return (
    <div className="space-y-6">
      <ObsControlBar days={days} onDaysChange={setDays}>
        <h1 className="text-xl font-semibold text-text-primary">Overview</h1>
      </ObsControlBar>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Sessions" value={fmtNumber(data.sessions)} />
        <StatCard label="Messages" value={fmtNumber(data.messages)} />
        <StatCard label="Tool Calls" value={fmtNumber(data.toolCalls)} />
        <StatCard
          label="Tool Success"
          value={fmtPct(toolSuccessPct)}
          accent={toolSuccessPct >= 99 ? 'success' : toolSuccessPct >= 95 ? 'warning' : 'error'}
          detail={`${fmtNumber(data.toolErrors)} errors`}
        />
        <StatCard label="Total Cost" value={fmtCurrency(data.totalCost)} accent="success" />
      </div>

      <ChartContainer title="Daily Activity" chartType={chartType} onChartTypeChange={setChartType}>
        {chartType === 'bar' ? (
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="messages" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Messages" />
            <Bar dataKey="sessions" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Sessions" />
          </BarChart>
        ) : (
          <AreaChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Area type="monotone" dataKey="messages" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.15} name="Messages" />
            <Area type="monotone" dataKey="sessions" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.15} name="Sessions" />
          </AreaChart>
        )}
      </ChartContainer>

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
