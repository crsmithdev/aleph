/**
 * Loop detail page — three panels (Activity, Schedule, Artifact). Activity is
 * the first-class surface per principles §Observability. Initial state comes
 * from GET /loops/:id; live updates come from /loops/:id/stream (SSE).
 *
 * Temporary route. Phase 6 absorbs this into the v1 UI rewrite (Schedule view
 * as universal editor, 8-mode row, etc.).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageLoading } from '../../components/ui/Spinner';

interface Loop {
  id: string;
  template_id: string;
  status: string;
  envelope: Record<string, unknown>;
  envelope_consumed: Record<string, number>;
  prompt: string;
  created_at: string;
  updated_at: string;
}
interface Cycle {
  id: string;
  index: number;
  status: string;
}
interface Artifact {
  id: string;
  kind: string;
  cycle_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
interface StreamFrame {
  type: 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact';
  payload: Record<string, unknown>;
  ts: string;
}

export function LoopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<{ loop: Loop; cycles: Cycle[]; artifacts: Artifact[] } | null>(null);
  const [events, setEvents] = useState<StreamFrame[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Initial snapshot.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void fetch(`/api/loops/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) setSnapshot(data as typeof snapshot); })
      .catch(e => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [id]);

  // SSE — appends every event to the activity list and patches the snapshot
  // for loop/cycle status changes. When the loop reaches a terminal status,
  // re-fetch the snapshot once so cycles/artifacts/milestones reflect final state
  // (the engine only emits loop/cycle/cycle_step/milestone — artifact rows
  // are written but not pushed as events to keep the bus narrow).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const source = new EventSource(`/api/loops/${id}/stream`);
    source.onmessage = e => {
      try {
        const frame = JSON.parse(e.data) as { type: StreamFrame['type']; payload: Record<string, unknown> };
        const ts = new Date().toISOString();
        setEvents(prev => [...prev, { ...frame, ts }]);
        if (frame.type === 'loop') {
          const incoming = frame.payload as Partial<Loop>;
          setSnapshot(prev => prev ? { ...prev, loop: { ...prev.loop, ...incoming } } : prev);
          const status = incoming.status;
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            void fetch(`/api/loops/${id}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { if (data && !cancelled) setSnapshot(data as typeof snapshot); })
              .catch(() => { /* ignore */ });
          }
        }
      } catch { /* skip malformed */ }
    };
    return () => { cancelled = true; source.close(); };
  }, [id]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!snapshot) return <PageLoading />;

  const { loop, cycles, artifacts } = snapshot;
  const latestRender = artifacts.filter(a => a.kind === 'cycle_output').at(-1);

  return (
    <div className="flex flex-col gap-5" data-testid="page-loop-detail">
      <div>
        <Link to="/loops/new" className="text-sm text-accent hover:underline">&larr; New loop</Link>
        <PageHeader
          title={`Loop ${loop.id.slice(0, 8)}`}
          subtitle={<>{loop.template_id} · status <span data-testid="loop-status">{loop.status}</span> · {cycles.length} cycles</>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-4">
        <Panel title="Activity" testid="loop-activity">
          {events.length === 0 ? (
            <p className="text-sm text-text-muted">Waiting for events…</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto" data-testid="loop-activity-list">
              {events.map((e, i) => (
                <li key={i} className="text-xs font-mono text-text-secondary">
                  <span className="text-text-muted">{e.ts.slice(11, 19)} </span>
                  <span className="text-accent">{e.type}</span>{' '}
                  {summarize(e)}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Schedule" testid="loop-schedule">
          <dl className="text-sm text-text-secondary grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-text-muted">Template</dt>
            <dd>{loop.template_id}</dd>
            <dt className="text-text-muted">Status</dt>
            <dd>{loop.status}</dd>
            <dt className="text-text-muted">Envelope</dt>
            <dd className="font-mono text-xs">{JSON.stringify(loop.envelope) || '{}'}</dd>
            <dt className="text-text-muted">Consumed</dt>
            <dd className="font-mono text-xs">{JSON.stringify(loop.envelope_consumed)}</dd>
          </dl>
        </Panel>

        <Panel title="Artifact" testid="loop-artifact">
          {latestRender ? (
            <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words">
              {JSON.stringify(latestRender.payload, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-text-muted">No artifact yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) {
  return (
    <section className="bg-bg-secondary border border-border-primary rounded-lg p-4" data-testid={testid}>
      <h2 className="text-xs uppercase tracking-wide text-text-muted mb-3">{title}</h2>
      {children}
    </section>
  );
}

function summarize(frame: StreamFrame): string {
  const p = frame.payload;
  if (frame.type === 'loop') return `status=${p.status}${p.reason ? ` reason=${p.reason}` : ''}`;
  if (frame.type === 'cycle') return `idx=${p.index} status=${p.status}`;
  if (frame.type === 'cycle_step') return `cycle=${p.cycle_index} step=${p.step} cached=${p.cached}`;
  if (frame.type === 'milestone') return `pct=${p.at_envelope_pct}`;
  if (frame.type === 'artifact') return `kind=${p.kind}`;
  return '';
}
