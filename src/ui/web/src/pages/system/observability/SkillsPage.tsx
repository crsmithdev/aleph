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

type SkillRow = {
  skill: string;
  count: number;
  pct: number;
  errors: number;
  type?: 'command' | 'skill';
  registered?: boolean;
  unused?: boolean;
};

type TypeFilter = 'all' | 'command' | 'skill';

export function SkillsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showUnused, setShowUnused] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsSkills(range, granularity);
  const { chartType, setChartType } = useChartType('bar');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skills" retry={refetch} />;

  const unusedRows: SkillRow[] = (data.unused || []).map((s: string | { name: string; type: 'command' | 'skill' }) => {
    const name = typeof s === 'string' ? s : s.name;
    const type = typeof s === 'string' ? 'skill' as const : s.type;
    return { skill: name, count: 0, pct: 0, errors: 0, type, unused: true };
  });
  let allRows: SkillRow[] = showUnused ? [...data.ranked, ...unusedRows] : [...data.ranked];
  if (typeFilter !== 'all') allRows = allRows.filter(r => r.type === typeFilter);
  const maxCount = Math.max(...data.ranked.map((r) => r.count), 1);

  const commandCount = data.ranked.filter(r => r.type === 'command').length;
  const skillCount = data.ranked.filter(r => r.type === 'skill').length;

  function displayName(row: SkillRow): string {
    if (row.type === 'command') {
      return row.skill.startsWith('/') ? row.skill : `/${row.skill}`;
    }
    return row.skill;
  }

  const columns: Column<SkillRow>[] = [
    {
      key: 'skill',
      label: 'Name',
      sortable: true,
      render: (row) => (
        <span className={cn('font-mono', row.unused ? 'text-text-muted' : 'text-text-primary')}>
          {displayName(row)}
          {row.unused && <span className="ml-2 text-[10px] text-text-disabled uppercase">unused</span>}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      width: '6rem',
      render: (row) => (
        <span className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
          row.type === 'command'
            ? 'bg-accent/10 text-accent border border-accent/20'
            : 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
        )}>
          {row.type === 'command' ? 'command' : 'skill'}
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
      key: 'pct',
      label: '%',
      align: 'right',
      sortable: true,
      render: (row) => fmtPct(row.pct),
    },
    {
      key: 'bar',
      label: '',
      width: '20%',
      render: (row) => (
        <div className="h-2 w-full rounded-full bg-bg-tertiary">
          <div
            className={cn('h-2 rounded-full', row.type === 'command' ? 'bg-accent' : 'bg-purple-500')}
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

      <div className="flex items-center gap-2">
        {(['all', 'command', 'skill'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-xs border transition-colors',
              typeFilter === t
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border-primary bg-bg-secondary text-text-muted',
            )}
          >
            {t === 'all' ? 'All' : t === 'command' ? 'Commands' : 'Skills'}
            <span className="text-text-disabled">
              ({t === 'all' ? data.ranked.length : t === 'command' ? commandCount : skillCount})
            </span>
          </button>
        ))}
      </div>

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
