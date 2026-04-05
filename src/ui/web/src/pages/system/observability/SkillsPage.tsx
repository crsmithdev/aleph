import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { useObsSkills } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, fmtSeriesName } from '../../../utils/format';
import { clsx } from 'clsx';

type SkillRow = {
  skill: string;
  count: number;
  pct: number;
  errors: number;
  type?: 'command' | 'skill';
  registered?: boolean;
  unused?: boolean;
};

export function SkillsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showUnused, setShowUnused] = useState(true);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [showCommands, setShowCommands] = useState(true);
  const [showSkills, setShowSkills] = useState(true);
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useObsSkills(range, granularity);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skills" retry={refetch} />;

  const unusedRows: SkillRow[] = (data.unused || []).map((s: string | { name: string; type: 'command' | 'skill' }) => {
    const name = typeof s === 'string' ? s : s.name;
    const type = typeof s === 'string' ? 'skill' as const : s.type;
    return { skill: name, count: 0, pct: 0, errors: 0, type, unused: true };
  });
  let ranked = installedOnly ? data.ranked.filter(r => r.registered) : data.ranked;
  let allRows: SkillRow[] = showUnused ? [...ranked, ...unusedRows] : [...ranked];
  if (!showCommands && showSkills) allRows = allRows.filter(r => r.type === 'skill');
  else if (showCommands && !showSkills) allRows = allRows.filter(r => r.type === 'command');

  const commandCount = data.ranked.filter(r => r.type === 'command').length;
  const skillCount = data.ranked.filter(r => r.type === 'skill').length;
  const totalInvocations = data.ranked.reduce((s, r) => s + r.count, 0);
  const activeSkills = data.ranked.length;

  // Build top 10 skills for stacked chart
  const top10Skills = data.ranked.slice(0, 10).map(r => r.skill);
  const stackedByDay = data.byDay.map((d: { date: string; count: number; skills?: Record<string, number> }) => {
    const row: Record<string, unknown> = { date: d.date };
    if (d.skills) {
      for (const skill of top10Skills) {
        row[skill] = d.skills[skill] ?? 0;
      }
    } else {
      row['count'] = d.count;
    }
    return row;
  });
  const hasSkillBreakdown = data.byDay.length > 0 && data.byDay[0]?.skills != null;

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
        <span className={clsx('font-mono', row.unused ? 'text-text-muted' : 'text-text-primary')}>
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
        <span className={clsx(
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
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar title={<h1 className="text-2xl font-bold text-text-primary">Skills</h1>} range={range} onRangeChange={setRange} granularity={granularity} onGranularityChange={setGranularity}>
        <FilterToggle label="Installed only" active={installedOnly} onToggle={() => setInstalledOnly(!installedOnly)} />
        {unusedRows.length > 0 && (
          <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => setShowUnused(!showUnused)} />
        )}
      </ObsControlBar>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(totalInvocations)} />
        <StatCard label="Active Skills" value={fmtNumber(activeSkills)} />
        <StatCard label="Commands" value={fmtNumber(commandCount)} />
        <StatCard label="Skills" value={fmtNumber(skillCount)} />
      </div>

      {data.byDay.length > 0 && (
        <div className="flex gap-4 items-stretch">
          <div className="flex-1">
            <ChartContainer title="Skill Invocations Over Time" chartType={chartType} onChartTypeChange={setChartType}>
              {chartType === 'bar' ? (
                hasSkillBreakdown ? (
                  <BarChart data={stackedByDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    {top10Skills.map((skill, i) => (
                      <Bar key={skill} dataKey={skill} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === top10Skills.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                ) : (
                  <BarChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Bar dataKey="count" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Invocations" />
                  </BarChart>
                )
              ) : (
                hasSkillBreakdown ? (
                  <AreaChart data={stackedByDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    {top10Skills.map((skill, i) => (
                      <Area key={skill} type="natural" dataKey={skill} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.3} dot={false} />
                    ))}
                  </AreaChart>
                ) : (
                  <AreaChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area type="natural" dataKey="count" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.15} dot={false} name="Invocations" />
                  </AreaChart>
                )
              )}
            </ChartContainer>
          </div>

          {data.byType && data.byType.length > 1 && (
            <div className="rounded-lg border border-border-primary bg-bg-secondary p-4" style={{ width: 180 }}>
              <h3 className="mb-3 text-sm font-medium text-text-secondary">By Type</h3>
              <div className="flex flex-col items-center gap-4">
                <PieChart width={120} height={120}>
                  <Pie data={data.byType} dataKey="count" nameKey="type" cx="50%" cy="50%" innerRadius={30} outerRadius={50}>
                    {data.byType.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, n: unknown) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                </PieChart>
                <div className="flex flex-col gap-2 w-full">
                  {data.byType.map((row: { type: string; count: number }, i: number) => (
                    <div key={row.type} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="text-text-secondary capitalize">{row.type}</span>
                      <span className="ml-auto text-text-muted font-mono">{fmtNumber(row.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <FilterToggle
          label={`Commands (${commandCount})`}
          active={showCommands}
          onToggle={() => setShowCommands(!showCommands)}
        />
        <FilterToggle
          label={`Skills (${skillCount})`}
          active={showSkills}
          onToggle={() => setShowSkills(!showSkills)}
        />
      </div>

      <DataTable<SkillRow>
        data={allRows}
        columns={columns}
        keyField="skill"
        onRowClick={(row) => !row.unused && navigate(`/observability/skills/${encodeURIComponent(row.skill)}`)}
        rowClassName={(row) => row.unused ? 'opacity-50' : undefined}
      />

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
