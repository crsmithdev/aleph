import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/data/StatCard';
import { DataTable, type Column } from '../../components/data/DataTable';
import { PageLoading } from '../../components/ui/Spinner';
import { ChartContainer } from '../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, xAxisDateProps, labelFormatter } from '../../components/charts/chartTheme';
import {
  useResearchQueries,
  useResearchWorkers,
  useAllJobs,
  useJobStats,
  useResearchStats,
  useResearchSummary,
  useGlobalJobMetrics,
  useGlobalSourceHealth,
  useCrossSessionStream,
  useAddWorker,
  useRemoveWorker,
  useKillWorker,
  useCancelJob,
  useRunAllResearch,
  useStopAllResearch,
  type ResearchJob,
  type StreamEvent,
  type WorkerStatus,
} from '../../api/research-hooks';
import { fmtNumber, fmtMs, fmtPct, fmtCurrency } from '../../utils/format';

// --- Helpers ---

const statusColors: Record<string, string> = {
  pending: 'bg-warning/15 text-warning',
  claimed: 'bg-warning/15 text-warning',
  running: 'bg-success/15 text-success',
  idle: 'bg-accent/15 text-accent',
  completed: 'bg-accent/15 text-accent',
  failed: 'bg-error/15 text-error',
  rate_limit: 'bg-warning/15 text-warning',
  cancelled: 'bg-bg-tertiary text-text-muted',
};

function jobDisplayStatus(job: ResearchJob): string {
  if (job.status === 'failed' && job.error) {
    const e = job.error;
    if (e.includes('429') || e.includes('529') || e.toLowerCase().includes('rate limit') || e.toLowerCase().includes('rate-limit')) {
      return 'rate_limit';
    }
  }
  return job.status;
}

function JobStatusBadge({ job }: { job: ResearchJob }) {
  const display = jobDisplayStatus(job);
  const label = display === 'rate_limit' ? 'rate limit' : display;
  return (
    <span
      className={clsx('px-2 py-0.5 rounded text-sm font-medium whitespace-nowrap', statusColors[display] ?? 'bg-bg-tertiary text-text-muted')}
      title={display === 'rate_limit' ? job.error ?? undefined : undefined}
    >
      {label}
    </span>
  );
}

const workerDotColors: Record<string, string> = {
  starting: 'bg-warning',
  running: 'bg-success',
  idle: 'bg-accent',
  stopping: 'bg-warning',
  stopped: 'bg-bg-tertiary',
  backoff: 'bg-error',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded text-sm font-medium whitespace-nowrap', statusColors[status] ?? 'bg-bg-tertiary text-text-muted')}>
      {status}
    </span>
  );
}

