import { Icon } from '../../../components/ui/Icon';
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useObsToolDetail } from '../../../api/observability-hooks';
import { PageLoading } from '../../../components/ui/Spinner';
import { ErrorState } from '../../../components/ui/ErrorState';
import { StatCard } from '../../../components/data/StatCard';
import { DataTable, type Column } from '../../../components/data/DataTable';
import { ObsControlBar, FilterToggle } from '../../../components/data/ObsControlBar';
import { QueryTiming } from '../../../components/data/QueryTiming';
import { tooltipStyle, gridProps, axisProps, CHART_PALETTE, chartColor, labelFormatter, xAxisDateProps } from '../../../components/charts/chartTheme';
import { fmtNumber, fmtPct, fmtMs, fmtToolName, fmtProject, fmtLegendLabel } from '../../../utils/format';
import { type TimeRange, type Granularity } from '../../../components/data/TimeRangeSelector';
import { clsx } from 'clsx';
import { format } from 'date-fns';

type InvocationRow = { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; durationMs?: number; isError?: boolean; errorMessage?: string; errorFull?: string; skill?: string; linesAdded?: number; linesRemoved?: number };
type Dataset = 'status' | 'projects' | 'latency' | 'churn' | 'sessions' | 'errors' | 'skills';

const DATASETS: { key: Dataset; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'projects', label: 'Projects' },
  { key: 'latency', label: 'Latency' },
  { key: 'errors', label: 'Error Rate' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'churn', label: 'Churn' },
  { key: 'skills', label: 'Skills' },
];

