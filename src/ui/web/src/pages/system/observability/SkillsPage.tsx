import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
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
import { fmtNumber, fmtPct, shortDate, fmtSeriesName, shortRelativeTime, fmtMs } from '../../../utils/format';
import { clsx } from 'clsx';

type SkillRow = {
  skill: string;
  count: number;
  pct: number;
  errors: number;
  sessions?: number;
  avgMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  lastUsed?: string;
  type?: 'command' | 'skill';
  registered?: boolean;
  unused?: boolean;
};

export function SkillsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showUnused, setShowUnused] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
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

  const missingCount = data.ranked.filter(r => !r.registered).length;

  let ranked = !showMissing ? data.ranked.filter(r => r.registered) : data.ranked;
  let allRows: SkillRow[] = showUnused ? [...ranked, ...unusedRows] : [...ranked];
  if (!showCommands && showSkills) allRows = allRows.filter(r => r.type === 'skill');
  else if (showCommands && !showSkills) allRows = allRows.filter(r => r.type === 'command');

  const commandCount = data.ranked.filter(r => r.type === 'command').length;
  const skillCount = data.ranked.filter(r => r.type === 'skill').length;
  const totalInvocations = data.ranked.reduce((s, r) => s + r.count, 0);
  const activeSkills = data.ranked.length;

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
          {row.unused && <span className="ml-2 text-xs text-text-disabled uppercase">unused</span>}
          {!row.registered && !row.unused && <span className="ml-2 text-xs text-warning uppercase">missing</span>}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      sortable: true,
      width: '5rem',
      render: (row) => (
        <span className={clsx(
          'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide',
          row.type === 'command'
            ? 'bg-accent/10 text-accent border border-accent/20'
            : 'bg-accent/5 text-accent/70 border border-accent/10',
        )}>
          {row.type === 'command' ? 'cmd' : 'skill'}
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Count',
      align: 'right',
      sortable: true,
      width: '4.5rem',
      render: (row) => <span className="font-mono">{fmtNumber(row.count)}</span>,
    },
    {
      key: 'pct',
      label: '%',
      align: 'right',
      sortable: true,
      width: '3.5rem',
      render: (row) => <span className="font-mono">{fmtPct(row.pct)}</span>,
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      width: '5rem',
      render: (row) => row.errors > 0
        ? <span className="text-error font-mono">{fmtNumber(row.errors)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'sessions',
      label: 'Sessions',
      align: 'right',
      sortable: true,
      width: '5.5rem',
      render: (row) => (row.sessions ?? 0) > 0
        ? <span className="font-mono">{fmtNumber(row.sessions!)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'p50Ms',
      label: 'P50',
      align: 'right',
      sortable: true,
      width: '4.5rem',
      render: (row) => row.p50Ms != null
        ? <span className="text-text-secondary font-mono">{fmtMs(row.p50Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      width: '4.5rem',
      render: (row) => row.p95Ms != null
        ? <span className="text-text-secondary font-mono">{fmtMs(row.p95Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'lastUsed',
      label: 'Last Use',
      sortable: true,
      width: '60px',
      render: (row) => row.lastUsed
        ? <span className="font-mono text-text-secondary whitespace-nowrap">{shortRelativeTime(row.lastUsed)}</span>
        : <span className="text-text-disabled">—</span>,
    },
  ];

  const filters = (
    <>
      <FilterToggle label={`Commands (${commandCount})`} active={showCommands} onToggle={() => setShowCommands(!showCommands)} />
      <FilterToggle label={`Skills (${skillCount})`} active={showSkills} onToggle={() => setShowSkills(!showSkills)} />
      {missingCount > 0 && (
        <FilterToggle label={`Missing (${missingCount})`} active={showMissing} onToggle={() => setShowMissing(!showMissing)} activeColor="error" />
      )}
      {unusedRows.length > 0 && (
        <FilterToggle label={`Unused (${unusedRows.length})`} active={showUnused} onToggle={() => setShowUnused(!showUnused)} />
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={<h1 className="font-heading text-2xl font-bold text-text-primary">Skills</h1>}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      >
        {filters}
      </ObsControlBar>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(totalInvocations)} />
        <StatCard label="Active Skills" value={fmtNumber(activeSkills)} />
        <StatCard label="Commands" value={fmtNumber(commandCount)} />
        <StatCard label="Skills" value={fmtNumber(skillCount)} />
      </div>

      {data.byDay.length > 0 && (
        <div className="flex gap-4 items-stretch h-[320px]">
          <div className="flex-1 min-w-0 h-full">
            <ChartContainer title="Invocations by Name" chartType={chartType} onChartTypeChange={setChartType} fill className="h-full">
              {chartType === 'bar' ? (
                hasSkillBreakdown ? (
                  <BarChart data={stackedByDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
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
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {top10Skills.map((skill, i) => (
                      <Area key={skill} type="monotone" dataKey={skill} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.3} dot={false} />
                    ))}
                  </AreaChart>
                ) : (
                  <AreaChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area type="monotone" dataKey="count" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.15} dot={false} name="Invocations" />
                  </AreaChart>
                )
              )}
            </ChartContainer>
          </div>

          {data.byType && data.byType.length > 1 && (() => {
            const top5 = data.byType.slice(0, 5);
            const other = data.byType.slice(5).reduce((s: number, r: { count: number }) => s + r.count, 0);
            const donut = other > 0 ? [...top5, { type: 'other', count: other }] : top5;
            return (
              <div className="flex flex-col rounded-lg border border-border-primary bg-bg-secondary p-4 w-1/4 min-w-[220px] shrink-0 h-full">
                <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">Invocations by Type</h3>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="count" nameKey="type" cx="50%" cy="50%" innerRadius={50} outerRadius={78}>
                        {donut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, n: unknown) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-3 shrink-0">
                  {donut.map((row: { type: string; count: number }, i: number) => (
                    <div key={row.type} className="flex items-center gap-1.5 text-xs min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="text-text-secondary capitalize truncate">{row.type}</span>
                      <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

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