function elapsed(from: string | null, to?: string | null): string {
  if (!from) return '—';
  const end = to ? new Date(to).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(from).getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtUptime(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Live clock for running jobs
function LiveDuration({ from }: { from: string | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!from) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [from]);
  return <span className="text-sm tabular-nums text-text-muted font-mono whitespace-nowrap">{elapsed(from)}</span>;
}

// Copyable error display with JSON formatting
function ErrorDisplay({ error }: { error: string }) {
  const [copied, setCopied] = useState(false);

  let formatted = error;
  try {
    const parsed = JSON.parse(error);
    if (parsed !== null && typeof parsed === 'object') {
      formatted = JSON.stringify(parsed, null, 2);
    }
    // primitives (string, number) — show as-is without re-stringifying
  } catch {
    // not JSON, show raw
  }

  const copy = () => {
    navigator.clipboard.writeText(error).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-1 relative">
      <button
        onClick={copy}
        className="absolute top-1.5 right-1.5 text-sm text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded bg-bg-primary/70 hover:bg-bg-primary border border-border-primary/50 transition-colors"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre className="text-error bg-error/15 border border-error/30 rounded p-2 pr-16 font-mono text-sm whitespace-pre-wrap break-all overflow-auto max-h-48 leading-relaxed">
        {formatted}
      </pre>
    </div>
  );
}

// Expanded job detail panel
function JobDetail({ job, queryMap }: { job: ResearchJob; queryMap: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-2.5">
        <div>
          <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Job ID</p>
          <p className="font-mono text-sm text-text-secondary break-all">{job.id}</p>
        </div>
        <div>
          <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Query</p>
          <Link to={`/research/${job.session_id}`} className="font-mono text-sm text-accent hover:underline">
            {queryMap[job.session_id] ?? job.session_id}
          </Link>
        </div>
        {job.thread_id && (
          <div>
            <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Thread</p>
            <p className="font-mono text-sm text-text-secondary break-all">{job.thread_id}</p>
          </div>
        )}
        {job.claimed_by && (
          <div>
            <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Worker</p>
            <p className="font-mono text-sm text-text-secondary">{job.claimed_by}</p>
          </div>
        )}
        <div>
          <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Mode / Iterations</p>
          <p className="text-sm text-text-secondary">
            {job.mode} &middot; {job.iterations_completed}{job.max_iterations ? `/${job.max_iterations}` : ''} iter
          </p>
        </div>
      </div>
      <div className="space-y-2.5">
        <div>
          <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Created</p>
          <p className="font-mono text-sm text-text-secondary">{job.created_at}</p>
        </div>
        {job.started_at && (
          <div>
            <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Started</p>
            <p className="font-mono text-sm text-text-secondary">{job.started_at}</p>
          </div>
        )}
        {job.completed_at && (
          <div>
            <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Completed</p>
            <p className="font-mono text-sm text-text-secondary">{job.completed_at}</p>
          </div>
        )}
        {job.heartbeat_at && (
          <div>
            <p className="text-sm text-text-muted uppercase tracking-wider mb-0.5">Last Heartbeat</p>
            <p className="font-mono text-sm text-text-secondary">{job.heartbeat_at}</p>
          </div>
        )}
        {job.error && (
          <div>
            <p className="text-sm text-error uppercase tracking-wider mb-0.5">Error</p>
            <ErrorDisplay error={job.error} />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Worker Card ---

function WorkerCard({
  worker,
  currentJob,
  queryTitle,
  onKill,
  killPending,
}: {
  worker: WorkerStatus;
  currentJob?: ResearchJob;
  queryTitle?: string;
  onKill: (id: number) => void;
  killPending: boolean;
}) {
  const displayStatus = worker.status === 'running' && !currentJob ? 'idle' : worker.status;

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full shrink-0', workerDotColors[displayStatus] ?? 'bg-bg-tertiary')} />
          <span className="font-mono text-sm text-text-primary">Worker {worker.id}</span>
          <StatusBadge status={displayStatus} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onKill(worker.id)}
          disabled={killPending || worker.status === 'stopped'}
        >
          Kill
        </Button>
      </div>

      <div className="flex items-center gap-4 text-sm text-text-muted">
        <span>PID {worker.pid ?? '—'}</span>
        <span>Up {fmtUptime(worker.uptimeMs)}</span>
        {worker.restarts > 0 && <span className="text-warning">{worker.restarts} restarts</span>}
      </div>

      {currentJob ? (
        <div className="bg-bg-primary border border-border-primary rounded p-3 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Link
              to={`/research/${currentJob.session_id}`}
              className="text-sm font-medium text-accent hover:underline truncate block min-w-0"
            >
              {queryTitle ?? currentJob.session_id.slice(0, 12)}
            </Link>
            <Link
              to={`/research/${currentJob.session_id}#tab=telemetry`}
              title="Open query telemetry"
              className="text-xs text-text-muted hover:text-accent shrink-0"
            >
              telemetry ↗
            </Link>
          </div>
          <div className="flex items-center gap-3 flex-wrap text-sm text-text-muted">
            <StatusBadge status={currentJob.status} />
            {currentJob.thread_id
              ? <span className="font-mono">thread {currentJob.thread_id.slice(0, 8)}</span>
              : <span>{currentJob.iterations_completed}{currentJob.max_iterations ? `/${currentJob.max_iterations}` : ''} iter</span>
            }
            <LiveDuration from={currentJob.started_at} />
          </div>
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-primary/40 rounded p-3 flex items-center gap-3 opacity-50">
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', workerDotColors[displayStatus] ?? 'bg-bg-tertiary')} />
          <span className="font-mono text-sm text-text-muted">worker-{worker.id}</span>
          <span className="text-sm text-text-muted ml-auto">idle</span>
        </div>
      )}
    </div>
  );
}

// --- Worker Count Control ---

function WorkerCountControl({
  count,
  onAdd,
  onRemove,
  addPending,
  removePending,
}: {
  count: number;
  onAdd: () => void;
  onRemove: () => void;
  addPending: boolean;
  removePending: boolean;
}) {
  // Sized to match <Button size="sm"> (px-2.5 py-1 text-xs) so the stepper
  // sits flush with the Pause/Resume button next to it in the page header.
  const stepBtn = 'px-2.5 py-1 text-xs font-mono text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-30 disabled:cursor-not-allowed';
  return (
    <div className="inline-flex items-center border border-border-primary rounded-sm bg-bg-secondary overflow-hidden">
      <button
        onClick={onRemove}
        disabled={removePending || count === 0}
        className={stepBtn}
      >
        −
      </button>
      <span className="px-2 py-1 text-xs font-mono text-text-primary tabular-nums min-w-[2rem] text-center border-x border-border-primary">
        {count}
      </span>
      <button
        onClick={onAdd}
        disabled={addPending}
        className={stepBtn}
      >
        +
      </button>
    </div>
  );
}

// --- Performance Charts ---

function PerformanceCharts({ byDay }: { byDay: { date: string; completed: number; failed: number; avgDurationMs: number | null }[] }) {
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  if (byDay.length === 0) return null;

  const jobData = byDay.map(d => ({ date: d.date, Completed: d.completed, Failed: d.failed }));
  const durationData = byDay.filter(d => d.avgDurationMs != null).map(d => ({ date: d.date, 'Avg Duration': d.avgDurationMs }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartContainer title="Jobs by Day" height={220} chartType={chartType} onChartTypeChange={setChartType}>
        {chartType === 'bar' ? (
          <BarChart data={jobData}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Bar isAnimationActive={false} dataKey="Completed" stackId="a" fill="var(--c-success)" radius={[0, 0, 0, 0]} />
            <Bar isAnimationActive={false} dataKey="Failed" stackId="a" fill="var(--c-error)" radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : (
          <AreaChart data={jobData}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Area isAnimationActive={false} type="monotone" dataKey="Completed" stackId="a" stroke="var(--c-success)" fill="var(--c-success)" fillOpacity={0.4} dot={false} />
            <Area isAnimationActive={false} type="monotone" dataKey="Failed" stackId="a" stroke="var(--c-error)" fill="var(--c-error)" fillOpacity={0.4} dot={false} />
          </AreaChart>
        )}
      </ChartContainer>

      {durationData.length > 0 && (
        <ChartContainer title="Avg Job Duration" height={220}>
          <AreaChart data={durationData}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} tickFormatter={(v) => fmtMs(v)} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} formatter={(v) => [fmtMs(Number(v)), 'Avg Duration']} />
            <Area isAnimationActive={false} type="monotone" dataKey="Avg Duration" stroke="var(--c-accent)" fill="var(--c-accent)" fillOpacity={0.15} dot={false} />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}

// --- In-Flight Jobs Table (running + pending) ---

function InFlightJobsTable({ jobs, queryMap, onCancel, cancelPending }: {
  jobs: ResearchJob[];
  queryMap: Record<string, string>;
  onCancel: (jobId: string) => void;
  cancelPending: boolean;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const columns: Column<ResearchJob>[] = [
    {
      key: 'id',
      label: 'Job',
      shrink: true,
      render: (row) => <span className="font-mono text-sm text-text-muted whitespace-nowrap">{row.id}</span>,
    },
    {
      key: 'session_id',
      label: 'Query',
      render: (row) => (
        <Link to={`/research/${row.session_id}`} className="text-sm text-accent hover:underline" onClick={e => e.stopPropagation()}>
          {queryMap[row.session_id] ?? row.session_id}
        </Link>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      shrink: true,
      render: (row) => <JobStatusBadge job={row} />,
    },
    {
      key: 'mode',
      label: 'Mode',
      shrink: true,
      render: (row) => <span className="text-sm text-text-muted whitespace-nowrap">{row.mode}</span>,
    },
    {
      key: 'claimed_by',
      label: 'Worker',
      shrink: true,
      render: (row) => row.claimed_by
        ? <span className="font-mono text-sm text-text-secondary whitespace-nowrap">{row.claimed_by}</span>
        : <span className="text-sm text-text-muted">—</span>,
    },
    {
      key: 'iterations_completed',
      label: '↻',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="text-sm tabular-nums text-text-secondary whitespace-nowrap">
          {row.iterations_completed}{row.max_iterations ? `/${row.max_iterations}` : ''}
        </span>
      ),
    },
    {
      key: 'started_at',
      label: 'Elapsed',
      shrink: true,
      align: 'right',
      render: (row) => {
        const isRunning = row.status === 'running' || row.status === 'claimed';
        if (isRunning && row.started_at) return <LiveDuration from={row.started_at} />;
        return <span className="text-sm tabular-nums text-text-muted whitespace-nowrap">queued {elapsed(row.created_at)}</span>;
      },
    },
    {
      key: 'id',
      label: '',
      shrink: true,
      render: (row) => (
        <div className="flex items-center gap-1">
          <Link
            to={`/research/${row.session_id}#tab=telemetry`}
            onClick={(e) => e.stopPropagation()}
            title="Open query telemetry"
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
          >
            ↗
          </Link>
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(row.id); }}
            disabled={cancelPending}
            title="Cancel job"
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-error hover:bg-error/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      data={jobs}
      columns={columns}
      keyField="id"
      emptyMessage="Nothing in flight."
      pageSize={20}
      expandedKey={expandedKey}
      onExpandToggle={setExpandedKey}
      renderExpanded={(row) => <JobDetail job={row} queryMap={queryMap} />}
    />
  );
}

// --- Job History Table ---

function JobHistoryTable({ jobs, queryMap }: {
  jobs: ResearchJob[];
  queryMap: Record<string, string>;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const columns: Column<ResearchJob>[] = [
    {
      key: 'id',
      label: 'Job',
      shrink: true,
      render: (row) => <span className="font-mono text-sm text-text-muted whitespace-nowrap">{row.id}</span>,
    },
    {
      key: 'session_id',
      label: 'Query',
      render: (row) => (
        <Link to={`/research/${row.session_id}`} className="text-sm text-accent hover:underline" onClick={e => e.stopPropagation()}>
          {queryMap[row.session_id] ?? row.session_id}
        </Link>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      shrink: true,
      sortable: true,
      render: (row) => <JobStatusBadge job={row} />,
    },
    {
      key: 'mode',
      label: 'Mode',
      shrink: true,
      render: (row) => <span className="text-sm text-text-muted whitespace-nowrap">{row.mode}</span>,
    },
    {
      key: 'thread_id',
      label: 'Thread',
      shrink: true,
      render: (row) => row.thread_id
        ? <span className="font-mono text-sm text-text-muted whitespace-nowrap">{row.thread_id}</span>
        : <span className="text-sm text-text-muted">—</span>,
    },
    {
      key: 'iterations_completed',
      label: '↻',
      shrink: true,
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="text-sm tabular-nums text-text-secondary whitespace-nowrap">
          {row.iterations_completed}{row.max_iterations ? `/${row.max_iterations}` : ''}
        </span>
      ),
    },
    {
      key: 'started_at',
      label: '⏱',
      shrink: true,
      align: 'right',
      render: (row) => {
        const isActive = row.status === 'running' || row.status === 'claimed';
        return isActive
          ? <LiveDuration from={row.started_at} />
          : <span className="text-sm tabular-nums text-text-muted whitespace-nowrap">{elapsed(row.started_at, row.completed_at)}</span>;
      },
    },
  ];

  return (
    <DataTable
      data={jobs}
      columns={columns}
      keyField="id"
      emptyMessage="No jobs yet."
      defaultSort={{ key: 'created_at', dir: 'desc' }}
      pageSize={25}
      expandedKey={expandedKey}
      onExpandToggle={setExpandedKey}
      renderExpanded={(row) => <JobDetail job={row} queryMap={queryMap} />}
    />
  );
}

// --- Activity Rail (cross-session live event feed + recent concepts) ---

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime();
  const ms = Date.now() - t;
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Uppercase type label — color conveys category without a pill.
const eventKindClass: Record<string, string> = {
  finding: 'text-success',
  thread: 'text-accent',
  step: 'text-text-muted',
  job: 'text-text-muted',
  session: 'text-warning',
};

function describeEvent(ev: StreamEvent, queryMap: Record<string, string>): {
  kind: string;
  title: string;
  detail: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  at: string;
} {
  if (ev.type === 'finding') {
    const f = ev.payload;
    return {
      kind: 'finding',
      title: f.summary || f.content.slice(0, 120),
      detail: null,
      sessionId: f.session_id,
      sessionTitle: queryMap[f.session_id] ?? null,
      at: f.created_at,
    };
  }
  if (ev.type === 'thread') {
    const t = ev.payload;
    const name = t.short_query ?? t.query ?? '';
    return {
      kind: 'thread',
      title: name,
      detail: t.status,
      sessionId: t.session_id,
      sessionTitle: queryMap[t.session_id] ?? null,
      at: t.updated_at,
    };
  }
  if (ev.type === 'step') {
    const s = ev.payload;
    const label = typeof s.label === 'string' ? s.label : '';
    return {
      kind: 'step',
      title: label || 'step',
      detail: null,
      sessionId: s.session_id,
      sessionTitle: queryMap[s.session_id] ?? null,
      at: s.created_at,
    };
  }
  if (ev.type === 'job') {
    const j = ev.payload;
    return {
      kind: 'job',
      title: `job ${j.status}`,
      detail: j.error ? j.error.slice(0, 80) : null,
      sessionId: j.session_id,
      sessionTitle: queryMap[j.session_id] ?? null,
      at: j.updated_at,
    };
  }
  if (ev.type === 'session') {
    const s = ev.payload;
    return {
      kind: 'session',
      title: s.status,
      detail: s.title,
      sessionId: s.id,
      sessionTitle: s.title,
      at: s.updated_at,
    };
  }
  // concept / concept_link / source / query — not surfaced in the activity rail
  return { kind: ev.type, title: ev.type, detail: null, sessionId: null, sessionTitle: null, at: '' };
}

function ActivityRail({
  events,
  queryMap,
  recentConcepts,
}: {
  events: StreamEvent[];
  queryMap: Record<string, string>;
  recentConcepts: Array<{ name: string; session_id: string; session_title: string; created_at: string }>;
}) {
  return (
    <aside className="flex flex-col gap-4 text-sm">
      {recentConcepts.length > 0 && (
        <div>
          <h3 className="font-heading text-lg font-medium text-text-secondary mb-2">Recent concepts</h3>
          <div className="flex flex-wrap gap-1.5">
            {recentConcepts.slice(0, 12).map((c, i) => (
              <Link
                key={`${c.session_id}:${c.name}:${i}`}
                to={`/research/${c.session_id}`}
                title={c.session_title}
                className="px-2 py-0.5 rounded bg-bg-secondary border border-border-primary text-text-secondary hover:text-text-primary hover:border-accent transition-colors"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-heading text-lg font-medium text-text-secondary mb-2 flex items-baseline gap-2">
          Activity
          {events.length > 0 && <span className="text-xs font-sans font-normal text-text-muted">live</span>}
        </h3>
        <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
          {events.length === 0 ? (
            <p className="p-3 text-text-muted">Waiting for activity…</p>
          ) : (
            <ul className="divide-y divide-border-primary max-h-[560px] overflow-y-auto">
              {events.map((ev, i) => {
                const d = describeEvent(ev, queryMap);
                return (
                  <li key={`${d.kind}:${d.at}:${i}`} className="px-3 py-2 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className={clsx('text-sm uppercase tracking-wide shrink-0', eventKindClass[d.kind] ?? 'text-text-muted')}>
                        {d.kind}
                      </span>
                      <span className="text-sm text-text-muted ml-auto tabular-nums shrink-0">{relativeTime(d.at)}</span>
                    </div>
                    <p className="text-sm text-text-primary line-clamp-2">{d.title || '—'}</p>
                    {(d.sessionTitle || d.detail) && (
                      <p className="text-sm text-text-muted truncate">
                        {d.sessionId ? (
                          <Link to={`/research/${d.sessionId}`} className="hover:text-accent">
                            {d.sessionTitle ?? d.sessionId.slice(0, 12)}
                          </Link>
                        ) : null}
                        {d.sessionTitle && d.detail ? <span> · </span> : null}
                        {d.detail ?? ''}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

// --- Main Page ---

export function ResearchWorkersPage() {
  const { data: queries = [] } = useResearchQueries();
  const { data: workers = [], isLoading: workersLoading } = useResearchWorkers();
  const { data: allJobs = [] } = useAllJobs({ limit: 500 });
  const { data: stats } = useJobStats();
  const { data: throughput } = useResearchStats('7d', 'day');
  const { data: summary } = useResearchSummary();
  const { data: jobMetrics } = useGlobalJobMetrics();
  const { data: sourceHealth } = useGlobalSourceHealth();
  const { events: liveEvents } = useCrossSessionStream();
  const addWorker = useAddWorker();
  const removeWorker = useRemoveWorker();
  const killWorker = useKillWorker();
  const cancelJob = useCancelJob();
  const runAll = useRunAllResearch();
  const stopAll = useStopAllResearch();

  const queryMap: Record<string, string> = Object.fromEntries(
    queries.map((q) => [q.id, q.title || q.prompt])
  );

  const runningJobs = allJobs.filter(j => j.status === 'running' || j.status === 'claimed');
  const pendingJobs = allJobs.filter(j => j.status === 'pending');
  const inFlightJobs = [...runningJobs, ...pendingJobs].sort((a, b) => {
    const rank = (s: string) => (s === 'running' ? 0 : s === 'claimed' ? 1 : 2);
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return a.created_at.localeCompare(b.created_at);
  });
  const historyJobs = allJobs.filter(j => j.status !== 'pending' && j.status !== 'running' && j.status !== 'claimed');

  const isActive = runningJobs.length > 0 || pendingJobs.length > 0;
  const runningWorkers = workers.filter(w => w.status === 'running');
  const successRate = stats && stats.total > 0
    ? ((stats.completed / stats.total) * 100)
    : null;

  // Today's throughput — derived from existing stats endpoint (byDay ascending).
  const today = throughput?.byDay?.[throughput.byDay.length - 1];
  const todayFindings = today?.findings ?? 0;
  const todaySpend = today?.cost ?? 0;
  const activeQueries = queries.filter(q => q.status === 'active').length;

  if (workersLoading) return <PageLoading />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workers"
        subtitle="Research engine supervisor"
        actions={
          <div className="flex items-center gap-3">
            <WorkerCountControl
              count={workers.length}
              onAdd={() => addWorker.mutate()}
              onRemove={() => removeWorker.mutate()}
              addPending={addWorker.isPending}
              removePending={removeWorker.isPending}
            />
            <Button
              variant={isActive ? 'ghost' : 'primary'}
              size="sm"
              onClick={() => isActive ? stopAll.mutate() : runAll.mutate()}
              loading={isActive ? stopAll.isPending : runAll.isPending}
            >
              {isActive ? 'Pause All' : 'Resume All'}
            </Button>
          </div>
        }
      />

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
      <div className="flex flex-col gap-6 min-w-0">

      {/* Throughput — today's output across all queries */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Active Queries"
          value={fmtNumber(activeQueries)}
          accent={activeQueries > 0 ? 'success' : 'neutral'}
          detailContent={
            <><span className="text-text-muted">of </span><span className="text-text-secondary font-medium">{queries.length}</span><span className="text-text-muted"> total</span></>
          }
        />
        <StatCard
          label="Steps / hr"
          value={fmtNumber(summary?.stepsPerHour ?? 0)}
          accent={summary && summary.stepsPerHour > 0 ? 'success' : 'neutral'}
        />
        <StatCard
          label="Findings Today"
          value={fmtNumber(todayFindings)}
          accent="success"
        />
        <StatCard
          label="Spend Today"
          value={fmtCurrency(todaySpend)}
          accent="default"
        />
        <StatCard
          label="Total Cost · 7d"
          value={fmtCurrency(throughput?.totalCost ?? 0)}
          accent="neutral"
        />
        <StatCard
          label="Extraction Backlog"
          value={fmtNumber((summary?.extractionQueue.pending ?? 0) + (summary?.extractionQueue.running ?? 0))}
          accent={summary && (summary.extractionQueue.pending + summary.extractionQueue.running) > 0 ? 'warning' : 'neutral'}
          detailContent={summary ? (
            <>
              <span className="text-text-muted">{summary.extractionQueue.running} running · {summary.extractionQueue.failed} failed</span>
            </>
          ) : undefined}
        />
      </div>

      {/* Job stats — upgraded to percentile view; per-session breakdowns live in each query's Telemetry tab */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Workers" value={fmtNumber(runningWorkers.length)} accent="success" />
        <StatCard label="Running" value={fmtNumber(runningJobs.length)} accent="default" />
        <StatCard label="Pending" value={fmtNumber(pendingJobs.length)} accent={pendingJobs.length > 0 ? 'warning' : undefined} />
        <StatCard
          label="Queue Wait p50"
          value={jobMetrics?.queue_wait_ms?.p50 != null ? fmtMs(jobMetrics.queue_wait_ms.p50) : '—'}
          detailContent={jobMetrics?.queue_wait_ms ? (
            <><span className="text-text-muted">p95 </span><span className="text-text-secondary">{fmtMs(jobMetrics.queue_wait_ms.p95)}</span></>
          ) : undefined}
        />
        <StatCard
          label="Run p50"
          value={jobMetrics?.duration_ms?.p50 != null ? fmtMs(jobMetrics.duration_ms.p50) : '—'}
          detailContent={jobMetrics?.duration_ms ? (
            <><span className="text-text-muted">p95 </span><span className="text-text-secondary">{fmtMs(jobMetrics.duration_ms.p95)}</span></>
          ) : undefined}
        />
        <StatCard
          label="Success Rate"
          value={successRate != null ? fmtPct(successRate) : '—'}
          accent={successRate != null ? (successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'error') : undefined}
          detailContent={sourceHealth && sourceHealth.total > 0 ? (
            <><span className="text-text-muted">sources fail </span>
              <span className={clsx('font-medium', sourceHealth.failure_rate > 0.25 ? 'text-error' : sourceHealth.failure_rate > 0.1 ? 'text-warning' : 'text-text-secondary')}>
                {(sourceHealth.failure_rate * 100).toFixed(0)}%
              </span></>
          ) : undefined}
        />
      </div>

      {/* Worker cards */}
      {workers.length > 0 && (
        <div>
          <h3 className="font-heading text-lg font-medium text-text-secondary mb-3">Workers</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workers.map((w) => (
              <WorkerCard
                key={w.id}
                worker={w}
                currentJob={w.currentJob ?? undefined}
                queryTitle={w.currentJob ? queryMap[w.currentJob.session_id] : undefined}
                onKill={(id) => killWorker.mutate(id)}
                killPending={killWorker.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* In-flight jobs — running + queued */}
      <div>
        <h3 className="font-heading text-lg font-medium text-text-secondary mb-3 flex items-baseline gap-2">
          In Flight
          {runningJobs.length > 0 && <span className="text-xs font-sans font-normal text-success">{runningJobs.length} running</span>}
          {pendingJobs.length > 0 && <span className="text-xs font-sans font-normal text-warning">{pendingJobs.length} queued</span>}
        </h3>
        <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
          <InFlightJobsTable
            jobs={inFlightJobs}
            queryMap={queryMap}
            onCancel={(jobId) => cancelJob.mutate({ jobId })}
            cancelPending={cancelJob.isPending}
          />
        </div>
      </div>

      {/* Performance charts */}
      {stats && stats.byDay.length > 0 && (
        <div>
          <h3 className="font-heading text-lg font-medium text-text-secondary mb-3">Performance</h3>
          <PerformanceCharts byDay={stats.byDay} />
        </div>
      )}

      {/* Job history */}
      <div>
        <h3 className="font-heading text-lg font-medium text-text-secondary mb-3">Job History</h3>
        <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
          <JobHistoryTable
            jobs={historyJobs}
            queryMap={queryMap}
          />
        </div>
      </div>

      </div>
      <div className="mt-6 xl:mt-0">
        <ActivityRail
          events={liveEvents}
          queryMap={queryMap}
          recentConcepts={summary?.recentConcepts ?? []}
        />
      </div>
      </div>
    </div>
  );
}
