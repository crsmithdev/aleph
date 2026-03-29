import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useObsCompliance, type ComplianceData } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, legendProps } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { fmtPct, fmtNumber, relativeTime, shortDate, granLabel } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type DirectiveRow = ComplianceData['byDirective'][number];
type ViolationRow = ComplianceData['violations'][number];

function complianceColor(rate: number): string {
  if (rate >= 80) return 'text-success';
  if (rate >= 50) return 'text-warning';
  return 'text-error';
}

export function CompliancePage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const { data, isLoading, error, refetch } = useObsCompliance(range, granularity);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load compliance data" retry={refetch} />;

  const overallRate = data.overall.rate ?? 0;
  const violationCount = data.violations?.length ?? 0;

  const directiveColumns: Column<DirectiveRow>[] = [
    {
      key: 'directive',
      label: 'Directive',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.directive}</span>,
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.total),
    },
    {
      key: 'followed',
      label: 'Followed',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.followed),
    },
    {
      key: 'rate',
      label: 'Rate',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cn(complianceColor(row.rate))}>{fmtPct(row.rate)}</span>
      ),
    },
  ];

  const violationColumns: Column<ViolationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      sortable: true,
      render: (row) => <span className="text-text-secondary text-xs">{relativeTime(row.timestamp)}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      render: (row) => (
        <Link
          to={`/observability/sessions/${encodeURIComponent(row.sessionId)}`}
          className="font-mono text-xs text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.sessionId.slice(0, 8)}…
        </Link>
      ),
    },
    {
      key: 'directive',
      label: 'Directive',
      render: (row) => <span className="font-mono text-text-primary text-xs">{row.directive}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="text-2xl font-bold text-text-primary">Compliance</h1>}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Overall Rate"
          value={<span className={cn(complianceColor(overallRate))}>{fmtPct(overallRate)}</span>}
        />
        <StatCard label="Total Directives" value={fmtNumber(data.overall.total)} />
        <StatCard label="Violations" value={fmtNumber(violationCount)} />
      </div>

      {data.byDay && data.byDay.length > 0 && (
        <ChartContainer title={granLabel(granularity, 'Compliance Rate')} chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} formatter={(v: number) => fmtPct(v)} />
              <Legend {...legendProps} />
              <Bar dataKey="followed" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="Followed" stackId="a" />
              <Bar
                dataKey="violations"
                fill={CHART_PALETTE[3]}
                radius={[2, 2, 0, 0]}
                name="Violations"
                stackId="a"
                data={data.byDay.map((d) => ({ ...d, violations: d.total - d.followed }))}
              />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} formatter={(v: number) => fmtPct(v)} />
              <Legend {...legendProps} />
              <Line type="monotone" dataKey="rate" stroke={CHART_PALETTE[2]} strokeWidth={2} dot={false} name="Rate %" />
            </LineChart>
          )}
        </ChartContainer>
      )}

      {data.byDirective && data.byDirective.length > 0 && (
        <DataTable<DirectiveRow>
          data={data.byDirective}
          columns={directiveColumns}
          keyField="directive"
        />
      )}

      {data.violations && data.violations.length > 0 && (
        <DataTable<ViolationRow>
          data={data.violations}
          columns={violationColumns}
          keyField="timestamp"
        />
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