function compactDate(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}/${day} ${format(d, 'h:mmaaa')}`;
}

function stripErrorTags(msg: string): string {
  return msg.replace(/<\/?tool_use_error>/g, '').trim();
}

function cleanErrorText(msg: string): string {
  return stripErrorTags(msg)
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Priority keys for the single-value param preview, in order of preference. */
const PREVIEW_KEYS = ['content', 'query', 'message', 'prompt', 'text', 'body', 'description', 'input', 'name', 'path', 'url', 'command', 'pattern', 'file_path'];

function bestParamPreview(params?: Record<string, unknown>): { key: string; value: string } | null {
  if (!params) return null;
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;

  // Try priority keys first
  for (const pk of PREVIEW_KEYS) {
    const found = entries.find(([k]) => k === pk);
    if (found) {
      const [k, v] = found;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return { key: k, value: s };
    }
  }

  // Pick the longest string value, or first entry
  const stringEntries = entries.filter(([, v]) => typeof v === 'string') as [string, string][];
  if (stringEntries.length > 0) {
    const best = stringEntries.reduce((a, b) => b[1].length > a[1].length ? b : a);
    return { key: best[0], value: best[1] };
  }

  const [k, v] = entries[0];
  return { key: k, value: typeof v === 'string' ? v : JSON.stringify(v) };
}

/** Collapse runs of whitespace inside string values before serializing. */
function cleanParams(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') {
      out[k] = v.replace(/[ \t]+/g, ' ').trim();
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = cleanParams(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Syntax-highlighted JSON for the expanded row. */
function HighlightedJSON({ data }: { data: Record<string, unknown> }) {
  const clean = cleanParams(data);
  const json = JSON.stringify(clean, null, 2);
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const highlighted = escaped.replace(
    /(&quot;|")((?:\\.|[^"\\])*)(&quot;|")\s*:/g,
    '<span class="text-accent-primary">"$2"</span>:'
  ).replace(
    /:\s*(&quot;|")((?:\\.|[^"\\])*)(&quot;|")/g,
    ': <span class="text-success">"$2"</span>'
  ).replace(
    /:\s*(\d+(?:\.\d+)?)/g,
    ': <span class="text-warning">$1</span>'
  ).replace(
    /:\s*(true|false|null)\b/g,
    ': <span class="text-info">$1</span>'
  );
  return (
    <pre
      className="text-xs font-mono text-text-secondary max-h-80 overflow-auto whitespace-pre-wrap break-words leading-relaxed"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

export function ToolDetailPage() {
  const { name: rawName } = useParams<{ name: string }>();
  const toolName = decodeURIComponent(rawName ?? '');
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(true);
  const [showErrors, setShowErrors] = useState(true);
  const [tsDataset, setTsDataset] = useState<Dataset>('status');
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  const [distChartType, setDistChartType] = useState<'donut' | 'bar'>('donut');
  const { data, isLoading, error, refetch } = useObsToolDetail(toolName, range);

  if (isLoading) return <PageLoading />;
  if (error || !data) return <ErrorState message="Failed to load tool details" retry={refetch} />;

  const successRate = data.totalCount > 0
    ? ((data.totalCount - data.errorCount) / data.totalCount) * 100
    : 100;
  const successCount = data.totalCount - data.errorCount;

  // Filter invocations by success/error toggles
  const filteredInvocations = data.invocations.filter((inv: InvocationRow) => {
    if (inv.isError) return showErrors;
    return showSuccess;
  });

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

  // Build success/error by day
  const byDayStatus: Record<string, { success: number; error: number }> = {};
  for (const inv of data.invocations) {
    const dateKey = inv.timestamp.slice(0, 10);
    if (!byDayStatus[dateKey]) byDayStatus[dateKey] = { success: 0, error: 0 };
    if (inv.isError) byDayStatus[dateKey].error++;
    else byDayStatus[dateKey].success++;
  }

  const statusByDay = data.byDay.map((day) => ({
    date: day.date,
    Success: byDayStatus[day.date]?.success ?? day.count,
    Errors: byDayStatus[day.date]?.error ?? 0,
  }));

  const projectStackedByDay = data.byDay.map((day) => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of projectNames) {
      entry[name] = (byDayProject[day.date] ?? {})[name] ?? 0;
    }
    return entry;
  });

  // Latency time series
  const latencyByDay = data.byDay.map((day) => ({
    date: day.date,
    P50: day.p50Ms ?? 0,
    P95: day.p95Ms ?? 0,
    Avg: day.avgMs ?? 0,
  }));
  const LATENCY_COLORS = ['var(--c-accent)', 'var(--c-warning)', 'var(--c-success)'];

  // Error rate time series
  const errorRateByDay = data.byDay.map((day) => ({
    date: day.date,
    'Error Rate': day.errorRate,
    Errors: day.errors,
  }));

  // Sessions time series
  const sessionsByDay = data.byDay.map((day) => ({
    date: day.date,
    Sessions: day.sessions,
  }));

  // Churn time series
  const hasChurn = data.totalLinesAdded + data.totalLinesRemoved > 0;
  const churnByDay = data.byDay.map((day) => ({
    date: day.date,
    Added: day.linesAdded,
    Removed: day.linesRemoved,
  }));
  const CHURN_COLORS = ['var(--c-success)', 'var(--c-error)'];

  // Skills time series (from invocations)
  const hasSkills = data.skills.length > 0;
  const skillNames = data.skills.slice(0, 10).map(s => s.name);
  const byDaySkill: Record<string, Record<string, number>> = {};
  for (const inv of data.invocations) {
    if (inv.skill) {
      const dateKey = inv.timestamp.slice(0, 10);
      if (!byDaySkill[dateKey]) byDaySkill[dateKey] = {};
      byDaySkill[dateKey][inv.skill] = (byDaySkill[dateKey][inv.skill] ?? 0) + 1;
    }
  }
  const skillsByDay = data.byDay.map((day) => {
    const entry: Record<string, unknown> = { date: day.date };
    for (const name of skillNames) {
      entry[name] = (byDaySkill[day.date] ?? {})[name] ?? 0;
    }
    return entry;
  });

  // Donut data
  const statusDonut = [
    { name: 'Success', value: successCount },
    ...(data.errorCount > 0 ? [{ name: 'Errors', value: data.errorCount }] : []),
  ];
  const projectDonut = projectNames.slice(0, 10).map((name) => ({ name, value: projectTotals[name] }));
  const skillDonut = data.skills.slice(0, 10).map(s => ({ name: s.name, value: s.count }));

  const STATUS_COLORS = ['var(--c-success)', 'var(--c-error)'];

  // Latency stats
  const durationsAll = data.invocations.filter(i => i.durationMs != null).map(i => i.durationMs!);
  const sorted = [...durationsAll].sort((a, b) => a - b);
  const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;

  // Filter out empty datasets
  const hasLatency = durationsAll.length > 0;
  const visibleDatasets = DATASETS.filter(d => {
    if (d.key === 'latency' && !hasLatency) return false;
    if (d.key === 'churn' && !hasChurn) return false;
    if (d.key === 'skills' && !hasSkills) return false;
    return true;
  });

  // Dynamic chart config per dataset
  type ChartConfig = { data: Record<string, unknown>[]; keys: string[]; colors: string[]; title: string; distTitle: string; yFormatter?: (v: number) => string; stacked?: boolean; distData?: { name: string; value: number }[] };
  const granularityLabel: Record<Granularity, string> = { minute: 'Per-Minute', hour: 'Hourly', day: 'Daily' };

  const chartConfig: Record<Dataset, ChartConfig> = {
    status: {
      data: statusByDay, keys: ['Success', 'Errors'], colors: STATUS_COLORS, stacked: true,
      title: `${granularityLabel[granularity]} Calls by Status`, distTitle: 'Success vs Errors', distData: statusDonut,
    },
    projects: {
      data: projectStackedByDay, keys: projectNames, colors: projectNames.map((name, i) => chartColor(name, i)), stacked: true,
      title: `${granularityLabel[granularity]} Usage by Project`, distTitle: 'Top Projects', distData: projectDonut,
    },
    latency: {
      data: latencyByDay, keys: ['P50', 'P95', 'Avg'], colors: LATENCY_COLORS,
      title: `${granularityLabel[granularity]} Latency`, distTitle: 'Latency Distribution',
      yFormatter: (v) => fmtMs(v),
    },
    errors: {
      data: errorRateByDay, keys: ['Error Rate'], colors: ['var(--c-error)'],
      title: `${granularityLabel[granularity]} Error Rate`, distTitle: 'Error Breakdown',
      yFormatter: (v) => `${v}%`, distData: statusDonut,
    },
    sessions: {
      data: sessionsByDay, keys: ['Sessions'], colors: ['var(--c-accent)'],
      title: `${granularityLabel[granularity]} Sessions`, distTitle: 'Session Distribution',
    },
    churn: {
      data: churnByDay, keys: ['Added', 'Removed'], colors: CHURN_COLORS, stacked: true,
      title: `${granularityLabel[granularity]} Code Churn`, distTitle: 'Churn Breakdown',
      yFormatter: (v) => `${fmtNumber(v)} lines`,
    },
    skills: {
      data: skillsByDay, keys: skillNames, colors: skillNames.map((name, i) => chartColor(name, i)), stacked: true,
      title: `${granularityLabel[granularity]} Skill Triggers`, distTitle: 'Top Skills', distData: skillDonut,
    },
  };

  const cfg = chartConfig[tsDataset];
  const activeFilterCount = (showSuccess ? 0 : 1) + (showErrors ? 0 : 1);

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
          to={`/observability/sessions/${row.sessionId}?t=${encodeURIComponent(row.timestamp)}`}
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-sm text-accent-primary hover:underline whitespace-nowrap"
        >
          {row.sessionId.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'params',
      label: 'Detail',
      render: (row) => {
        const preview = bestParamPreview(row.params);
        if (!preview) return <span className="text-text-muted">—</span>;
        const truncated = preview.value.length > 120 ? preview.value.slice(0, 120) + '…' : preview.value;
        return <span className="text-sm text-text-secondary font-mono">{truncated}</span>;
      },
    },
    {
      key: 'errorMessage',
      label: 'Error',
      render: (row) => row.errorMessage
        ? <span className="text-sm text-error font-mono">{stripErrorTags(row.errorMessage)}</span>
        : <span className="text-text-muted">—</span>,
    },
    {
      key: 'durationMs',
      label: 'Duration',
      align: 'right',
      shrink: true,
      sortable: true,
      render: (row) => row.durationMs != null
        ? <span className="font-mono text-sm whitespace-nowrap">{fmtMs(row.durationMs)}</span>
        : <span className="text-text-muted">—</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <ObsControlBar
        title={
          <div className="flex items-center gap-2">
            <Link
              to="/observability/tools"
              className="flex items-center gap-1 text-text-muted hover:text-text-primary transition-colors"
            >
              <Icon name="build" size="xs" className="text-text-muted" />
              <span className="font-heading text-lg text-text-muted">Tools</span>
            </Link>
            <Icon name="chevron_right" size="xs" className="text-text-disabled" />
            <h1 className="font-heading text-lg font-semibold text-text-primary">{fmtToolName(toolName!)}</h1>
          </div>
        }
        datasets={visibleDatasets}
        dataset={tsDataset}
        onDatasetChange={(d) => setTsDataset(d as Dataset)}
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
        filters={
          <>
            <FilterToggle label="Success" active={showSuccess} onToggle={() => setShowSuccess(!showSuccess)} activeColor="success" />
            <FilterToggle label="Error" active={showErrors} onToggle={() => setShowErrors(!showErrors)} activeColor="error" />
          </>
        }
        activeFilterCount={activeFilterCount}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Tool Calls" value={fmtNumber(data.totalCount)} accent="neutral" />
        <StatCard
          label="Errors"
          value={data.errorCount === 0 ? '0' : fmtNumber(data.errorCount)}
          accent={data.errorCount === 0 ? 'success' : data.errorCount / Math.max(data.totalCount, 1) < 0.05 ? 'warning' : 'error'}
        />
        <StatCard
          label="Success Rate"
          value={fmtPct(successRate)}
          accent={successRate >= 99 ? 'success' : successRate >= 95 ? 'warning' : 'error'}
        />
        <StatCard
          label="P50 Latency"
          value={p50 > 0 ? fmtMs(p50) : '—'}
          accent={p50 > 0 ? (p50 < 1000 ? 'success' : p50 < 5000 ? 'warning' : 'error') : undefined}
        />
        <StatCard
          label="P95 Latency"
          value={p95 > 0 ? fmtMs(p95) : '—'}
          accent={p95 > 0 ? (p95 < 1000 ? 'success' : p95 < 5000 ? 'warning' : 'error') : undefined}
        />
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
                      <YAxis {...axisProps} tickFormatter={cfg.yFormatter || axisProps.tickFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [cfg.yFormatter ? cfg.yFormatter(Number(v)) : fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
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
                      <YAxis {...axisProps} tickFormatter={cfg.yFormatter || axisProps.tickFormatter} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v, n) => [cfg.yFormatter ? cfg.yFormatter(Number(v)) : fmtNumber(Number(v)), fmtLegendLabel(String(n))]} />
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
                          <Pie data={cfg.distData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="38%" outerRadius="92%">
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
                          <Bar dataKey="value" name="Count" radius={[0, 2, 2, 0]}>
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
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            Recent Invocations ({filteredInvocations.length}{(showSuccess !== showErrors || !showSuccess) ? ` of ${data.invocations.length}` : ''})
          </h2>
          <DataTable<InvocationRow>
            data={filteredInvocations}
            columns={invocationColumns}
            keyField="timestamp"
            maxRows={50}
            rowClassName={(row) => row.isError ? 'bg-error/5' : undefined}
            expandedKey={expandedRow}
            onExpandToggle={(key) => setExpandedRow(key === expandedRow ? null : key)}
            renderExpanded={(row) => {
              const fullError = row.errorFull || row.errorMessage;
              if (!row.params && !fullError) return <p className="text-xs text-text-muted font-mono">No data</p>;
              return (
                <div className="space-y-3">
                  {fullError && (
                    <pre className="text-xs font-mono text-error max-h-80 overflow-auto whitespace-pre-wrap break-words leading-relaxed bg-error/5 rounded px-3 py-2">
                      {cleanErrorText(fullError)}
                    </pre>
                  )}
                  {row.params && <HighlightedJSON data={row.params} />}
                </div>
              );
            }}
          />
        </div>
      )}

      <QueryTiming ms={data.queryTimeMs} />
    </div>
  );
}
