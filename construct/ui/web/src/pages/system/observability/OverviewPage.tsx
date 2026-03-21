import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsOverview } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtCurrency, shortDate } from '../../../utils/format';

export function OverviewPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useObsOverview(days);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load overview" retry={refetch} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Overview</h1>
        <TimeRangeSelector value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sessions" value={fmtNumber(data.sessions)} />
        <StatCard label="Messages" value={fmtNumber(data.messages)} />
        <StatCard label="Tool Calls" value={fmtNumber(data.toolCalls)} />
        <StatCard label="Total Cost" value={fmtCurrency(data.totalCost)} accent="success" />
      </div>

      <ChartContainer title="Daily Activity">
        <AreaChart data={data.byDay}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
          <Area
            type="monotone"
            dataKey="messages"
            stroke={CHART_PALETTE[0]}
            fill={CHART_PALETTE[0]}
            fillOpacity={0.15}
            name="Messages"
          />
          <Area
            type="monotone"
            dataKey="sessions"
            stroke={CHART_PALETTE[1]}
            fill={CHART_PALETTE[1]}
            fillOpacity={0.15}
            name="Sessions"
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
