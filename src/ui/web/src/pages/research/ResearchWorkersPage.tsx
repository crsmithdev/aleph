import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/data/StatCard';
import { DataTable, type Column } from '../../components/data/DataTable';
import { PageLoading } from '../../components/ui/Spinner';
import {
  useResearchQueries,
  useResearchJobs,
  useCancelJob,
  useRunResearch,
  useStopAllResearch,
  useResearchWorkers,
  type ResearchJob,
} from '../../api/research-hooks';
import { fmtNumber } from '../../utils/format';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-900/50 text-yellow-300',
  running: 'bg-green-900/50 text-green-300',
  completed: 'bg-blue-900/50 text-blue-300',
  failed: 'bg-red-900/50 text-red-300',
  cancelled: 'bg-bg-tertiary text-text-muted',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', statusColors[status] ?? 'bg-bg-tertiary text-text-muted')}>
      {status}
    </span>
  );
}

function elapsed(from: string | null): string {
  if (!from) return '—';
  const ms = Date.now() - new Date(from).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function uptime(from: string | null): string {
  return from ? elapsed(from) : '—';
}

// Per-query job loader — rendered for each active query
function QueryJobRows({ queryId, queryTitle, onCancel }: {
  queryId: string;
  queryTitle: string;
  onCancel: (jobId: string) => void;
}) {
  const { data: jobs = [] } = useResearchJobs(queryId);
  return (
    <>
      {jobs.map((job) => ({
        ...job,
        _queryTitle: queryTitle,
        _queryId: queryId,
      })).map((job) => ({
        id: job.id,
        session_id: job.session_id,
        status: job.status,
        mode: job.mode,
        max_iterations: job.max_iterations,
        iterations_completed: job.iterations_completed,
        claimed_by: job.claimed_by,
        claimed_at: job.claimed_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        heartbeat_at: job.heartbeat_at,
        error: job.error,
        created_at: job.created_at,
        updated_at: job.updated_at,
        _queryTitle: queryTitle,
        _queryId: queryId,
        _onCancel: onCancel,
      }))}
    </>
  );
}

type AggregatedJob = ResearchJob & { _queryTitle: string; _queryId: string };

function JobsTable({
  jobs,
  queries,
  onCancel,
  cancelPending,
}: {
  jobs: AggregatedJob[];
  queries: Record<string, string>;
  onCancel: (jobId: string) => void;
  cancelPending: boolean;
}) {
  const columns: Column<AggregatedJob>[] = [
    {
      key: 'id',
      label: 'Job ID',
      shrink: true,
      render: (row) => (
        <span className="font-mono text-xs text-text-muted">{row.id.slice(0, 8)}</span>
      ),
    },
    {
      key: '_queryTitle',
      label: 'Query',
      render: (row) => (
        <Link to={`/research/${row.session_id}`} className="text-sm text-accent hover:underline truncate block max-w-xs">
          {row._queryTitle}
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
      key: 'claimed_by',
      label: 'Worker',
      shrink: true,
      render: (row) => (
        <span className="font-mono text-xs text-text-secondary">{row.claimed_by?.slice(0, 12) ?? '—'}</span>
      ),
    },
    {
      key: 'iterations_completed',
      label: 'Progress',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="text-xs tabular-nums text-text-secondary">
          {row.iterations_completed}{row.max_iterations ? `/${row.max_iterations}` : ''} iter
        </span>
      ),
    },
    {
      key: 'started_at',
      label: 'Duration',
      shrink: true,
      align: 'right',
      render: (row) => (
        <span className="text-xs tabular-nums text-text-muted">{elapsed(row.started_at)}</span>
      ),
    },
    {
      key: '_actions',
      label: '',
      shrink: true,
      render: (row) =>
        row.status === 'running' || row.status === 'pending' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onCancel(row.id); }}
            disabled={cancelPending}
          >
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
      emptyMessage="No jobs found."
      defaultSort={{ key: 'created_at', dir: 'desc' }}
    />
  );
}

