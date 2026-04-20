import { clsx } from 'clsx';
import {
  useIterationChecks,
  usePostMortems,
  type IterationCheckRecord,
  type PostMortemRecord,
} from '../../api/research-hooks';

interface Props { sessionId: string }

export function ReviewsView({ sessionId }: Props) {
  const { data: checks = [], isLoading: checksLoading } = useIterationChecks(sessionId);
  const { data: mortems = [], isLoading: mortemsLoading } = usePostMortems(sessionId);

  if (checksLoading || mortemsLoading) {
    return <div className="p-6 text-sm text-text-muted">Loading reviews…</div>;
  }

  if (checks.length === 0 && mortems.length === 0) {
    return (
      <div className="p-6 text-sm text-text-muted max-w-2xl">
        <p className="mb-2">No agent reviews yet.</p>
        <p>Reviews appear here as the run progresses:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><span className="text-text-secondary">Iteration checks</span> fire every 5 iterations — they spot-check drift against the original prompt and can auto-prune off-topic threads.</li>
          <li><span className="text-text-secondary">Post-mortems</span> fire once per completed job — they flag anomalies like low finding yield, thread skew, or runaway cost.</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      {mortems.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">
            Post-mortems ({mortems.length})
          </h2>
          <div className="flex flex-col gap-3">
            {mortems.map(m => <PostMortemCard key={m.id} record={m} />)}
          </div>
        </section>
      )}
      {checks.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-3">
            Iteration checks ({checks.length})
          </h2>
          <div className="flex flex-col gap-3">
            {checks.map(c => <IterationCheckCard key={c.id} record={c} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function VerdictBadge({ kind, label }: { kind: 'ok' | 'warn' | 'error' | 'neutral'; label: string }) {
  const cls = {
    ok: 'bg-green-900/40 text-green-300 border-green-500/30',
    warn: 'bg-yellow-900/40 text-yellow-300 border-yellow-500/30',
    error: 'bg-red-900/40 text-red-300 border-red-500/30',
    neutral: 'bg-bg-tertiary text-text-secondary border-border-primary',
  }[kind];
  return <span className={clsx('px-2 py-0.5 rounded text-sm font-medium border tabular-nums', cls)}>{label}</span>;
}

function PostMortemCard({ record }: { record: PostMortemRecord }) {
  const kind = record.verdict === 'pass' ? 'ok' : 'warn';
  const m = record.metrics_snapshot.metrics;
  const sh = record.metrics_snapshot.source_health;
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <VerdictBadge kind={kind} label={record.verdict} />
          {record.flags.map(f => <VerdictBadge key={f} kind="warn" label={f} />)}
        </div>
        <span className="text-sm text-text-muted font-mono">{record.created_at}</span>
      </div>
      <p className="text-sm text-text-secondary mb-3">{record.notes}</p>
      {record.recommendations.length > 0 && (
        <div className="mb-3">
          <p className="text-sm text-text-muted uppercase tracking-wider mb-1">Recommendations</p>
          <ul className="list-disc pl-5 text-sm text-text-secondary space-y-0.5">
            {record.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {m && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-text-muted border-t border-border-primary pt-2">
          <span>findings: <span className="text-text-secondary tabular-nums">{m.findings}</span></span>
          <span>steps: <span className="text-text-secondary tabular-nums">{m.steps}</span></span>
          <span>threads: <span className="text-text-secondary tabular-nums">{m.threads_total}</span></span>
          <span>errors: <span className="text-text-secondary tabular-nums">{m.errors}</span></span>
          <span>cost: <span className="text-text-secondary tabular-nums">${m.cost_usd.toFixed(4)}</span></span>
          <span>duration: <span className="text-text-secondary tabular-nums">{(m.duration_ms / 60_000).toFixed(1)}m</span></span>
          {sh && sh.total_attempts > 0 && (
            <span>source failure rate: <span className="text-text-secondary tabular-nums">{(sh.failure_rate * 100).toFixed(1)}%</span></span>
          )}
        </div>
      )}
    </div>
  );
}

function IterationCheckCard({ record }: { record: IterationCheckRecord }) {
  const kind = record.verdict === 'on_track' ? 'ok' : record.verdict === 'drifting' ? 'warn' : 'error';
  const killed = record.applied_actions.filter(a => a.action === 'kill_thread' && a.ok);
  const proposed = record.applied_actions.filter(a => a.action !== 'kill_thread' || !a.ok);
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <VerdictBadge kind={kind} label={record.verdict.replace('_', ' ')} />
          <span className="text-sm text-text-muted">iter {record.iterations_completed}</span>
        </div>
        <span className="text-sm text-text-muted font-mono">{record.created_at}</span>
      </div>
      {record.notes && <p className="text-sm text-text-secondary mb-2">{record.notes}</p>}
      {killed.length > 0 && (
        <div className="mb-2">
          <p className="text-sm text-text-muted uppercase tracking-wider mb-1">Auto-pruned threads</p>
          <ul className="text-sm text-text-secondary space-y-0.5">
            {killed.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-red-400 shrink-0">✕</span>
                <span className="truncate">{a.detail || a.target}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {proposed.length > 0 && (
        <div>
          <p className="text-sm text-text-muted uppercase tracking-wider mb-1">Proposals</p>
          <ul className="text-sm text-text-secondary space-y-0.5">
            {proposed.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-text-muted shrink-0">{a.ok ? '•' : '?'}</span>
                <span className="truncate">
                  <span className="text-text-muted">{a.action.replace(/_/g, ' ')}:</span>{' '}
                  {a.detail || a.target}
                  {a.error && <span className="text-text-muted italic ml-1">({a.error})</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
