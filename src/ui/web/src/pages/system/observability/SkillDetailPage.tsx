import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsSkillDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar } from '../../../components/data/ObsControlBar';
import { PageTitle, PageTitleLink, PageTitleSeparator } from '../../../components/layout/PageHeader';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, chartColor, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtProject, fmtLegendLabel } from '../../../utils/format';
import { MarkdownBlock } from '../../../components/data/MarkdownBlock';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { clsx } from 'clsx';
import { format } from 'date-fns';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string; isSubagent?: boolean; subagentType?: string; parentSessionId?: string };
type Dataset = 'usage' | 'projects';

const DATASETS: { key: Dataset; label: string }[] = [
  { key: 'usage', label: 'Usage' },
  { key: 'projects', label: 'Projects' },
];

function compactDate(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day} ${format(d, 'h:mmaaa')}`;
}

export function SkillDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const [searchParams] = useSearchParams();
  const targetSession = searchParams.get('session');
  const skillName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [distChartType, setDistChartType] = useState<'donut' | 'bar'>('donut');
  const [tsDataset, setTsDataset] = useState<Dataset>('usage');
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

  // Build per-project breakdown from invocations
  const projectTotals: Record<string, number> = {};
  const byDayProject: Record<string, Record<string, number>> = {};
  for (const inv of data.invocations) {
    const proj = fmtProject(inv.project);
    projectTotals[proj] = (projectTotals[proj] ?? 0) + 1;
    const dateKey = inv.timestamp.slice(0, 10);
    if (!byDayProject[dateKey]) byDayProject[dateKey] = {};
    byDayProject[dateKey][proj] = (byDayProject[dateKey][proj] ?? 0) + 1;
  }

  const projectNames = Object.entries(projectTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // Unique sessions and projects
  const uniqueSessions = new Set(data.invocations.map((inv: InvocationRow) => inv.sessionId)).size;
  const uniqueProjects = projectNames.length;

  // Usage time series (total count per day)
  const usageByDay = data.byDay.map((day: { date: string; count: number }) => ({
    date: day.date,
    Invocations: day.count,
  }));

  // Project-stacked time series
  const projectStackedByDay = data.byDay.map((day: { date: string; count: number }) => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of projectNames) {
      entry[name] = (byDayProject[day.date] ?? {})[name] ?? 0;
    }
    return entry;
  });

  // Donut data
  const projectDonut = projectNames.slice(0, 10).map((name) => ({ name, value: projectTotals[name] }));
  const usageDonut = [{ name: 'Invocations', value: total }];

  // Dynamic chart config per dataset
  type ChartConfig = { data: Record<string, unknown>[]; keys: string[]; colors: string[]; title: string; distTitle: string; stacked?: boolean; distData?: { name: string; value: number }[] };
  const granularityLabel: Record<Granularity, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };

  const chartConfig: Record<Dataset, ChartConfig> = {
    usage: {
      data: usageByDay, keys: ['Invocations'], colors: [CHART_PALETTE[3]],
      title: `${granularityLabel[granularity]} Invocations`, distTitle: 'By Project',
      distData: projectDonut.length > 1 ? projectDonut : undefined,
    },
    projects: {
      data: projectStackedByDay, keys: projectNames, colors: projectNames.map((name, i) => chartColor(name, i)), stacked: true,
      title: `${granularityLabel[granularity]} Usage by Project`, distTitle: 'Top Projects', distData: projectDonut,
    },
  };

  // Filter out empty datasets
  const visibleDatasets = DATASETS.filter(d => {
    if (d.key === 'projects' && projectNames.length <= 1) return false;
    return true;
  });

  const cfg = chartConfig[tsDataset];

  const invocationColumns: Column<InvocationRow>[] = [
    {
      key: 'timestamp',
      label: 'Date',
      shrink: true,
      sortable: true,
      render: (row) => <span className="font-mono text-text-secondary whitespace-nowrap">{compactDate(row.timestamp)}</span>,
    },
    {
      key: 'project',
      label: 'Project',
      shrink: true,
      sortable: true,
      render: (row) => <span className="font-mono text-sm text-text-muted whitespace-nowrap">{fmtProject(row.project)}</span>,
    },
    {
      key: 'sessionId',
      label: 'Session',
      shrink: true,
      render: (row) => (
        <Link
          to={`/observability/sessions/${encodeURIComponent(row.sessionId)}?t=${encodeURIComponent(row.timestamp)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-sm text-accent-primary hover:underline whitespace-nowrap"
        >
          {row.sessionId.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'isSubagent',
      label: 'Via',
      shrink: true,
      render: (row) => row.isSubagent && row.parentSessionId
        ? <Link to={`/observability/sessions/${row.parentSessionId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-text-muted hover:text-accent-primary whitespace-nowrap">↳ {row.subagentType || 'subagent'}</Link>
        : <span className="text-text-muted">—</span>,
    },
    {
      key: 'userRequest',
      label: 'Request',
      render: (row) => {
        if (!row.userRequest) return <span className="text-text-muted">—</span>;
        const truncated = row.userRequest.length > 120 ? row.userRequest.slice(0, 120) + '…' : row.userRequest;
        return <span className="text-sm text-text-secondary font-mono">{truncated}</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <>
            <PageTitleLink to="/observability/skills">Skills</PageTitleLink>
            <PageTitleSeparator />
            <PageTitle>{displayName}</PageTitle>
            <span className={clsx(
              'shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide',
              isCommand
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'bg-accent/5 text-accent/70 border border-accent/10',
            )}>
              {isCommand ? 'cmd' : 'skill'}
            </span>
          </>
        }
        datasets={visibleDatasets}
        dataset={tsDataset}
        onDatasetChange={(d) => setTsDataset(d as Dataset)}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 !mt-0">
        <StatCard label="Invocations" value={fmtNumber(total)} accent="neutral" />
        <StatCard
          label="Errors"
          value={errors === 0 ? '0' : fmtNumber(errors)}
          accent={errors === 0 ? 'success' : errors / Math.max(total, 1) < 0.05 ? 'warning' : 'error'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
        />
        <StatCard label="Sessions" value={fmtNumber(uniqueSessions)} />
        <StatCard label="Projects" value={fmtNumber(uniqueProjects)} />
      </div>

      {data.byDay.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 h-[350px] flex flex-col">
          <div className="flex-1 min-h-0 flex">
            {/* Time series */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <h3 className="font-heading text-lg font-medium text-text-secondary">{cfg.title}</h3>
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
                  {chartType === 'bar' ? (
                    <BarChart data={cfg.data}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {cfg.keys.map((name, i) => (
                        <Bar
                          key={name}
                          dataKey={name}
                          name={fmtLegendLabel(name)}
                          stackId={cfg.stacked ? 'a' : undefined}
                          fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]}
                          radius={i === cfg.keys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  ) : (
                    <AreaChart data={cfg.data}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...xAxisDateProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                      {cfg.keys.map((name, i) => (
                        <Area
                          key={name}
                          type="monotone"
                          dataKey={name}
                          name={fmtLegendLabel(name)}
                          stackId={cfg.stacked ? 'a' : undefined}
                          stroke={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]}
                          fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]}
                          fillOpacity={cfg.stacked ? 0.4 : 0.15}
                          strokeWidth={1.5}
                          dot={false}
                        />
                      ))}
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>

            {/* Distribution panel — only shown when there's donut/bar data */}
            {cfg.distData && cfg.distData.length > 0 && (
              <>
                <div className="w-px bg-border-primary shrink-0 mx-5" />
                <div className="w-[360px] shrink-0 flex flex-col">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <h3 className="font-heading text-lg font-medium text-text-secondary">{cfg.distTitle}</h3>
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
                  </div>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      {distChartType === 'donut' ? (
                        <PieChart>
                          <Pie isAnimationActive={false} data={cfg.distData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
                            {cfg.distData.map((_, i) => <Cell key={i} fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                        </PieChart>
                      ) : (
                        <BarChart layout="vertical" data={cfg.distData}>
                          <CartesianGrid {...gridProps} horizontal={false} />
                          <XAxis type="number" {...axisProps} tickFormatter={(v) => fmtNumber(Number(v))} />
                          <YAxis type="category" dataKey="name" {...axisProps} width={72} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
                          <Bar isAnimationActive={false} dataKey="value" name="Count" radius={[0, 2, 2, 0]}>
                            {cfg.distData.map((_, i) => <Cell key={i} fill={cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length]} />)}
                          </Bar>
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Legend */}
          <div className="flex items-center justify-center gap-x-2 gap-y-[5px] mt-1 mb-1 text-xs shrink-0 flex-wrap">
            {cfg.keys.map((name, i) => (
              <span key={name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.colors[i] || CHART_PALETTE[i % CHART_PALETTE.length] }} />
                <span className="font-mono text-text-secondary">{fmtLegendLabel(name)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {data.invocations.length > 0 && (
        <div ref={invTableRef}>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            Recent Invocations ({data.invocations.length})
          </h2>
          <DataTable<InvocationRow>
            data={data.invocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
            expandedKey={expandedRow}
            onExpandToggle={(key) => setExpandedRow(key === expandedRow ? null : key)}
            renderExpanded={(row) => {
              const hasParams = row.params && Object.keys(row.params).length > 0;
              if (!row.userRequest && !hasParams) return <p className="text-xs text-text-muted font-mono">No data</p>;
              return (
                <div className="space-y-3">
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
