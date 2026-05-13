/**
 * Monitors page — companion to the Research landing.
 *
 * The monitor template ships alongside the research template (Phase 2). It
 * runs wait-cycles + run-cycles on a long-lived loop and produces a weekly
 * digest as its render. This page filters the cross-loop list to
 * `template_id === 'monitor'` so monitor runs have their own surface — every
 * other loop concept (compose box, history, stats) belongs to research and
 * lives at `/research`.
 *
 * Data shape matches the loops adapter's row: id, template_id, status,
 * envelope_consumed, child_pid, prompt, mode, created_at, updated_at, stats.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { PageHeader } from '../../components/layout/PageHeader';
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
  mode: string | null;
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

export function ResearchMonitorsPage() {
  const [loops, setLoops] = useState<LoopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/loops?limit=200');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as LoopRow[];
        if (!cancelled) setLoops(rows.filter(l => l.template_id === 'monitor'));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (loops === null) return <PageLoading />;

  const active = loops.filter(l => l.status === 'running' || l.status === 'pending');
  const terminated = loops.filter(l => ['completed', 'cancelled', 'failed'].includes(l.status));

  return (
    <div data-testid="page-research-monitors" className="flex flex-col gap-6">
      <PageHeader title="Monitors" />

      {error && (
        <div className="border border-error/40 bg-error/10 text-error rounded px-3 py-2 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Active" value={String(active.length)} accent="success" compact />
        <StatCard label="Total" value={String(loops.length)} accent="default" compact />
        <StatCard label="Terminated" value={String(terminated.length)} accent="neutral" compact />
      </div>

      <Panel title="Active monitors" subtitle={active.length === 0 ? 'none running' : `${active.length} monitors`}>
        {active.length === 0 ? (
          <EmptyRow>No monitors are active. Start a `monitor` template loop to populate this list.</EmptyRow>
        ) : (
          active.map(l => <LoopRowView key={l.id} loop={l} />)
        )}
      </Panel>

      <Panel title="History" subtitle={`${terminated.length} terminated`}>
        {terminated.length === 0 ? (
          <EmptyRow>No monitor history yet.</EmptyRow>
        ) : (
          terminated
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(0, 50)
            .map(l => <LoopRowView key={l.id} loop={l} />)
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

function LoopRowView({ loop }: { loop: LoopRow }) {
  const dot = STATUS_DOT[loop.status] ?? 'bg-text-muted';
  const cycles = loop.envelope_consumed?.cycles_count ?? 0;
  const cost = loop.envelope_consumed?.cost_usd ?? 0;
  return (
    <div
      className="grid items-center gap-2.5 px-3.5 py-2.5 border-b border-border-primary last:border-b-0 text-sm hover:bg-bg-tertiary"
      style={{ gridTemplateColumns: '8px 1fr auto auto auto' }}
    >
      <span className={clsx('w-2 h-2 rounded-full shrink-0', dot)} />
      <Link to={`/research/${loop.id}`} className="min-w-0 hover:underline">
        <div className="font-medium text-text-primary truncate">
          {loop.prompt || `(${loop.id})`}
        </div>
        <div className="text-xs text-text-muted mt-0.5 truncate">
          {loop.status}
          {loop.mode ? ` · ${loop.mode}` : ''}
          {loop.child_pid != null ? ` · pid ${loop.child_pid}` : ''}
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
    </div>
  );
}
