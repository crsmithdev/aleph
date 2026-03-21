import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsSessions } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, shortDate } from '../../../utils/format';

type ProjectRow = { project: string; sessions: number };
type HourRow = { hour: number; count: number };

export function SessionsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useObsSessions(days);

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Sessions</h1>
        <TimeRangeSelector value={days} onChange={setDays} />
      </div>

      <ChartContainer title="Daily Sessions">
        <BarChart data={data.byDay}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
          <Bar dataKey="sessions" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Sessions" />
        </BarChart>
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
    </div>
  );
}
