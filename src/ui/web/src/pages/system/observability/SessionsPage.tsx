import { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsSessions } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { fmtNumber, shortDate } from '../../../utils/format';

type ProjectRow = { project: string; sessions: number };
type HourRow = { hour: number; count: number };

export function SessionsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useObsSessions(days);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load sessions" retry={refetch} />;

  const hourData: HourRow[] = data.byHour.map((h) => ({
    ...h,
    label: `${String(h.hour).padStart(2, '0')}:00`,
  }));

  const projectColumns: Column<ProjectRow>[] = [
    {
      key: 'project',
      label: 'Project',
      render: (row) => <span className="font-mono text-text-primary">{row.project}</span>,
    },
    {
      key: 'sessions',
      label: 'Sessions',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.sessions),
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar days={days} onDaysChange={setDays}>
        <h1 className="text-xl font-semibold text-text-primary">Sessions</h1>
      </ObsControlBar>

      <ChartContainer title="Daily Sessions" chartType={chartType} onChartTypeChange={setChartType}>
        {chartType === 'bar' ? (
          <BarChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Bar dataKey="sessions" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Sessions" />
          </BarChart>
        ) : (
          <LineChart data={data.byDay}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
            <Line type="monotone" dataKey="sessions" stroke={CHART_PALETTE[0]} strokeWidth={2} dot={false} name="Sessions" />
          </LineChart>
        )}
      </ChartContainer>

      <ChartContainer title="Activity by Hour">
        <BarChart data={hourData}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Bar dataKey="count" fill={CHART_PALETTE[2]} radius={[2, 2, 0, 0]} name="Sessions" />
        </BarChart>
      </ChartContainer>

      <DataTable<ProjectRow>
        data={data.byProject}
        columns={projectColumns}
        keyField="project"
      />

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