// Worker card derived from job claimed_by field
function WorkerCard({
  workerId,
  jobs,
  queries,
  onKill,
  killPending,
}: {
  workerId: string;
  jobs: AggregatedJob[];
  queries: Record<string, string>;
  onKill: (jobId: string) => void;
  killPending: boolean;
}) {
  const runningJob = jobs.find((j) => j.claimed_by === workerId && j.status === 'running');
  const claimedAt = runningJob?.claimed_at ?? jobs.find((j) => j.claimed_by === workerId)?.claimed_at ?? null;

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            <span className="font-mono text-xs text-text-primary truncate">{workerId.slice(0, 16)}</span>
          </div>
          <div className="text-xs text-text-muted mt-1">Uptime: {uptime(claimedAt)}</div>
        </div>
        {runningJob && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onKill(runningJob.id)}
            disabled={killPending}
          >
            Kill
          </Button>
        )}
      </div>

      {runningJob ? (
        <div className="bg-bg-primary border border-border-primary rounded p-3 space-y-1">
          <Link
            to={`/research/${runningJob.session_id}`}
            className="text-sm font-medium text-accent hover:underline truncate block"
          >
            {queries[runningJob.session_id] ?? runningJob.session_id}
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={runningJob.status} />
            <span className="text-xs text-text-muted">
              {runningJob.iterations_completed}{runningJob.max_iterations ? `/${runningJob.max_iterations}` : ''} iterations
            </span>
            <span className="text-xs text-text-muted">{elapsed(runningJob.started_at)} elapsed</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-text-muted">No active job</div>
      )}
    </div>
  );
}

export function ResearchWorkersPage() {
  const { data: queries = [], isLoading } = useResearchQueries();
  const { data: workers } = useResearchWorkers();
  const cancelJob = useCancelJob();
  const stopAll = useStopAllResearch();
  const runResearch = useRunResearch();

  // Load jobs for all active/running queries
  const activeQueries = queries.filter((q) => q.status === 'active');

  // We need to collect jobs from each active query — done via child hooks pattern
  // Since hooks can't be called conditionally, use a flat aggregator component approach:
  // Collect via individual hook calls (max 20 active queries is realistic)
  const q0 = useResearchJobs(activeQueries[0]?.id ?? '');
  const q1 = useResearchJobs(activeQueries[1]?.id ?? '');
  const q2 = useResearchJobs(activeQueries[2]?.id ?? '');
  const q3 = useResearchJobs(activeQueries[3]?.id ?? '');
  const q4 = useResearchJobs(activeQueries[4]?.id ?? '');
  const q5 = useResearchJobs(activeQueries[5]?.id ?? '');
  const q6 = useResearchJobs(activeQueries[6]?.id ?? '');
  const q7 = useResearchJobs(activeQueries[7]?.id ?? '');

  const jobSets = [q0, q1, q2, q3, q4, q5, q6, q7];

  const allJobs: AggregatedJob[] = activeQueries.flatMap((q, i) => {
    const jobs = jobSets[i]?.data ?? [];
    return jobs.map((j) => ({ ...j, _queryTitle: q.title || q.seed_query, _queryId: q.id }));
  });

  const queryMap: Record<string, string> = Object.fromEntries(
    queries.map((q) => [q.id, q.title || q.seed_query])
  );

  const runningJobs = allJobs.filter((j) => j.status === 'running');
  const pendingJobs = allJobs.filter((j) => j.status === 'pending');
  const completedToday = allJobs.filter((j) => {
    if (j.status !== 'completed' || !j.completed_at) return false;
    const d = new Date(j.completed_at);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });

  // Unique worker IDs from running/recently-claimed jobs
  const workerIds = Array.from(
    new Set(allJobs.filter((j) => j.claimed_by).map((j) => j.claimed_by as string))
  );

  const activeWorkerIds = workerIds.filter((wid) =>
    allJobs.some((j) => j.claimed_by === wid && j.status === 'running')
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workers"
        subtitle="Research engine supervisor"
        actions={
          <>
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
              onClick={() => {
                activeQueries.forEach((q) => runResearch.mutate({ sessionId: q.id }));
              }}
              loading={runResearch.isPending}
            >
              Spawn Worker
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active Workers" value={fmtNumber(activeWorkerIds.length)} accent="success" />
        <StatCard label="Jobs Running" value={fmtNumber(runningJobs.length)} accent="default" />
        <StatCard label="Jobs Pending" value={fmtNumber(pendingJobs.length)} accent="warning" />
        <StatCard label="Completed Today" value={fmtNumber(completedToday.length)} />
      </div>

      {isLoading ? (
        <PageLoading />
      ) : (
        <>
          {/* Worker cards */}
          {activeWorkerIds.length > 0 && (
            <div>
              <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Active Workers</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeWorkerIds.map((wid) => (
                  <WorkerCard
                    key={wid}
                    workerId={wid}
                    jobs={allJobs}
                    queries={queryMap}
                    onKill={(jobId) => cancelJob.mutate({ jobId })}
                    killPending={cancelJob.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Job queue table */}
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wide mb-3">Job Queue</p>
            <div className="bg-bg-secondary border border-border-primary rounded-lg overflow-hidden">
              <JobsTable
                jobs={allJobs}
                queries={queryMap}
                onCancel={(jobId) => cancelJob.mutate({ jobId })}
                cancelPending={cancelJob.isPending}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
