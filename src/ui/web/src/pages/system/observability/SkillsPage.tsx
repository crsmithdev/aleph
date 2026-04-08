import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsSkills } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { type Granularity, type TimeRange } from '../../../components/data/TimeRangeSelector';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, fmtLegendLabel, shortRelativeTime, fmtMs } from '../../../utils/format';
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

type SkillDataset = 'by-skill' | 'by-type' | 'sessions' | 'errors' | 'latency';

const SKILL_DATASETS: { key: SkillDataset; label: string }[] = [
  { key: 'by-skill', label: 'By Skill' },
  { key: 'by-type', label: 'By Type' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'errors', label: 'Errors' },
  { key: 'latency', label: 'Latency' },
];

const GRAN_LABEL: Record<Granularity, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };

export function SkillsPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [showUnused, setShowUnused] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showCommands, setShowCommands] = useState(true);
  const [showSkills, setShowSkills] = useState(true);
  const [dataset, setDataset] = useState<SkillDataset>('by-skill');
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

  // By-skill time series (top 10 skills stacked)
  const top10Skills = data.ranked.slice(0, 10).map(r => r.skill);
  const stackedBySkill = data.byDay.map((d: { date: string; count: number; skills?: Record<string, number> }) => {
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

  // By-type time series (command vs skill stacked)
  const skillTypeMap = Object.fromEntries(data.ranked.map(r => [r.skill, r.type]));
  const stackedByType = data.byDay.map((d: { date: string; count: number; skills?: Record<string, number> }) => {
    let command = 0, skill = 0;
    for (const [skillName, count] of Object.entries(d.skills ?? {})) {
      if (skillTypeMap[skillName] === 'command') command += count;
      else skill += count;
    }
    return { date: d.date, command, skill };
  });

  // Type donut (for "By Type" dataset)
  const donutSource = data.byType ?? [];
  const top5Type = donutSource.slice(0, 5);
  const typeOther = donutSource.slice(5).reduce((s: number, r: { count: number }) => s + r.count, 0);
  const typeDonut = typeOther > 0 ? [...top5Type, { type: 'other', count: typeOther }] : top5Type;

  // Skill donut (for "By Skill" dataset)
  const top5Skills = data.ranked.filter(r => r.count > 0).slice(0, 5);
  const skillsOther = data.ranked.slice(5).reduce((s, r) => s + r.count, 0);
  const skillDonut = skillsOther > 0 ? [...top5Skills, { skill: 'other', count: skillsOther, type: undefined as any }] : top5Skills;

  // Sessions time series (top skills by session count)
  const topSessionSkillNames: string[] = (() => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDaySessions ?? [])) {
      for (const [sk, v] of Object.entries(day.skills ?? {})) totals[sk] = (totals[sk] ?? 0) + v;
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
  })();
  const stackedBySessions = (data.byDaySessions ?? []).map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of topSessionSkillNames) entry[name] = (day.skills ?? {})[name] ?? 0;
    return entry;
  });

  // Errors time series
  const topErrorSkillNames: string[] = (() => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDayErrors ?? [])) {
      for (const [sk, v] of Object.entries(day.skills ?? {})) totals[sk] = (totals[sk] ?? 0) + v;
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
  })();
  const stackedBySkillErrors = (data.byDayErrors ?? []).map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of topErrorSkillNames) entry[name] = (day.skills ?? {})[name] ?? 0;
    return entry;
  });

  // Latency time series
  const topLatencySkillNames: string[] = (() => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDayLatency ?? [])) {
      for (const [sk, v] of Object.entries(day.skills ?? {})) totals[sk] = (totals[sk] ?? 0) + v;
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
  })();
  const stackedBySkillLatency = (data.byDayLatency ?? []).map(day => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of topLatencySkillNames) entry[name] = (day.skills ?? {})[name] ?? 0;
    return entry;
  });

  const topErrorSkillsForDist = [...data.ranked].filter(r => r.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 10);
  const topLatencySkillsForDist = [...data.ranked].filter(r => r.p50Ms != null && r.count > 0).sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0)).slice(0, 10);

  // Sessions donut
  const top5SessionSkills = topSessionSkillNames.slice(0, 5).map(name => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDaySessions ?? [])) {
      for (const [sk, v] of Object.entries(day.skills ?? {})) totals[sk] = (totals[sk] ?? 0) + v;
    }
    return { skill: name, count: totals[name] ?? 0 };
  });
  const sessionsSkillOther = (() => {
    const totals: Record<string, number> = {};
    for (const day of (data.byDaySessions ?? [])) {
      for (const [sk, v] of Object.entries(day.skills ?? {})) totals[sk] = (totals[sk] ?? 0) + v;
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(5).reduce((s, [, v]) => s + v, 0);
  })();
  const sessionsSkillDonut = sessionsSkillOther > 0 ? [...top5SessionSkills, { skill: 'other', count: sessionsSkillOther }] : top5SessionSkills;

  const activeDonut = dataset === 'by-skill' ? skillDonut : dataset === 'by-type' ? typeDonut : dataset === 'sessions' ? sessionsSkillDonut : null;
  const donutTitle = dataset === 'by-skill' ? 'Top Skills'
    : dataset === 'by-type' ? 'Invocations by Type'
    : dataset === 'sessions' ? 'Top Skills by Sessions'
    : null;

  const timeSeriesTitle = dataset === 'by-type'
    ? `${GRAN_LABEL[granularity]} Invocations by Type`
    : dataset === 'sessions'
    ? `${GRAN_LABEL[granularity]} Sessions by Skill`
    : dataset === 'errors'
    ? `${GRAN_LABEL[granularity]} Errors by Skill`
    : dataset === 'latency'
    ? `${GRAN_LABEL[granularity]} Latency by Skill`
    : `${GRAN_LABEL[granularity]} Invocations by Skill`;

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
        ? <span className="text-text-secondary whitespace-nowrap">{shortRelativeTime(row.lastUsed)}</span>
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
        <>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">Dataset</span>
            <div className="flex items-center gap-0.5 rounded-md border border-border-primary bg-bg-tertiary p-0.5">
              {SKILL_DATASETS.map(d => (
                <button
                  key={d.key}
                  onClick={() => setDataset(d.key)}
                  className={clsx(
                    'px-3 py-1 text-xs rounded transition-colors whitespace-nowrap',
                    dataset === d.key
                      ? 'bg-bg-secondary text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-4 items-stretch h-[320px]">
            <div className="flex-1 min-w-0 h-full">
              <ChartContainer title={timeSeriesTitle} chartType={chartType} onChartTypeChange={setChartType} fill className="h-full">
                {dataset === 'by-type' ? (
                  chartType === 'bar' ? (
                    <BarChart data={stackedByType}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Bar dataKey="command" stackId="a" fill={CHART_PALETTE[0]} radius={[0, 0, 0, 0]} name="Command" />
                      <Bar dataKey="skill" stackId="a" fill={CHART_PALETTE[1]} radius={[2, 2, 0, 0]} name="Skill" />
                    </BarChart>
                  ) : (
                    <AreaChart data={stackedByType}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), String(n)]} />
                      <Area type="monotone" dataKey="command" stackId="a" stroke={CHART_PALETTE[0]} fill={CHART_PALETTE[0]} fillOpacity={0.4} strokeWidth={1.5} dot={false} name="Command" />
                      <Area type="monotone" dataKey="skill" stackId="a" stroke={CHART_PALETTE[1]} fill={CHART_PALETTE[1]} fillOpacity={0.4} strokeWidth={1.5} dot={false} name="Skill" />
                    </AreaChart>
                  )
                ) : dataset === 'sessions' ? (
                  chartType === 'bar' ? (
                    <BarChart data={stackedBySessions}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {topSessionSkillNames.map((skill, i) => (
                        <Bar key={skill} dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topSessionSkillNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : (
                    <AreaChart data={stackedBySessions}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {topSessionSkillNames.map((skill, i) => (
                        <Area key={skill} type="monotone" dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.3} dot={false} />
                      ))}
                    </AreaChart>
                  )
                ) : dataset === 'errors' ? (
                  chartType === 'bar' ? (
                    <BarChart data={stackedBySkillErrors}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {topErrorSkillNames.map((skill, i) => (
                        <Bar key={skill} dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topErrorSkillNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : (
                    <AreaChart data={stackedBySkillErrors}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {topErrorSkillNames.map((skill, i) => (
                        <Area key={skill} type="monotone" dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.3} dot={false} />
                      ))}
                    </AreaChart>
                  )
                ) : dataset === 'latency' ? (
                  chartType === 'bar' ? (
                    <BarChart data={stackedBySkillLatency}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtMs(Number(v)), fmtLegendLabel(String(n))]} />
                      {topLatencySkillNames.map((skill, i) => (
                        <Bar key={skill} dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === topLatencySkillNames.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : (
                    <AreaChart data={stackedBySkillLatency}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtMs(Number(v)), fmtLegendLabel(String(n))]} />
                      {topLatencySkillNames.map((skill, i) => (
                        <Area key={skill} type="monotone" dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.3} dot={false} />
                      ))}
                    </AreaChart>
                  )
                ) : chartType === 'bar' ? (
                  hasSkillBreakdown ? (
                    <BarChart data={stackedBySkill}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {top10Skills.map((skill, i) => (
                        <Bar key={skill} dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]} radius={i === top10Skills.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : (
                    <BarChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Bar dataKey="count" fill={CHART_PALETTE[3]} radius={[2, 2, 0, 0]} name="Invocations" />
                    </BarChart>
                  )
                ) : (
                  hasSkillBreakdown ? (
                    <AreaChart data={stackedBySkill}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {top10Skills.map((skill, i) => (
                        <Area key={skill} type="monotone" dataKey={skill} name={fmtLegendLabel(skill)} stackId="a" stroke={CHART_PALETTE[i % CHART_PALETTE.length]} fill={CHART_PALETTE[i % CHART_PALETTE.length]} fillOpacity={0.3} dot={false} />
                      ))}
                    </AreaChart>
                  ) : (
                    <AreaChart data={data.byDay}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                      <Area type="monotone" dataKey="count" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.15} dot={false} name="Invocations" />
                    </AreaChart>
                  )
                )}
              </ChartContainer>
            </div>

            <div className="flex flex-col rounded-lg border border-border-primary bg-bg-secondary p-4 w-[400px] shrink-0 h-full">
              {activeDonut && donutTitle && (
                <>
                  <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">{donutTitle}</h3>
                  <div className="flex-1 min-h-0 flex gap-3">
                    <div className="flex-1 min-w-0 min-h-0 flex items-center">
                      <ResponsiveContainer width="100%" height={212}>
                        <PieChart>
                          <Pie data={activeDonut} dataKey="count" nameKey={dataset === 'by-type' ? 'type' : 'skill'} cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                            {activeDonut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, n: unknown) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-1.5 justify-center shrink-0 w-36">
                      {activeDonut.map((row: { skill?: string; type?: string; count: number }, i: number) => {
                        const label = row.type ?? row.skill ?? '';
                        return (
                          <div key={label} className="flex items-center gap-1.5 text-xs min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                            <span className="font-mono text-text-secondary truncate flex-1">{fmtLegendLabel(label)}</span>
                            <span className="text-text-muted font-mono shrink-0 w-10 text-right">{fmtNumber(row.count)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {dataset === 'errors' && (
                <>
                  <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">Top Skills by Errors</h3>
                  <div className="flex-1 min-h-0">
                    {topErrorSkillsForDist.length > 0 ? (
                      <ResponsiveContainer width="100%" height={212}>
                        <BarChart layout="vertical" data={topErrorSkillsForDist}>
                          <CartesianGrid {...gridProps} horizontal={false} />
                          <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                          <YAxis type="category" dataKey="skill" {...axisProps} width={80} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtNumber(Number(v)), 'Errors']} />
                          <Bar dataKey="errors" fill={CHART_PALETTE[4]} name="Errors" radius={[0, 2, 2, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-text-muted">No errors</div>
                    )}
                  </div>
                </>
              )}

              {dataset === 'latency' && (
                <>
                  <h3 className="mb-3 text-sm font-medium text-text-secondary shrink-0">Top Skills by Latency</h3>
                  <div className="flex-1 min-h-0">
                    {topLatencySkillsForDist.length > 0 ? (
                      <ResponsiveContainer width="100%" height={212}>
                        <BarChart layout="vertical" data={topLatencySkillsForDist}>
                          <CartesianGrid {...gridProps} horizontal={false} />
                          <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtMs(Number(v))} />
                          <YAxis type="category" dataKey="skill" {...axisProps} width={80} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtMs(Number(v)), 'p50 Latency']} />
                          <Bar dataKey="p50Ms" fill={CHART_PALETTE[1]} name="p50 Latency" radius={[0, 2, 2, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-text-muted">No latency data</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
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
