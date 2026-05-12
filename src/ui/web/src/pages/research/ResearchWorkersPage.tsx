/**
 * Workers page — loops-flavored.
 *
 * The legacy worker-pool concept (N persistent workers polling research_jobs)
 * is gone in the v1 loop engine: each loop spawns its own supervisor child
 * process at /api/loops/start time. So "worker" now maps 1:1 to "running
 * loop" — pid lives on the loop row (`child_pid`), and "killing the worker"
 * is `POST /api/loops/:id/cancel` (SIGTERM → graceful exit → status flip).
 *
 * The page polls /api/loops every 2s for the live view; that's the same
 * cadence the legacy page used. No SSE needed — the list is short and the
 * page is rarely open while loops are running mid-flight.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/data/StatCard';
import { PageLoading } from '../../components/ui/Spinner';
import { shortRelativeTime } from '../../utils/format';

interface LoopRow {
  id: string;
  template_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
  envelope_consumed: Record<string, number>;
  child_pid: number | null;
  prompt: string;
  created_at: string;
  updated_at: string;
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-success',
  pending: 'bg-warning',
  completed: 'bg-info',
  cancelled: 'bg-text-disabled',
  failed: 'bg-error',
};

export function ResearchWorkersPage() {
  const [loops, setLoops] = useState<LoopRow[] | null>(null);
  const [killPending, setKillPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/loops?limit=200');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as LoopRow[];
        if (!cancelled) setLoops(rows);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const handleKill = async (loopId: string) => {
    setKillPending(prev => new Set(prev).add(loopId));
    try {
      const res = await fetch(`/api/loops/${loopId}/cancel`, { method: 'POST' });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(`cancel failed: ${(e as Error).message}`);
    } finally {
      setKillPending(prev => {
        const next = new Set(prev);
        next.delete(loopId);
        return next;
      });
    }
  };

  if (loops === null) return <PageLoading />;

  const running = loops.filter(l => l.status === 'running' || l.status === 'pending');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = loops
    .filter(l => ['completed', 'cancelled', 'failed'].includes(l.status))
    .filter(l => new Date(l.updated_at + 'Z').getTime() >= cutoff)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 20);

  const completed24h = recent.filter(r => r.status === 'completed').length;
  const cancelled24h = recent.filter(r => r.status === 'cancelled').length;
  const failed24h = recent.filter(r => r.status === 'failed').length;

  return (
    <div data-testid="page-research-workers" className="flex flex-col gap-6">
      <PageHeader title="Workers" />

      {error && (
        <div className="border border-error/40 bg-error/10 text-error rounded px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Running" value={String(running.length)} accent="default" compact />
        <StatCard label="Completed · 24h" value={String(completed24h)} accent="success" compact />
        <StatCard label="Cancelled · 24h" value={String(cancelled24h)} accent="neutral" compact />
        <StatCard label="Failed · 24h" value={String(failed24h)} accent="warning" compact />
      </div>

      <Panel title="Active" subtitle={running.length === 0 ? 'nothing running' : `${running.length} loops`}>
        {running.length === 0 ? (
          <EmptyRow>No loops are running.</EmptyRow>
        ) : (
          running.map(l => (
            <LoopRow
              key={l.id}
              loop={l}
              onKill={handleKill}
              killPending={killPending.has(l.id)}
            />
          ))
        )}
      </Panel>

      <Panel title="Recent · 24h" subtitle={`${recent.length} terminated`}>
        {recent.length === 0 ? (
          <EmptyRow>No loops have terminated in the last 24h.</EmptyRow>
        ) : (
          recent.map(l => <LoopRow key={l.id} loop={l} />)
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-primary rounded-lg overflow-hidden">
      <div className="flex items-baseline justify-between px-3.5 py-2.5 border-b border-border-primary bg-bg-secondary">
        <div>
          <div className="text-sm font-medium text-text-primary">{title}</div>
          {subtitle && <div className="text-xs text-text-muted">{subtitle}</div>}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-sm text-text-muted text-center italic">{children}</div>
  );
}

function LoopRow({
  loop,
  onKill,
  killPending,
}: {
  loop: LoopRow;
  onKill?: (id: string) => void;
  killPending?: boolean;
}) {
  const dot = STATUS_DOT[loop.status] ?? 'bg-text-muted';
  const cycles = loop.envelope_consumed?.cycles_count ?? 0;
  const cost = loop.envelope_consumed?.cost_usd ?? 0;
  return (
    <div
      className="grid items-center gap-2.5 px-3.5 py-2.5 border-b border-border-primary last:border-b-0 text-sm hover:bg-bg-tertiary"
      style={{ gridTemplateColumns: '8px 1fr auto auto auto auto' }}
    >
      <span className={clsx('w-2 h-2 rounded-full shrink-0', dot)} />
      <Link to={`/research/${loop.id}`} className="min-w-0 hover:underline">
        <div className="font-medium text-text-primary truncate">
          {loop.prompt || `(${loop.template_id})`}
        </div>
        <div className="text-xs text-text-muted mt-0.5 truncate">
          {loop.template_id} · {loop.status} ·{' '}
          {loop.child_pid != null ? `pid ${loop.child_pid}` : 'no child'}
        </div>
      </Link>
      <span className="font-mono text-xs text-text-secondary tabular-nums whitespace-nowrap">
        <span className="text-text-primary font-medium">{cycles}</span>
        <span className="text-text-muted"> cyc</span>
      </span>
      <span className="font-mono text-xs text-text-secondary tabular-nums whitespace-nowrap">
        ${cost.toFixed(4)}
      </span>
      <span className="text-xs text-text-muted tabular-nums whitespace-nowrap">
        {shortRelativeTime(loop.updated_at)}
      </span>
      {onKill ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onKill(loop.id)}
          disabled={killPending || loop.status !== 'running'}
        >
          {killPending ? '…' : 'Kill'}
        </Button>
      ) : (
        <span className="text-xs text-text-muted capitalize">{loop.status}</span>
      )}
    </div>
  );
}
