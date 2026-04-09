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
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtLegendLabel, shortRelativeTime, fmtMs } from '../../../utils/format';
import { clsx } from 'clsx';

type SkillRow = {
  skill: string;
  count: number;
  pct: number;
  errors: number;
  successRate: number;
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
  const [distChartType, setDistChartType] = useState<'donut' | 'bar'>('donut');

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skills" retry={refetch} />;

  const unusedRows: SkillRow[] = (data.unused || []).map((s: string | { name: string; type: 'command' | 'skill' }) => {
    const name = typeof s === 'string' ? s : s.name;
    const type = typeof s === 'string' ? 'skill' as const : s.type;
    return { skill: name, count: 0, pct: 0, errors: 0, successRate: 100, type, unused: true };
  });

  const missingCount = data.ranked.filter(r => !r.registered).length;

  let ranked = !showMissing ? data.ranked.filter(r => r.registered) : data.ranked;
  let allRows: SkillRow[] = (showUnused ? [...ranked, ...unusedRows] : [...ranked]) as SkillRow[];
  if (!showCommands && showSkills) allRows = allRows.filter(r => r.type === 'skill');
  else if (showCommands && !showSkills) allRows = allRows.filter(r => r.type === 'command');

  allRows = allRows.map(r => ({
    ...r,
    successRate: r.count > 0 ? ((r.count - r.errors) / r.count) * 100 : 100,
  }));

  const commandCount = data.ranked.filter(r => r.type === 'command').length;
  const skillCount = data.ranked.filter(r => r.type === 'skill').length;
  const totalInvocations = data.ranked.reduce((s, r) => s + r.count, 0);
  const activeSkills = data.ranked.length;
  const totalErrors = data.ranked.reduce((s, r) => s + r.errors, 0);
  const avgSuccessRate = totalInvocations > 0 ? ((totalInvocations - totalErrors) / totalInvocations) * 100 : 100;

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

  const distTitle = dataset === 'errors' ? 'Top Skills by Errors'
    : dataset === 'latency' ? 'Top Skills by Latency'
    : donutTitle ?? 'Distribution';

  function displayName(row: SkillRow): string {
    if (row.type === 'command') {
      return row.skill.startsWith('/') ? row.skill : `/${row.skill}`;
    }
    return row.skill;
  }

  const tsKeys = dataset === 'by-type' ? ['command', 'skill']
    : dataset === 'sessions' ? topSessionSkillNames
    : dataset === 'errors' ? topErrorSkillNames
    : dataset === 'latency' ? topLatencySkillNames
    : top10Skills;

  const showDonutBarToggle = dataset === 'by-skill' || dataset === 'by-type' || dataset === 'sessions';

  const columns: Column<SkillRow>[] = [
    {
      key: 'skill',
      label: 'Name',
      sortable: true,
      shrink: true,
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
      shrink: true,
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
      shrink: true,
      render: (row) => <span className="font-mono">{fmtNumber(row.count)}</span>,
    },
    {
      key: 'errors',
      label: 'Errors',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.errors > 0
        ? <span className="text-error font-medium font-mono">{fmtNumber(row.errors)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'successRate',
      label: 'Success',
      align: 'right',
      sortable: true,
      width: '78px',
      render: (row) => (
        <span className={clsx('font-mono', row.successRate < 95 && 'text-warning', row.successRate < 80 && 'text-error')}>
          {row.count > 0 ? fmtPct(row.successRate) : '—'}
        </span>
      ),
    },
    {
      key: 'p50Ms',
      label: 'P50',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.p50Ms != null
        ? <span className="text-text-secondary font-mono">{fmtMs(row.p50Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'p95Ms',
      label: 'P95',
      align: 'right',
      sortable: true,
      width: '70px',
      render: (row) => row.p95Ms != null
        ? <span className="text-text-secondary font-mono">{fmtMs(row.p95Ms)}</span>
        : <span className="text-text-disabled">—</span>,
    },
    {
      key: 'lastUsed',
      label: 'Last Used',
      sortable: true,
      width: '100px',
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
        <FilterToggle label={`Missing (${missingCount})`} active={showMissing} onToggle={() => setShowMissing(!showMissing)} />
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
        datasets={SKILL_DATASETS}
        dataset={dataset}
        onDatasetChange={(d) => setDataset(d as SkillDataset)}
        filters={filters}
        activeFilterCount={(showCommands ? 1 : 0) + (showSkills ? 1 : 0) + (showMissing ? 1 : 0) + (showUnused ? 1 : 0)}
      />

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(totalInvocations)} />
        <StatCard label="Active Skills" value={fmtNumber(activeSkills)} />
        <StatCard label="Commands" value={fmtNumber(commandCount)} />
        <StatCard label="Skills" value={fmtNumber(skillCount)} />
        <StatCard
          label="Errors"
          value={totalErrors === 0 ? '0' : fmtNumber(totalErrors)}
          accent={totalErrors === 0 ? 'success' : totalErrors / Math.max(totalInvocations, 1) < 0.05 ? 'warning' : 'error'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(avgSuccessRate)}
          accent={avgSuccessRate >= 99 ? 'success' : avgSuccessRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {data.byDay.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h3 className="text-sm font-medium text-text-secondary">{timeSeriesTitle}</h3>
                <div className="flex gap-1">
                  {(['line', 'bar'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setChartType(t)}
                      className={clsx(
                        'px-2 py-0.5 text-xs rounded transition-colors',
                        chartType === t ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-1" />
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
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
                </ResponsiveContainer>
              </div>
            </div>

            <div className="w-px bg-border-primary shrink-0 mx-5" />

            <div className="w-[360px] shrink-0 flex flex-col">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h3 className="text-sm font-medium text-text-secondary">{distTitle}</h3>
                {showDonutBarToggle && (
                  <div className="flex gap-1">
                    {(['donut', 'bar'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setDistChartType(t)}
                        className={clsx(
                          'px-2 py-0.5 text-xs rounded transition-colors',
                          distChartType === t ? 'bg-bg-secondary text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {activeDonut && (
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    {distChartType === 'donut' ? (
                      <PieChart>
                        <Pie data={activeDonut as any[]} dataKey="count" nameKey={dataset === 'by-type' ? 'type' : 'skill'} cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                          {activeDonut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown, n: unknown) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      </PieChart>
                    ) : (
                      <BarChart layout="vertical" data={activeDonut as any[]}>
                        <CartesianGrid {...gridProps} horizontal={false} />
                        <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                        <YAxis type="category" dataKey={dataset === 'by-type' ? 'type' : 'skill'} {...axisProps} width={80} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                        <Bar dataKey="count" name="Count" radius={[0, 2, 2, 0]}>
                          {activeDonut.map((_: unknown, i: number) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}

              {dataset === 'errors' && (
                <div className="flex-1 min-h-0">
                  {topErrorSkillsForDist.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
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
              )}

              {dataset === 'latency' && (
                <div className="flex-1 min-h-0">
                  {topLatencySkillsForDist.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
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
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 mt-4 mb-1 text-xs shrink-0 flex-wrap">
            {tsKeys.map((name, i) => (
              <span key={name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                <span className="font-mono text-text-secondary">{fmtLegendLabel(name)}</span>
              </span>
            ))}
          </div>
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
