import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useResearchStats, useResearchQueries } from '../../api/research-hooks';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/data/StatCard';
import { ObsControlBar } from '../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps, xAxisDateProps } from '../../components/charts/chartTheme';
import { fmtCurrency, fmtNumber, fmtPct, granLabel } from '../../utils/format';

export function ResearchDashboardPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data: queries = [] } = useResearchQueries();
  const stats = useResearchStats(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  const visibleQueries = queries.filter(q => q.status !== 'archived');

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <div className="flex items-center justify-between w-full">
            <h1 className="font-heading text-2xl font-bold text-text-primary">Deep Research</h1>
            <Link to="/research/queries">
              <Button variant="secondary" size="sm">
                {visibleQueries.length} quer{visibleQueries.length !== 1 ? 'ies' : 'y'} →
              </Button>
            </Link>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {stats.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Queries"
              value={fmtNumber(stats.data.totalSessions)}
              accent="default"
              detailContent={
                <><span className="text-success font-medium">{stats.data.activeSessions}</span><span className="text-text-muted"> active</span></>
              }
            />
            <StatCard label="Findings" value={fmtNumber(stats.data.totalFindings)} accent="success" />
            <StatCard label="Total Cost" value={fmtCurrency(stats.data.totalCost)} />
            <StatCard
              label="Avg Confidence"
              value={fmtPct(stats.data.avgConfidence)}
              accent={stats.data.avgConfidence >= 70 ? 'success' : stats.data.avgConfidence >= 40 ? 'warning' : 'error'}
              detailContent={
                <><span className="text-text-muted">novelty </span><span className="text-text-secondary font-medium">{fmtPct(stats.data.avgNovelty)}</span></>
              }
            />
          </div>

          {stats.data.byDay.length > 0 && (
            <ChartContainer title={granLabel(granularity, 'Activity')} chartType={chartType} onChartTypeChange={setChartType}>
              {chartType === 'bar' ? (
                <BarChart data={stats.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Bar dataKey="findings" fill={CHART_PALETTE[0]} name="Findings" />
                  <Bar dataKey="sessions" fill={CHART_PALETTE[1]} name="Sessions" />
                </BarChart>
              ) : (
                <AreaChart data={stats.data.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Area type="monotone" dataKey="findings" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.3} name="Findings" />
                  <Area type="monotone" dataKey="sessions" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.3} name="Sessions" />
                </AreaChart>
              )}
            </ChartContainer>
          )}
        </>
      )}
    </div>
  );
}
