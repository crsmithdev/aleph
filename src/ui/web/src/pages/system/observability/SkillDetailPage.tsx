import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { useObsSkillDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { ChartContainer } from '../../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, labelFormatter } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, shortDate, dateTime, granLabel, fmtProject, fmtSeriesName } from '../../../utils/format';
import { MarkdownBlock } from '../../../components/data/MarkdownBlock';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { clsx } from 'clsx';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string };

export function SkillDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const targetSession = searchParams.get('session');
  const skillName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const invTableRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error, refetch } = useObsSkillDetail(skillName, range);

  // Auto-expand and scroll to the invocation matching the session query param
  useEffect(() => {
    if (!data || !targetSession) return;
    const match = data.invocations.find((inv: InvocationRow) => inv.sessionId === targetSession);
    if (match) {
      setExpandedRow(match.timestamp);
      setTimeout(() => {
        const row = invTableRef.current?.querySelector(`tr[data-row-key="${match.timestamp}"]`);
        (row ?? invTableRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  }, [data, targetSession]);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load skill details" retry={refetch} />;

  const isCommand = data.type === 'command';
  const displayName = isCommand && !skillName.startsWith('/') ? `/${skillName}` : skillName;

  const total = Number(data.totalCount) || 0;
  const errors = Number(data.errorCount) || 0;
  const successRate = total === 0 ? 100 : ((total - errors) / total) * 100;

  // Build project breakdown from invocations
  const allProjects = [...new Set(data.invocations.map((inv: InvocationRow) => inv.project))].slice(0, 8);

  // Group invocations by date+project
  const invByDateProject: Record<string, Record<string, number>> = {};
  for (const inv of data.invocations) {
    const date = inv.timestamp.slice(0, 10);
    if (!invByDateProject[date]) invByDateProject[date] = {};
    invByDateProject[date][inv.project] = (invByDateProject[date][inv.project] ?? 0) + 1;
  }

  // Merge with byDay dates (use byDay as the date axis backbone)
  const byDayProject = data.byDay.map((d: { date: string; count: number }) => {
    const row: Record<string, unknown> = { date: d.date };
    const dateKey = d.date.slice(0, 10);
    const projectCounts = invByDateProject[dateKey] ?? {};
    for (const proj of allProjects) {
      row[proj] = projectCounts[proj] ?? 0;
    }
    // If no project breakdown available, fall back to total count
    if (allProjects.length === 0) row['count'] = d.count;
    return row;
  });

  // Project donut data
  const projectTotals = allProjects.map(proj => ({
    name: fmtProject(proj),
    rawName: proj,
    count: data.invocations.filter((inv: InvocationRow) => inv.project === proj).length,
  })).sort((a, b) => b.count - a.count);

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      width: '8rem',
      render: (row) => <span className="text-text-secondary">{dateTime(row.timestamp)}</span>,
    },
    {
      key: 'project',
      label: 'Project',
      width: '7rem',
      render: (row) => <span className="font-mono text-xs text-text-muted truncate block">{fmtProject(row.project)}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      width: '5rem',
      render: (row) => (
        <Link
          to={`/observability/sessions/${encodeURIComponent(row.sessionId)}?t=${encodeURIComponent(row.timestamp)}`}
          className="font-mono text-xs text-accent hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.sessionId.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'userRequest',
      label: 'Request',
      render: (row) => {
        if (!row.userRequest) return <span className="text-text-muted">—</span>;
        const text = row.userRequest;
        const short = text.length > 120 ? text.slice(0, 120) + '...' : text;
        return (
          <span className="text-xs text-text-secondary" title={text}>{short}</span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <div className="flex items-center gap-3">
            <Link
              to="/observability/skills"
              className="text-sm text-text-muted hover:text-text-primary transition-colors"
            >
              &larr; Skills
            </Link>
            <h1 className="text-2xl font-bold font-mono text-text-primary">{displayName}</h1>
            <span className={clsx(
              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              isCommand
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
            )}>
              {isCommand ? 'command' : 'skill'}
            </span>
          </div>
        }
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Invocations" value={fmtNumber(data.totalCount ?? 0)} />
        <StatCard
          label="Errors"
          value={fmtNumber(data.errorCount ?? 0)}
          accent={(data.errorCount ?? 0) > 0 ? 'error' : 'default'}
        />
        <StatCard
          label="Success Rate"
          value={isNaN(successRate) ? '—' : fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
        />
      </div>

      {data.byDay.length > 0 && (
        <div className="flex gap-4 items-stretch">
          <div className="flex-1">
            <ChartContainer title={granLabel(granularity, "Usage")} chartType={chartType} onChartTypeChange={setChartType}>
              {chartType === 'bar' ? (
                allProjects.length > 0 ? (
                  <BarChart data={byDayProject}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    {allProjects.map((proj, i) => (
                      <Bar key={proj} dataKey={proj} stackId="a" fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        name={fmtProject(proj)}
                        radius={i === allProjects.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                      />
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
                allProjects.length > 0 ? (
                  <AreaChart data={byDayProject}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    {allProjects.map((proj, i) => (
                      <Area key={proj} type="monotone" dataKey={proj} stackId="a"
                        stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        fillOpacity={0.3}
                        dot={false}
                        name={fmtProject(proj)}
                      />
                    ))}
                  </AreaChart>
                ) : (
                  <AreaChart data={data.byDay}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
                    <YAxis {...axisProps} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                    <Area type="monotone" dataKey="count" stroke={CHART_PALETTE[3]} fill={CHART_PALETTE[3]} fillOpacity={0.3} dot={false} name="Invocations" />
                  </AreaChart>
                )
              )}
            </ChartContainer>
          </div>

          {projectTotals.length > 0 && (
            <div className="rounded-lg border border-border-primary bg-bg-secondary p-4" style={{ width: 160 }}>
              <h3 className="mb-3 text-sm font-medium text-text-secondary">By Project</h3>
              <div className="flex flex-col items-center gap-3">
                <PieChart width={120} height={120}>
                  <Pie data={projectTotals} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={50}>
                    {projectTotals.map((_, i) => (
                      <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtSeriesName(String(n))]} />
                </PieChart>
                <div className="flex flex-col gap-1.5 w-full">
                  {projectTotals.map((row, i) => (
                    <div key={row.rawName} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                      <span className="font-mono text-text-secondary truncate">{row.name}</span>
                      <span className="ml-auto text-text-muted font-mono shrink-0">{fmtNumber(row.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {data.invocations.length > 0 && (
        <div ref={invTableRef}>
          <h2 className="mb-3 text-sm font-medium text-text-secondary">
            Recent Invocations ({data.invocations.length})
          </h2>
          <DataTable<InvocationRow>
            data={data.invocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
            expandedKey={expandedRow}
            onExpandToggle={setExpandedRow}
            renderExpanded={(row) => {
              const hasParams = row.params && Object.keys(row.params).length > 0;
              return (
                <div className="flex flex-col gap-2">
                  {row.userRequest && (
                    <div className="text-xs">
                      <span className="font-mono text-text-muted block mb-0.5">request</span>
                      <div className="text-text-secondary
                        [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-1
                        [&_code]:font-mono [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:rounded [&_code]:text-accent [&_code]:text-xs
                        [&_pre]:bg-bg-tertiary [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0
                        [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:mb-1 [&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:mb-1
                        [&_strong]:font-semibold [&_strong]:text-text-primary">
                        <Markdown remarkPlugins={[remarkGfm]}>{row.userRequest}</Markdown>
                      </div>
                    </div>
                  )}
                  {hasParams && Object.entries(row.params!).filter(([k]) => k !== 'skill').map(([k, v]) => (
                    <div key={k} className="flex gap-3 text-xs">
                      <span className="font-mono text-text-muted w-32 shrink-0">{k}</span>
                      <span className="text-text-secondary break-all">
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
        </div>
      )}

      {data.sourceContent ? (
        <MarkdownBlock
          content={data.sourceContent}
          filename={isCommand ? `${skillName}.md` : `${skillName}/SKILL.md`}
        />
      ) : (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm text-warning">
            Source file not found — no {isCommand ? 'command .md' : 'SKILL.md'} file found for <span className="font-mono">{displayName}</span>
          </p>
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
