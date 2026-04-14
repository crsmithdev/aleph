import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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
  useAddWorker,
  useRemoveWorker,
  useKillWorker,
  useCancelJob,
  useRunResearch,
  useStopAllResearch,
  type ResearchJob,
  type WorkerStatus,
} from '../../api/research-hooks';
import { fmtNumber, fmtMs, fmtPct } from '../../utils/format';

// --- Helpers ---

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-900/50 text-yellow-300',
  claimed: 'bg-yellow-900/50 text-yellow-300',
  running: 'bg-green-900/50 text-green-300',
  idle: 'bg-blue-900/50 text-blue-300',
  completed: 'bg-blue-900/50 text-blue-300',
  failed: 'bg-red-900/50 text-red-300',
  cancelled: 'bg-bg-tertiary text-text-muted',
};

const workerDotColors: Record<string, string> = {
  starting: 'bg-yellow-400',
  running: 'bg-green-400',
  idle: 'bg-blue-400',
  stopping: 'bg-orange-400',
  stopped: 'bg-bg-tertiary',
  backoff: 'bg-red-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', statusColors[status] ?? 'bg-bg-tertiary text-text-muted')}>
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
  return <span className="text-xs tabular-nums text-text-muted font-mono">{elapsed(from)}</span>;
}

// Expanded job detail panel
function JobDetail({ job, queryMap }: { job: ResearchJob; queryMap: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
      <div className="space-y-2">
        <div>
          <span className="text-text-muted uppercase tracking-wider">Job ID</span>
          <p className="font-mono text-text-secondary mt-0.5">{job.id}</p>
        </div>
        <div>
          <span className="text-text-muted uppercase tracking-wider">Query</span>
          <p className="mt-0.5">
            <Link to={`/research/${job.session_id}`} className="font-mono text-accent hover:underline">
              {queryMap[job.session_id] ?? job.session_id}
            </Link>
          </p>
        </div>
        {job.thread_id && (
          <div>
            <span className="text-text-muted uppercase tracking-wider">Thread</span>
            <p className="font-mono text-text-secondary mt-0.5">{job.thread_id}</p>
          </div>
        )}
        {job.claimed_by && (
          <div>
            <span className="text-text-muted uppercase tracking-wider">Worker</span>
            <p className="font-mono text-text-secondary mt-0.5">{job.claimed_by}</p>
          </div>
        )}
        <div>
          <span className="text-text-muted uppercase tracking-wider">Mode / Iterations</span>
          <p className="text-text-secondary mt-0.5">
            {job.mode} &middot; {job.iterations_completed}{job.max_iterations ? `/${job.max_iterations}` : ''} iter
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <div>
          <span className="text-text-muted uppercase tracking-wider">Created</span>
          <p className="font-mono text-text-secondary mt-0.5">{job.created_at}</p>
        </div>
        {job.started_at && (
          <div>
            <span className="text-text-muted uppercase tracking-wider">Started</span>
            <p className="font-mono text-text-secondary mt-0.5">{job.started_at}</p>
          </div>
        )}
        {job.completed_at && (
          <div>
            <span className="text-text-muted uppercase tracking-wider">Completed</span>
            <p className="font-mono text-text-secondary mt-0.5">{job.completed_at}</p>
          </div>
        )}
        {job.heartbeat_at && (
          <div>
            <span className="text-text-muted uppercase tracking-wider">Last Heartbeat</span>
            <p className="font-mono text-text-secondary mt-0.5">{job.heartbeat_at}</p>
          </div>
        )}
        {job.error && (
          <div>
            <span className="text-red-400 uppercase tracking-wider">Error</span>
            <p className="mt-0.5 text-red-300 bg-red-900/20 rounded p-2 font-mono whitespace-pre-wrap break-all">{job.error}</p>
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

      <div className="flex items-center gap-4 text-xs text-text-muted">
        <span>PID {worker.pid ?? '—'}</span>
        <span>Up {fmtUptime(worker.uptimeMs)}</span>
        {worker.restarts > 0 && <span className="text-yellow-400">{worker.restarts} restarts</span>}
      </div>

      {currentJob ? (
        <div className="bg-bg-primary border border-border-primary rounded p-3 space-y-1">
          <Link
            to={`/research/${currentJob.session_id}`}
            className="text-sm font-medium text-accent hover:underline truncate block"
          >
            {queryTitle ?? currentJob.session_id.slice(0, 12)}
          </Link>
          <div className="flex items-center gap-3 flex-wrap text-xs text-text-muted">
            <StatusBadge status={currentJob.status} />
            {currentJob.thread_id
              ? <span className="font-mono">thread {currentJob.thread_id.slice(0, 8)}</span>
              : <span>{currentJob.iterations_completed}{currentJob.max_iterations ? `/${currentJob.max_iterations}` : ''} iter</span>
            }
            <LiveDuration from={currentJob.started_at} />
          </div>
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-primary/40 rounded p-3 flex items-center justify-between opacity-50">
          <span className="font-mono text-xs text-text-muted">worker-{worker.id}</span>
          <span className="text-xs text-text-muted">no active job</span>
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
  return (
    <div className="flex items-center gap-1.5 border border-border-primary rounded-lg bg-bg-secondary">
      <button
        onClick={onRemove}
        disabled={removePending || count === 0}
        className="px-2.5 py-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-l-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-lg leading-none font-mono"
      >
        −
      </button>
      <span className="px-2 py-1.5 text-sm font-mono text-text-primary tabular-nums min-w-[2.5rem] text-center">
        {count}
      </span>
      <button
        onClick={onAdd}
        disabled={addPending}
        className="px-2.5 py-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-r-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-lg leading-none font-mono"
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
            <Bar dataKey="Completed" stackId="a" fill="var(--c-success)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Failed" stackId="a" fill="var(--c-error)" radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : (
          <AreaChart data={jobData}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...xAxisDateProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
            <Area type="monotone" dataKey="Completed" stackId="a" stroke="var(--c-success)" fill="var(--c-success)" fillOpacity={0.4} dot={false} />
            <Area type="monotone" dataKey="Failed" stackId="a" stroke="var(--c-error)" fill="var(--c-error)" fillOpacity={0.4} dot={false} />
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
            <Area type="monotone" dataKey="Avg Duration" stroke="var(--c-accent)" fill="var(--c-accent)" fillOpacity={0.15} dot={false} />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}

// --- Queued Jobs Table ---

function QueuedJobsTable({ jobs, queryMap, onCancel, cancelPending }: {
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
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.id.slice(0, 8)}</span>,
    },
    {
      key: 'session_id',
      label: 'Query',
      render: (row) => (
        <Link to={`/research/${row.session_id}`} className="text-sm text-accent hover:underline truncate block max-w-xs" onClick={e => e.stopPropagation()}>
          {queryMap[row.session_id] ?? row.session_id.slice(0, 12)}
        </Link>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      shrink: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'mode',
      label: 'Mode',
      shrink: true,
      render: (row) => <span className="text-xs text-text-muted">{row.mode}</span>,
    },
    {
      key: 'created_at',
      label: 'Queued',
      shrink: true,
      render: (row) => <span className="text-xs tabular-nums text-text-muted">{elapsed(row.created_at)} ago</span>,
    },
    {
      key: 'claimed_by',
      label: '',
      shrink: true,
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onCancel(row.id); }} disabled={cancelPending}>
          Cancel
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      data={jobs}
      columns={columns}
      keyField="id"
      emptyMessage="No queued jobs."
      defaultSort={{ key: 'created_at', dir: 'asc' }}
      pageSize={20}
      expandedKey={expandedKey}
      onExpandToggle={setExpandedKey}
      renderExpanded={(row) => <JobDetail job={row} queryMap={queryMap} />}
    />
  );
}

// --- Job History Table ---

function JobHistoryTable({ jobs, queryMap, onCancel, cancelPending }: {
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
      render: (row) => <span className="font-mono text-xs text-text-muted">{row.id.slice(0, 8)}</span>,
    },
    {
      key: 'session_id',
      label: 'Query',
      render: (row) => (
        <Link to={`/research/${row.session_id}`} className="text-sm text-accent hover:underline truncate block max-w-xs" onClick={e => e.stopPropagation()}>
          {queryMap[row.session_id] ?? row.session_id.slice(0, 12)}
        </Link>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      shrink: true,
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'mode',
      label: 'Mode',
      shrink: true,
      render: (row) => <span className="text-xs text-text-muted">{row.mode}</span>,
    },
    {
      key: 'thread_id',
      label: 'Thread',
      shrink: true,
      render: (row) => row.thread_id
        ? <span className="font-mono text-xs text-text-muted">{row.thread_id.slice(0, 8)}</span>
        : <span className="text-xs text-text-muted">—</span>,
    },
    {
      key: 'iterations_completed',
      label: 'Iterations',
      shrink: true,
      align: 'right',
      sortable: true,
      render: (row) => (
        <span className="text-xs tabular-nums text-text-secondary">
          {row.iterations_completed}{row.max_iterations ? `/${row.max_iterations}` : ''}
        </span>
      ),
    },
    {
      key: 'started_at',
      label: 'Duration',
      shrink: true,
      align: 'right',
      render: (row) => {
        const isActive = row.status === 'running' || row.status === 'claimed';
        return isActive
          ? <LiveDuration from={row.started_at} />
          : <span className="text-xs tabular-nums text-text-muted">{elapsed(row.started_at, row.completed_at)}</span>;
      },
    },
    {
      key: 'created_at',
      label: '',
      shrink: true,
      render: (row) =>
        row.status === 'running' || row.status === 'pending' || row.status === 'claimed' ? (
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onCancel(row.id); }} disabled={cancelPending}>
            Cancel
          </Button>
        ) : null,
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

// --- Main Page ---

export function ResearchWorkersPage() {
  const { data: queries = [] } = useResearchQueries();
  const { data: workers = [], isLoading: workersLoading } = useResearchWorkers();
  const { data: allJobs = [] } = useAllJobs({ limit: 500 });
  const { data: stats } = useJobStats();
  const addWorker = useAddWorker();
  const removeWorker = useRemoveWorker();
  const killWorker = useKillWorker();
  const cancelJob = useCancelJob();
  const runResearch = useRunResearch();
  const stopAll = useStopAllResearch();

  const queryMap: Record<string, string> = Object.fromEntries(
    queries.map((q) => [q.id, q.title || q.seed_query])
  );

  const activeQueries = queries.filter(q => q.status === 'active');

  const runningJobs = allJobs.filter(j => j.status === 'running' || j.status === 'claimed');
  const pendingJobs = allJobs.filter(j => j.status === 'pending' || j.status === 'claimed');
  const historyJobs = allJobs.filter(j => j.status !== 'pending');

  const runningWorkers = workers.filter(w => w.status === 'running');
  const successRate = stats && stats.total > 0
    ? ((stats.completed / stats.total) * 100)
    : null;

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
              variant="ghost"
              size="sm"
              onClick={() => stopAll.mutate()}
              loading={stopAll.isPending}
            >
              Stop All
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => activeQueries.forEach(q => runResearch.mutate({ sessionId: q.id }))}
              loading={runResearch.isPending}
              disabled={activeQueries.length === 0}
            >
              Run All ({activeQueries.length})
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Workers" value={fmtNumber(runningWorkers.length)} accent="success" />
        <StatCard label="Running" value={fmtNumber(runningJobs.length)} accent="default" />
        <StatCard label="Pending" value={fmtNumber(pendingJobs.length)} accent={pendingJobs.length > 0 ? 'warning' : undefined} />
        <StatCard label="Total Jobs" value={fmtNumber(stats?.total ?? 0)} />
        <StatCard label="Avg Duration" value={stats?.avgDurationMs ? fmtMs(stats.avgDurationMs) : '—'} />
        <StatCard
          label="Success Rate"
          value={successRate != null ? fmtPct(successRate) : '—'}
          accent={successRate != null ? (successRate >= 90 ? 'success' : successRate >= 70 ? 'warning' : 'error') : undefined}
        />
      </div>

      {/* Worker cards */}
      {workers.length > 0 && (
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Workers</p>
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

      {/* Queued jobs */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">
          Queued Jobs {pendingJobs.length > 0 && <span className="normal-case ml-1 text-yellow-400">({pendingJobs.length})</span>}
        </p>
        <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
          <QueuedJobsTable
            jobs={pendingJobs}
            queryMap={queryMap}
            onCancel={(jobId) => cancelJob.mutate({ jobId })}
            cancelPending={cancelJob.isPending}
          />
        </div>
      </div>

      {/* Performance charts */}
      {stats && stats.byDay.length > 0 && (
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Performance</p>
          <PerformanceCharts byDay={stats.byDay} />
        </div>
      )}

      {/* Job history */}
      <div>
        <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Job History</p>
        <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
          <JobHistoryTable
            jobs={historyJobs}
            queryMap={queryMap}
            onCancel={(jobId) => cancelJob.mutate({ jobId })}
            cancelPending={cancelJob.isPending}
          />
        </div>
      </div>
    </div>
  );
}
