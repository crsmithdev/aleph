import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useObsSkills } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer, useChartType } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate } from '../../../utils/format';
import { cn } from '../../../utils/cn';

type SkillRow = { skill: string; count: number; pct: number; errors: number; unused?: boolean };

export function SkillsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showUnused, setShowUnused] = useState(true);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsSkills(range, granularity);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skills" retry={refetch} />;

  const unusedRows: SkillRow[] = (data.unused || []).map(s => ({ skill: s, count: 0, pct: 0, errors: 0, unused: true }));
  const allRows = showUnused ? [...data.ranked, ...unusedRows] : data.ranked;
  const maxCount = Math.max(...data.ranked.map((r) => r.count), 1);

  const columns: Column<SkillRow>[] = [
    {
      key: 'skill',
      label: 'Skill',
      render: (row) => (
        <span className={cn('font-mono', row.unused ? 'text-text-muted' : 'text-text-primary')}>
          {row.skill}
          {row.unused && <span className="ml-2 text-[10px] text-text-disabled uppercase">unused</span>}
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      render: (row) => fmtNumber(row.count),
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className={cn(row.errors > 0 && 'text-error font-medium')}>
          {row.errors > 0 ? fmtNumber(row.errors) : '-'}
        </span>
      ),
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
      width: '25%',
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
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Skills</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        {unusedRows.length > 0 && (
          <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => setShowUnused(!showUnused)} />
        )}
      </ObsControlBar>

      <DataTable<SkillRow>
        data={allRows}
        columns={columns}
        keyField="skill"
        onRowClick={(row) => !row.unused && navigate(`/observability/skills/${encodeURIComponent(row.skill)}`)}
        rowClassName={(row) => row.unused ? 'opacity-50' : undefined}
      />

      {data.byDay.length > 0 && (
        <ChartContainer title="Skill Invocations Over Time" chartType={chartType} onChartTypeChange={setChartType}>
          {chartType === 'bar' ? (
            <BarChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Bar dataKey="count" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Invocations" />
            </BarChart>
          ) : (
            <LineChart data={data.byDay}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle()} labelFormatter={labelFormatter} />
              <Line type="monotone" dataKey="count" stroke={CHART_PALETTE[3]} strokeWidth={2} dot={false} name="Invocations" />
            </LineChart>
          )}
        </ChartContainer>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
