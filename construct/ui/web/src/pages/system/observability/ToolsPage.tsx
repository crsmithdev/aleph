import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsTools } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { TimeRangeSelector } from '../../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate } from '../../../utils/format';

type ToolRow = { name: string; count: number; errorCount: number; pct: number };

export function ToolsPage() {
  const [days, setDays] = useState(30);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsTools(days);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tools" retry={refetch} />;

  const maxCount = Math.max(...data.ranked.map((r) => r.count), 1);

  const columns: Column<ToolRow>[] = [
    {
      key: 'name',
      label: 'Tool',
      render: (row) => <span className="font-mono text-text-primary">{row.name}</span>,
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
    {
      key: 'pct',
      label: '%',
      align: 'right',
      sortable: true,
      render: (row) => fmtPct(row.pct),
    },
    {
      key: 'bar',
      label: '',
      width: '30%',
      render: (row) => (
        <div className="h-2 w-full rounded-full bg-bg-tertiary">
          <div
            className="h-2 rounded-full bg-accent"
            style={{ width: `${(row.count / maxCount) * 100}%` }}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Tools</h1>
        <TimeRangeSelector value={days} onChange={setDays} />
      </div>

      <DataTable<ToolRow>
        data={data.ranked}
        columns={columns}
        keyField="name"
        onRowClick={(row) => navigate(`/system/observability/tools/${encodeURIComponent(row.name)}`)}
      />

      <ChartContainer title="Tool Calls per Day">
        <BarChart data={data.byDay}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
          <Bar dataKey="count" fill={CHART_PALETTE[0]} radius={[2, 2, 0, 0]} name="Calls" />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
